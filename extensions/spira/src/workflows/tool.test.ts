import { describe, expect, it, vi } from "vitest";
import { resolveSpiraPluginConfig } from "../config.js";
import { filterWorkflowsForAgentWithRules, isWorkflowAllowedForAgentWithRules } from "./policy.js";
import { createSpiraWorkflowTool } from "./tool.js";

describe("spira_workflow tool", () => {
  const config = resolveSpiraPluginConfig({
    workflows: {
      baseUrl: "https://spira.example.com",
      catalog: [
        {
          id: "wf-image-video",
          title: "Image To Video",
          summary: "Turn images into a short video",
          requiredInputs: ["images", "prompt"],
          inputSchema: {
            type: "object",
            required: ["images", "prompt"],
            additionalProperties: false,
            properties: {
              images: { type: "array" },
              prompt: { type: "string" },
            },
          },
          outputSchema: { videoUrl: { type: "string" } },
          attributes: { platform: ["tiktok"], hasImage: true },
          enabled: true,
        },
        {
          id: "wf-caption",
          title: "Caption Video",
          summary: "Add captions to a video",
          requiredInputs: ["video"],
          inputSchema: {
            type: "object",
            required: ["video"],
            additionalProperties: false,
            properties: {
              video: { type: "string" },
            },
          },
          outputSchema: { videoUrl: { type: "string" } },
          attributes: { hasVideo: true },
          enabled: true,
        },
      ],
    },
  });

  it("lists workflows filtered by context", async () => {
    const tool = createSpiraWorkflowTool({ config, agentId: "influencer-a" });
    const result = (await tool.execute("call-1", {
      action: "list",
      context: { platform: "tiktok", hasImage: true },
    })) as { details: { workflows: Array<{ id: string }> } };

    expect(result.details.workflows.map((entry) => entry.id)).toEqual(["wf-image-video"]);
  });

  it("describes a workflow from the local catalog", async () => {
    const tool = createSpiraWorkflowTool({ config });
    const result = (await tool.execute("call-1", {
      action: "describe",
      workflowId: "wf-caption",
    })) as { details: { workflow: { id: string; requiredInputs: string[] } } };

    expect(result.details.workflow.id).toBe("wf-caption");
    expect(result.details.workflow.requiredInputs).toEqual(["video"]);
  });

  it("starts a workflow run with the current agent id fallback", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 201,
      statusText: "Created",
      text: async () => JSON.stringify({ runId: "run-1", status: "running", createdAt: 123 }),
    })) as unknown as typeof fetch;

    const tool = createSpiraWorkflowTool({ config, agentId: "influencer-a", fetchImpl });
    const result = (await tool.execute("call-1", {
      action: "run",
      workflowId: "wf-image-video",
      inputs: { images: ["https://example.com/a.png"], prompt: "Launch video" },
    })) as { details: { agentId: string; runId: string; runStatus: string } };

    expect(result.details.agentId).toBe("influencer-a");
    expect(result.details.runId).toBe("run-1");
    expect(result.details.runStatus).toBe("running");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects missing required inputs before starting a run", async () => {
    const fetchImpl = vi.fn();
    const tool = createSpiraWorkflowTool({
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      tool.execute("call-1", {
        action: "run",
        workflowId: "wf-image-video",
        inputs: { images: ["https://example.com/a.png"] },
      }),
    ).rejects.toThrow("missing required input: prompt");

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects unexpected input fields when additionalProperties is false", async () => {
    const fetchImpl = vi.fn();
    const tool = createSpiraWorkflowTool({
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      tool.execute("call-1", {
        action: "run",
        workflowId: "wf-caption",
        inputs: {
          video: "https://example.com/a.mp4",
          extra: "nope",
        },
      }),
    ).rejects.toThrow("unexpected input field: extra");

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects invalid input types from the workflow schema", async () => {
    const fetchImpl = vi.fn();
    const tool = createSpiraWorkflowTool({
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      tool.execute("call-1", {
        action: "run",
        workflowId: "wf-caption",
        inputs: {
          video: 123,
        },
      }),
    ).rejects.toThrow("invalid input type for video: expected string, got number");

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("exposes a simple agent filtering hook with default allow-all behavior", () => {
    const workflows = config.workflows.catalog;
    expect(filterWorkflowsForAgentWithRules("alpha", workflows)).toHaveLength(2);
    expect(isWorkflowAllowedForAgentWithRules("alpha", "wf-image-video", workflows)).toBe(true);
  });

  it("supports deny rules when they are later added", () => {
    const workflows = config.workflows.catalog;
    const rules = { alpha: ["wf-caption"] };
    expect(
      filterWorkflowsForAgentWithRules("alpha", workflows, rules).map((entry) => entry.id),
    ).toEqual(["wf-image-video"]);
    expect(isWorkflowAllowedForAgentWithRules("alpha", "wf-caption", workflows, rules)).toBe(false);
  });
});
