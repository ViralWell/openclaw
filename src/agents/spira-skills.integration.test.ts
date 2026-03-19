import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveSpiraPluginConfig } from "../../extensions/spira/src/config.js";
import { createSpiraMediaTool } from "../../extensions/spira/src/media/tool.js";
import type { WorkflowCatalogEntry } from "../../extensions/spira/src/workflows/catalog.js";
import { createSpiraWorkflowTool } from "../../extensions/spira/src/workflows/tool.js";
import type { OpenClawConfig } from "../config/config.js";
import { clearPluginManifestRegistryCache } from "../plugins/manifest-registry.js";
import { captureEnv } from "../test-utils/env.js";
import { loadWorkspaceSkillEntries, resolveSkillsPromptForRun } from "./skills.js";
import { buildAgentSystemPrompt } from "./system-prompt.js";

const SPIRA_BASE_URL = "https://mock-spira.test";

const tempDirs: string[] = [];
let envSnapshot: ReturnType<typeof captureEnv> | undefined;

type AvailableSkill = {
  name: string;
  description: string;
  location: string;
};

function createWorkflowCatalog(): WorkflowCatalogEntry[] {
  return [
    {
      id: "workflow-product-brief",
      title: "Product Brief",
      summary: "Generate a TikTok product launch brief.",
      requiredInputs: ["topic", "audience"],
      inputSchema: {
        type: "object",
        required: ["topic", "audience"],
        additionalProperties: false,
        properties: {
          topic: { type: "string" },
          audience: { type: "string" },
        },
      },
      outputSchema: {
        brief: { type: "string" },
      },
      attributes: {
        goal: "product_brief",
        platform: "tiktok",
      },
      enabled: true,
      version: "v1",
    },
  ];
}

function buildSpiraPluginRawConfig() {
  return {
    workflows: {
      baseUrl: SPIRA_BASE_URL,
      runPath: "/api/workflows/runs",
      statusPathTemplate: "/api/workflows/runs/{runId}",
      catalog: createWorkflowCatalog(),
    },
    media: {
      defaultProviderOrder: ["spira"],
      spira: {
        enabled: true,
        baseUrl: SPIRA_BASE_URL,
        runPath: "/api/workflows/runs",
        actions: {
          text_to_image: { workflowId: "media-text-to-image" },
        },
      },
      viralWellTools: {
        enabled: false,
      },
    },
    publish: {
      enabled: false,
    },
  };
}

function buildSkillsConfig(): OpenClawConfig {
  return {
    plugins: {
      allow: ["spira"],
      slots: { memory: "none" },
      entries: {
        spira: {
          enabled: true,
          config: buildSpiraPluginRawConfig(),
        },
      },
    },
  };
}

function createResolvedSpiraConfig() {
  return resolveSpiraPluginConfig(buildSpiraPluginRawConfig());
}

async function makeTempWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-spira-skills-"));
  tempDirs.push(dir);
  return dir;
}

function parseAvailableSkills(promptText: string): AvailableSkill[] {
  const matches = promptText.matchAll(
    /<skill>\s*<name>([^<]+)<\/name>\s*<description>([^<]*)<\/description>\s*<location>([^<]+)<\/location>\s*<\/skill>/g,
  );
  return Array.from(matches, (match) => ({
    name: match[1]?.trim() ?? "",
    description: match[2]?.trim() ?? "",
    location: match[3]?.trim() ?? "",
  })).filter((skill) => skill.name && skill.location);
}

function scoreSkillSelection(userPrompt: string, skill: AvailableSkill): number {
  const prompt = userPrompt.toLowerCase();
  const haystack = `${skill.name} ${skill.description}`.toLowerCase();
  const keywords = prompt.match(/[a-z_]{4,}/g) ?? [];
  let score = 0;
  for (const keyword of new Set(keywords)) {
    if (haystack.includes(keyword)) {
      score += 1;
    }
  }
  if (prompt.includes("workflow") && haystack.includes("workflow")) {
    score += 3;
  }
  if (
    ["image", "cover", "poster", "thumbnail", "video"].some((keyword) =>
      prompt.includes(keyword),
    ) &&
    ["media", "image", "video"].some((keyword) => haystack.includes(keyword))
  ) {
    score += 3;
  }
  return score;
}

function selectSkillForPrompt(userPrompt: string, skills: AvailableSkill[]): AvailableSkill {
  const ranked = [...skills].sort(
    (left, right) => scoreSkillSelection(userPrompt, right) - scoreSkillSelection(userPrompt, left),
  );
  const selected = ranked[0];
  if (!selected) {
    throw new Error("no available skills to select from");
  }
  return selected;
}

function extractSkillToolName(skillBody: string): string {
  const match = skillBody.match(/Use `([^`]+)`/);
  if (!match?.[1]) {
    throw new Error("skill body does not declare a tool name");
  }
  return match[1];
}

function parseToolPayload(result: unknown): Record<string, unknown> {
  const content = (result as { content?: Array<{ text?: string }> } | undefined)?.content;
  const text = content?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error("missing tool text result");
  }
  return JSON.parse(text) as Record<string, unknown>;
}

function createBackendFetchMock() {
  const requests: Array<{ url: string; body: Record<string, unknown> | null }> = [];

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.startsWith(SPIRA_BASE_URL)) {
      throw new Error(`unexpected fetch url: ${url}`);
    }

    const bodyText =
      typeof (init as { body?: unknown } | undefined)?.body === "undefined"
        ? ""
        : String((init as { body?: unknown }).body ?? "");
    const body =
      bodyText.trim().length > 0 ? (JSON.parse(bodyText) as Record<string, unknown>) : null;
    requests.push({ url, body });

    if (url === `${SPIRA_BASE_URL}/api/workflows/runs`) {
      const workflowId = typeof body?.workflowId === "string" ? body.workflowId : "unknown";
      return Response.json({
        runId: `run-${workflowId}`,
        status: "queued",
        createdAt: 1_710_000_000,
      });
    }

    if (url.startsWith(`${SPIRA_BASE_URL}/api/workflows/runs/`)) {
      return Response.json({
        runId: url.split("/").at(-1),
        status: "succeeded",
      });
    }

    throw new Error(`unexpected Spira backend request: ${url}`);
  };

  return {
    fetchImpl,
    requests,
  };
}

async function setupSpiraSkillContext(userPrompt: string) {
  envSnapshot = captureEnv(["HOME"]);
  const tempHome = await makeTempWorkspace();
  process.env.HOME = tempHome;

  const workspaceDir = await makeTempWorkspace();
  const config = buildSkillsConfig();
  const entries = loadWorkspaceSkillEntries(workspaceDir, { config });
  const skillsPrompt = resolveSkillsPromptForRun({
    entries,
    config,
    workspaceDir,
  });
  const systemPrompt = buildAgentSystemPrompt({
    workspaceDir,
    skillsPrompt,
    toolNames: ["Read", "spira_workflow", "spira_media"],
  });
  const availableSkills = parseAvailableSkills(systemPrompt);
  const selectedSkill = selectSkillForPrompt(userPrompt, availableSkills);
  const skillBody = await fs.readFile(selectedSkill.location, "utf8");

  return {
    workspaceDir,
    config,
    systemPrompt,
    selectedSkill,
    skillBody,
    selectedToolName: extractSkillToolName(skillBody),
  };
}

afterEach(async () => {
  clearPluginManifestRegistryCache();
  envSnapshot?.restore();
  envSnapshot = undefined;
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("spira skills prompt routing", () => {
  it("routes a workflow-style prompt through workflow-runner into spira_workflow", async () => {
    const userPrompt =
      "Use a fixed workflow to create a TikTok product brief about AI founder tips for startup operators.";
    const context = await setupSpiraSkillContext(userPrompt);

    expect(context.systemPrompt).toContain("If exactly one skill clearly applies");
    expect(context.selectedSkill.name).toBe("workflow-runner");
    expect(context.selectedSkill.location.replaceAll("\\", "/")).toContain(
      "extensions/spira/skills/workflow-runner/SKILL.md",
    );
    expect(context.selectedToolName).toBe("spira_workflow");

    const backend = createBackendFetchMock();
    const tool = createSpiraWorkflowTool({
      config: createResolvedSpiraConfig(),
      agentId: "agent-influencer-1",
      fetchImpl: backend.fetchImpl,
    });

    const listPayload = parseToolPayload(
      await tool.execute("call-list", {
        action: "list",
        context: {
          goal: "product_brief",
          platform: "tiktok",
        },
      }),
    );
    expect(Array.isArray(listPayload.workflows)).toBe(true);
    expect((listPayload.workflows as Array<{ id?: string }>)[0]?.id).toBe("workflow-product-brief");

    const runPayload = parseToolPayload(
      await tool.execute("call-run", {
        action: "run",
        workflowId: "workflow-product-brief",
        inputs: {
          topic: "AI founder tips",
          audience: "startup operators",
        },
      }),
    );
    expect(runPayload.runId).toBe("run-workflow-product-brief");
    expect(
      backend.requests.some(
        (entry) =>
          entry.url === `${SPIRA_BASE_URL}/api/workflows/runs` &&
          entry.body?.workflowId === "workflow-product-brief",
      ),
    ).toBe(true);
  });

  it("routes an image-style prompt through media-basic into spira_media", async () => {
    const userPrompt =
      "Generate a clean cover image for a TikTok post about AI founder tips and make it look polished.";
    const context = await setupSpiraSkillContext(userPrompt);

    expect(context.systemPrompt).toContain("If exactly one skill clearly applies");
    expect(context.selectedSkill.name).toBe("media-basic");
    expect(context.selectedSkill.location.replaceAll("\\", "/")).toContain(
      "extensions/spira/skills/media-basic/SKILL.md",
    );
    expect(context.selectedToolName).toBe("spira_media");

    const backend = createBackendFetchMock();
    const tool = createSpiraMediaTool({
      config: createResolvedSpiraConfig(),
      agentId: "agent-influencer-1",
      fetchImpl: backend.fetchImpl,
    });

    const mediaPayload = parseToolPayload(
      await tool.execute("call-media", {
        action: "text_to_image",
        prompt: "A clean TikTok cover image about AI founder tips",
      }),
    );
    expect(mediaPayload.provider).toBe("spira");
    expect(mediaPayload.workflowId).toBe("media-text-to-image");
    expect(mediaPayload.runId).toBe("run-media-text-to-image");
    expect(
      backend.requests.some(
        (entry) =>
          entry.url === `${SPIRA_BASE_URL}/api/workflows/runs` &&
          entry.body?.workflowId === "media-text-to-image",
      ),
    ).toBe(true);
  });
});
