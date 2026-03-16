import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import {
  beginWebhookRequestPipelineOrReject,
  readJsonWebhookBodyOrReject,
  type OpenClawConfig,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk";
import { resolveAgentDir } from "../../src/agents/agent-scope.js";
import { DEFAULT_IDENTITY_FILENAME, ensureAgentWorkspace } from "../../src/agents/workspace.js";
import {
  applyAgentBindings,
  describeBinding,
  parseBindingSpecs,
} from "../../src/commands/agents.bindings.js";
import {
  applyAgentConfig,
  buildAgentSummaries,
  findAgentEntryIndex,
  listAgentEntries,
} from "../../src/commands/agents.config.js";
import { isRouteBinding, listRouteBindings } from "../../src/config/bindings.js";
import { resolveStateDir } from "../../src/config/paths.js";
import { resolveSessionTranscriptsDirForAgent } from "../../src/config/sessions/paths.js";
import { normalizeAgentId } from "../../src/routing/session-key.js";
import { resolveUserPath } from "../../src/utils.js";

type AgentProvisionerPluginConfig = {
  path?: string;
};

type AgentUpsertBody = {
  id?: string;
  name?: string;
  emoji?: string;
  avatar?: string;
  workspace?: string;
  agentDir?: string;
  model?: string;
  bindings?: string[];
};

type AgentRecord = {
  id: string;
  name: string;
  workspace: string;
  agentDir: string;
  model?: string;
  emoji?: string;
  avatar?: string;
  bindings: string[];
};

type ProvisionResult = {
  ok: true;
  created: boolean;
  updated: boolean;
  agent: AgentRecord;
};

const DEFAULT_ROUTE_PATH = "/plugins/agent-provisioner/agents";

function respondJson(res: ServerResponse, statusCode: number, body: unknown): true {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(body, null, 2)}\n`);
  return true;
}

function sanitizeIdentityLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

async function upsertIdentityFile(params: {
  workspaceDir: string;
  name: string;
  emoji?: string;
  avatar?: string;
}): Promise<void> {
  const identityPath = path.join(params.workspaceDir, DEFAULT_IDENTITY_FILENAME);
  let content = "";
  try {
    content = await fs.readFile(identityPath, "utf8");
  } catch {
    content = "";
  }

  let next = content;
  for (const [label, rawValue] of [
    ["Name", params.name],
    ["Emoji", params.emoji],
    ["Avatar", params.avatar],
  ] as const) {
    const value = rawValue?.trim();
    if (!value) {
      continue;
    }
    const safeValue = sanitizeIdentityLine(value);
    const line = `- ${label}: ${safeValue}`;
    const pattern = new RegExp(`(^|\\n)-\\s*${label}:.*(?=\\n|$)`, "i");
    if (pattern.test(next)) {
      next = next.replace(pattern, (_match, prefix: string) => `${prefix}${line}`);
    } else {
      next = `${next.replace(/\s*$/, "")}${next.trim() ? "\n" : ""}${line}\n`;
    }
  }

  await fs.mkdir(params.workspaceDir, { recursive: true });
  await fs.writeFile(identityPath, next.trimEnd() + "\n", "utf8");
}

function getRequestPath(req: IncomingMessage): string {
  const raw = req.url ?? "/";
  const pathname = raw.split("?", 1)[0] ?? "/";
  return pathname.endsWith("/") && pathname !== "/" ? pathname.slice(0, -1) : pathname;
}

function resolveRoute(params: {
  req: IncomingMessage;
  basePath: string;
}): { collection: true; agentId?: undefined } | { collection: false; agentId: string } | null {
  const pathname = getRequestPath(params.req);
  if (pathname === params.basePath) {
    return { collection: true };
  }
  const prefix = `${params.basePath}/`;
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const suffix = pathname.slice(prefix.length).trim();
  if (!suffix || suffix.includes("/")) {
    return null;
  }
  return { collection: false, agentId: normalizeAgentId(decodeURIComponent(suffix)) };
}

function buildDefaultWorkspace(agentId: string): string {
  return resolveUserPath(path.join(resolveStateDir(process.env), `workspace-${agentId}`));
}

function replaceAgentBindings(params: { cfg: OpenClawConfig; agentId: string; specs?: string[] }): {
  config: OpenClawConfig;
  bindings: string[];
} {
  if (!params.specs) {
    const bindings = listRouteBindings(params.cfg)
      .filter((binding) => normalizeAgentId(binding.agentId) === params.agentId)
      .map((binding) => describeBinding(binding));
    return { config: params.cfg, bindings };
  }

  const parsed = parseBindingSpecs({
    agentId: params.agentId,
    specs: params.specs,
    config: params.cfg,
  });
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.join("\n"));
  }

  const preservedBindings = (params.cfg.bindings ?? []).filter((binding) => {
    if (!isRouteBinding(binding)) {
      return true;
    }
    return normalizeAgentId(binding.agentId) !== params.agentId;
  });
  const baseConfig = {
    ...params.cfg,
    bindings: preservedBindings.length > 0 ? preservedBindings : undefined,
  };
  const result = applyAgentBindings(baseConfig, parsed.bindings);
  if (result.conflicts.length > 0) {
    const details = result.conflicts
      .map((conflict) => `${describeBinding(conflict.binding)} (agent=${conflict.existingAgentId})`)
      .join(", ");
    throw new Error(`Binding conflict: ${details}`);
  }
  return {
    config: result.config,
    bindings: parsed.bindings.map((binding) => describeBinding(binding)),
  };
}

function buildAgentRecord(cfg: OpenClawConfig, agentId: string): AgentRecord | null {
  const summary = buildAgentSummaries(cfg).find((entry) => entry.id === agentId);
  if (!summary) {
    return null;
  }
  const entry = listAgentEntries(cfg)[findAgentEntryIndex(listAgentEntries(cfg), agentId)];
  const bindings = listRouteBindings(cfg)
    .filter((binding) => normalizeAgentId(binding.agentId) === agentId)
    .map((binding) => describeBinding(binding));
  return {
    id: agentId,
    name: summary.name ?? agentId,
    workspace: summary.workspace,
    agentDir: summary.agentDir,
    ...(summary.model ? { model: summary.model } : {}),
    ...(entry?.identity?.emoji?.trim() ? { emoji: entry.identity.emoji.trim() } : {}),
    ...(entry?.identity?.avatar?.trim() ? { avatar: entry.identity.avatar.trim() } : {}),
    bindings,
  };
}

async function upsertAgent(params: {
  cfg: OpenClawConfig;
  body: AgentUpsertBody;
  agentId: string;
  writeConfigFile: OpenClawPluginApi["runtime"]["config"]["writeConfigFile"];
}): Promise<ProvisionResult> {
  const existingEntries = listAgentEntries(params.cfg);
  const existingIndex = findAgentEntryIndex(existingEntries, params.agentId);
  const existingAgent = existingIndex >= 0 ? existingEntries[existingIndex] : undefined;
  const created = existingIndex < 0;
  const name = params.body.name?.trim() || existingAgent?.name?.trim() || params.agentId;
  const workspaceDir = params.body.workspace?.trim()
    ? resolveUserPath(params.body.workspace.trim())
    : existingAgent?.workspace?.trim()
      ? resolveUserPath(existingAgent.workspace.trim())
      : buildDefaultWorkspace(params.agentId);
  const agentDir = params.body.agentDir?.trim()
    ? resolveUserPath(params.body.agentDir.trim())
    : existingAgent?.agentDir?.trim()
      ? resolveUserPath(existingAgent.agentDir.trim())
      : resolveAgentDir(params.cfg, params.agentId);

  let nextConfig = applyAgentConfig(params.cfg, {
    agentId: params.agentId,
    name,
    workspace: workspaceDir,
    agentDir,
    ...(params.body.model?.trim() ? { model: params.body.model.trim() } : {}),
  });

  const bindingResult = replaceAgentBindings({
    cfg: nextConfig,
    agentId: params.agentId,
    specs: params.body.bindings,
  });
  nextConfig = bindingResult.config;

  await params.writeConfigFile(nextConfig);
  await ensureAgentWorkspace({
    dir: workspaceDir,
    ensureBootstrapFiles: !nextConfig.agents?.defaults?.skipBootstrap,
  });
  await fs.mkdir(resolveSessionTranscriptsDirForAgent(params.agentId), { recursive: true });
  await upsertIdentityFile({
    workspaceDir,
    name,
    ...(params.body.emoji?.trim() ? { emoji: params.body.emoji } : {}),
    ...(params.body.avatar?.trim() ? { avatar: params.body.avatar } : {}),
  });

  const record = buildAgentRecord(nextConfig, params.agentId);
  if (!record) {
    throw new Error(`Failed to load agent "${params.agentId}" after sync.`);
  }
  if (params.body.bindings) {
    record.bindings = bindingResult.bindings;
  }

  return {
    ok: true,
    created,
    updated: !created,
    agent: record,
  };
}

function removeAgent(cfg: OpenClawConfig, agentId: string): OpenClawConfig {
  const nextAgents = listAgentEntries(cfg).filter(
    (entry) => normalizeAgentId(entry.id) !== agentId,
  );
  const nextBindings = (cfg.bindings ?? []).filter(
    (binding) => normalizeAgentId(binding.agentId) !== agentId,
  );
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      list: nextAgents.length > 0 ? nextAgents : undefined,
    },
    bindings: nextBindings.length > 0 ? nextBindings : undefined,
  };
}

async function readJsonBody<T>(params: {
  req: IncomingMessage;
  res: ServerResponse;
}): Promise<T | null> {
  const bodyResult = await readJsonWebhookBodyOrReject({
    req: params.req,
    res: params.res,
    profile: "post-auth",
  });
  if (!bodyResult.ok) {
    return null;
  }
  return bodyResult.value as T;
}

function createAgentProvisionerHandler(params: {
  logger: OpenClawPluginApi["logger"];
  basePath: string;
  loadConfig: OpenClawPluginApi["runtime"]["config"]["loadConfig"];
  writeConfigFile: OpenClawPluginApi["runtime"]["config"]["writeConfigFile"];
}): Parameters<OpenClawPluginApi["registerHttpRoute"]>[0]["handler"] {
  return async (req, res) => {
    const route = resolveRoute({ req, basePath: params.basePath });
    if (!route) {
      return false;
    }

    const method = req.method ?? "GET";
    const needsBody = method === "POST" || method === "PUT";
    const pipeline = beginWebhookRequestPipelineOrReject({
      req,
      res,
      allowMethods: ["GET", "POST", "PUT", "DELETE"],
      requireJsonContentType: needsBody,
    });
    if (!pipeline.ok) {
      return true;
    }

    try {
      const cfg = params.loadConfig();
      if (method === "GET" && route.collection) {
        const agents = buildAgentSummaries(cfg)
          .map((summary) => buildAgentRecord(cfg, summary.id))
          .filter((record): record is AgentRecord => Boolean(record));
        return respondJson(res, 200, { ok: true, agents });
      }

      if (method === "GET" && !route.collection) {
        const agent = buildAgentRecord(cfg, route.agentId);
        if (!agent) {
          return respondJson(res, 404, { ok: false, error: "agent_not_found" });
        }
        return respondJson(res, 200, { ok: true, agent });
      }

      if (method === "POST" && route.collection) {
        const body = await readJsonBody<AgentUpsertBody>({ req, res });
        if (!body) {
          return true;
        }
        const agentId = normalizeAgentId(body.id ?? "");
        if (!agentId) {
          return respondJson(res, 400, { ok: false, error: "id is required" });
        }
        const result = await upsertAgent({
          cfg,
          body,
          agentId,
          writeConfigFile: params.writeConfigFile,
        });
        params.logger.info(`agent-provisioner: created agent "${result.agent.id}"`);
        return respondJson(res, 201, result);
      }

      if (method === "PUT" && !route.collection) {
        const body = await readJsonBody<AgentUpsertBody>({ req, res });
        if (!body) {
          return true;
        }
        const result = await upsertAgent({
          cfg,
          body,
          agentId: route.agentId,
          writeConfigFile: params.writeConfigFile,
        });
        params.logger.info(
          `agent-provisioner: ${result.created ? "created" : "updated"} agent "${result.agent.id}"`,
        );
        return respondJson(res, result.created ? 201 : 200, result);
      }

      if (method === "DELETE" && !route.collection) {
        const agent = buildAgentRecord(cfg, route.agentId);
        if (!agent) {
          return respondJson(res, 404, { ok: false, error: "agent_not_found" });
        }
        const nextConfig = removeAgent(cfg, route.agentId);
        await params.writeConfigFile(nextConfig);
        params.logger.info(`agent-provisioner: deleted agent "${route.agentId}"`);
        return respondJson(res, 200, { ok: true, deleted: true, agentId: route.agentId });
      }

      return respondJson(res, 404, { ok: false, error: "not_found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      params.logger.warn(`agent-provisioner: request failed (${message})`);
      return respondJson(res, 400, { ok: false, error: message });
    } finally {
      pipeline.release();
    }
  };
}

const plugin: {
  id: string;
  name: string;
  description: string;
  register: (api: OpenClawPluginApi) => void;
} = {
  id: "agent-provisioner",
  name: "Agent Provisioner",
  description: "Expose HTTP endpoints that sync OpenClaw agents.",
  register(api: OpenClawPluginApi) {
    const pluginConfig = (api.pluginConfig ?? {}) as AgentProvisionerPluginConfig;
    const basePath = pluginConfig.path?.trim() || DEFAULT_ROUTE_PATH;

    api.registerHttpRoute({
      path: basePath,
      match: "prefix",
      auth: "gateway",
      handler: createAgentProvisionerHandler({
        logger: api.logger,
        basePath,
        loadConfig: api.runtime.config.loadConfig,
        writeConfigFile: api.runtime.config.writeConfigFile,
      }),
    });

    api.logger.info(`agent-provisioner: route registered at ${basePath} (gateway-authenticated)`);
  },
};

export const __testing = {
  buildAgentRecord,
  createAgentProvisionerHandler,
  resolveRoute,
  upsertIdentityFile,
};

export default plugin;
