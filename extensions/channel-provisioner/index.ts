import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import {
  beginWebhookRequestPipelineOrReject,
  emptyPluginConfigSchema,
  readJsonWebhookBodyOrReject,
  addWildcardAllowFrom,
  applyAgentBindings,
  applyChannelAccountConfig,
  buildChannelAccountSnapshot,
  defaultRuntime,
  DEFAULT_ACCOUNT_ID,
  describeBinding,
  deleteTelegramUpdateOffset,
  getChannelPlugin,
  listChannelPlugins,
  moveSingleAccountChannelSectionToDefaultAccount,
  normalizeAccountId,
  normalizeChannelId,
  patchScopedAccountConfig,
  resolveTelegramAccount,
  type ChannelResolveKind,
  type ChannelResolveResult,
  type ChannelSetupInput,
  type OpenClawConfig,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/channel-provisioner";

type ChannelAccountMutationBody = {
  channel: string;
  accountId?: string;
  agentId?: string;
  config?: Record<string, unknown>;
};

type ChannelAccountRecord = {
  accountId: string;
  channel: string;
  label: string;
  configured?: boolean;
  enabled?: boolean;
  linked?: boolean;
  tokenSource?: string;
  botTokenSource?: string;
  appTokenSource?: string;
  webhookPath?: string;
  webhookUrl?: string;
  baseUrl?: string;
};

type ChannelRecord = {
  id: string;
  label: string;
  accounts: ChannelAccountRecord[];
};

type ChannelBindingRecord = {
  agentId: string;
  description: string;
};

type ChannelsRoute =
  | { kind: "collection" }
  | { kind: "status" }
  | { kind: "resolve" }
  | { kind: "accounts" }
  | { kind: "account"; accountId: string };

const DEFAULT_ROUTE_PATH = "/plugins/channel-provisioner/channels";

function respondJson(res: ServerResponse, statusCode: number, body: unknown): true {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(body, null, 2)}\n`);
  return true;
}

function getRequestPath(req: IncomingMessage): string {
  const raw = req.url ?? "/";
  const pathname = raw.split("?", 1)[0] ?? "/";
  return pathname.endsWith("/") && pathname !== "/" ? pathname.slice(0, -1) : pathname;
}

function getRequestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", "http://localhost");
}

function resolveChannelsRoute(params: {
  req: IncomingMessage;
  basePath: string;
}): ChannelsRoute | null {
  const pathname = getRequestPath(params.req);
  if (pathname === params.basePath) {
    return { kind: "collection" };
  }
  if (pathname === `${params.basePath}/status`) {
    return { kind: "status" };
  }
  if (pathname === `${params.basePath}/resolve`) {
    return { kind: "resolve" };
  }
  const prefix = `${params.basePath}/`;
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const parts = pathname
    .slice(prefix.length)
    .split("/")
    .map((part) => decodeURIComponent(part).trim())
    .filter(Boolean);
  if (parts.length === 1 && parts[0] === "accounts") {
    return { kind: "accounts" };
  }
  if (parts.length === 2 && parts[0] === "accounts") {
    return { kind: "account", accountId: normalizeAccountId(parts[1]) };
  }
  return null;
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

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pickBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function pickNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function pickStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const list = value
      .map((entry) => pickString(entry))
      .filter((entry): entry is string => Boolean(entry));
    return list.length > 0 ? list : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    const list = value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    return list.length > 0 ? list : undefined;
  }
  return undefined;
}

function buildChannelSetupInput(config: Record<string, unknown> = {}): ChannelSetupInput {
  return {
    ...(pickString(config.dmPolicy)
      ? { dmPolicy: pickString(config.dmPolicy) as ChannelSetupInput["dmPolicy"] }
      : {}),
    ...(pickString(config.token) ? { token: pickString(config.token) } : {}),
    ...(pickString(config.tokenFile) ? { tokenFile: pickString(config.tokenFile) } : {}),
    ...(pickString(config.botToken) ? { botToken: pickString(config.botToken) } : {}),
    ...(pickString(config.appToken) ? { appToken: pickString(config.appToken) } : {}),
    ...(pickString(config.signalNumber) ? { signalNumber: pickString(config.signalNumber) } : {}),
    ...(pickString(config.cliPath) ? { cliPath: pickString(config.cliPath) } : {}),
    ...(pickString(config.dbPath) ? { dbPath: pickString(config.dbPath) } : {}),
    ...(pickString(config.service)
      ? { service: pickString(config.service) as ChannelSetupInput["service"] }
      : {}),
    ...(pickString(config.region) ? { region: pickString(config.region) } : {}),
    ...(pickString(config.authDir) ? { authDir: pickString(config.authDir) } : {}),
    ...(pickString(config.httpUrl) ? { httpUrl: pickString(config.httpUrl) } : {}),
    ...(pickString(config.httpHost) ? { httpHost: pickString(config.httpHost) } : {}),
    ...(pickString(config.httpPort) ? { httpPort: pickString(config.httpPort) } : {}),
    ...(pickString(config.webhookPath) ? { webhookPath: pickString(config.webhookPath) } : {}),
    ...(pickString(config.webhookUrl) ? { webhookUrl: pickString(config.webhookUrl) } : {}),
    ...(pickString(config.audienceType) ? { audienceType: pickString(config.audienceType) } : {}),
    ...(pickString(config.audience) ? { audience: pickString(config.audience) } : {}),
    ...(pickBoolean(config.useEnv) !== undefined ? { useEnv: pickBoolean(config.useEnv) } : {}),
    ...(pickString(config.homeserver) ? { homeserver: pickString(config.homeserver) } : {}),
    ...(pickString(config.userId) ? { userId: pickString(config.userId) } : {}),
    ...(pickString(config.accessToken) ? { accessToken: pickString(config.accessToken) } : {}),
    ...(pickString(config.password) ? { password: pickString(config.password) } : {}),
    ...(pickString(config.deviceName) ? { deviceName: pickString(config.deviceName) } : {}),
    ...(pickNumber(config.initialSyncLimit) !== undefined
      ? { initialSyncLimit: pickNumber(config.initialSyncLimit) }
      : {}),
    ...(pickString(config.ship) ? { ship: pickString(config.ship) } : {}),
    ...(pickString(config.url) ? { url: pickString(config.url) } : {}),
    ...(pickString(config.code) ? { code: pickString(config.code) } : {}),
    ...(pickStringList(config.groupChannels)
      ? { groupChannels: pickStringList(config.groupChannels) }
      : {}),
    ...(pickStringList(config.dmAllowlist)
      ? { dmAllowlist: pickStringList(config.dmAllowlist) }
      : {}),
    ...(pickBoolean(config.autoDiscoverChannels) !== undefined
      ? { autoDiscoverChannels: pickBoolean(config.autoDiscoverChannels) }
      : {}),
  };
}

function buildChannelAccountRecord(params: {
  channel: string;
  label: string;
  snapshot: Awaited<ReturnType<typeof buildChannelAccountSnapshot>>;
}): ChannelAccountRecord {
  const { snapshot } = params;
  return {
    accountId: snapshot.accountId,
    channel: params.channel,
    label: params.label,
    ...(typeof snapshot.configured === "boolean" ? { configured: snapshot.configured } : {}),
    ...(typeof snapshot.enabled === "boolean" ? { enabled: snapshot.enabled } : {}),
    ...(typeof snapshot.linked === "boolean" ? { linked: snapshot.linked } : {}),
    ...(snapshot.tokenSource ? { tokenSource: snapshot.tokenSource } : {}),
    ...(snapshot.botTokenSource ? { botTokenSource: snapshot.botTokenSource } : {}),
    ...(snapshot.appTokenSource ? { appTokenSource: snapshot.appTokenSource } : {}),
    ...(snapshot.webhookPath ? { webhookPath: snapshot.webhookPath } : {}),
    ...(snapshot.webhookUrl ? { webhookUrl: snapshot.webhookUrl } : {}),
    ...(snapshot.baseUrl ? { baseUrl: snapshot.baseUrl } : {}),
  };
}

async function buildChannelRecord(params: {
  cfg: OpenClawConfig;
  channel: string;
}): Promise<ChannelRecord | null> {
  const plugin = getChannelPlugin(params.channel);
  if (!plugin) {
    return null;
  }
  const accounts: ChannelAccountRecord[] = [];
  for (const accountId of plugin.config.listAccountIds(params.cfg)) {
    const snapshot = await buildChannelAccountSnapshot({
      plugin,
      cfg: params.cfg,
      accountId,
    });
    accounts.push(
      buildChannelAccountRecord({
        channel: plugin.id,
        label: plugin.meta.label ?? plugin.id,
        snapshot,
      }),
    );
  }
  return {
    id: plugin.id,
    label: plugin.meta.label ?? plugin.id,
    accounts,
  };
}

function readScopedAllowFrom(params: {
  cfg: OpenClawConfig;
  channel: string;
  accountId: string;
}): Array<string | number> | undefined {
  const channelConfig = params.cfg.channels?.[params.channel] as
    | {
        allowFrom?: Array<string | number>;
        accounts?: Record<string, { allowFrom?: Array<string | number> }>;
      }
    | undefined;
  if (params.accountId === DEFAULT_ACCOUNT_ID) {
    return channelConfig?.allowFrom;
  }
  return channelConfig?.accounts?.[params.accountId]?.allowFrom;
}

function applyProvisionedDmPolicy(params: {
  cfg: OpenClawConfig;
  channel: string;
  accountId: string;
  dmPolicy: NonNullable<ChannelSetupInput["dmPolicy"]>;
}): OpenClawConfig {
  const existingAllowFrom = readScopedAllowFrom(params);
  const allowFrom =
    params.dmPolicy === "open" ? addWildcardAllowFrom(existingAllowFrom) : existingAllowFrom;
  return patchScopedAccountConfig({
    cfg: params.cfg,
    channelKey: params.channel,
    accountId: params.accountId,
    patch: {
      dmPolicy: params.dmPolicy,
      ...(allowFrom ? { allowFrom } : {}),
    },
  });
}

async function buildChannelsStatus(cfg: OpenClawConfig): Promise<ChannelRecord[]> {
  const records = await Promise.all(
    listChannelPlugins().map(
      async (plugin) => await buildChannelRecord({ cfg, channel: plugin.id }),
    ),
  );
  return records.filter((record): record is ChannelRecord => record !== null);
}

async function readChannelMutationBody(params: {
  req: IncomingMessage;
  res: ServerResponse;
}): Promise<{ body: ChannelAccountMutationBody; channel: string } | null> {
  const body = await readJsonBody<ChannelAccountMutationBody>(params);
  if (!body) {
    return null;
  }
  const channel = normalizeChannelId(body.channel);
  if (!channel) {
    respondJson(params.res, 400, { ok: false, error: "channel is required" });
    return null;
  }
  return { body, channel };
}

async function upsertChannelAccount(params: {
  cfg: OpenClawConfig;
  channel: string;
  accountId: string;
  body: ChannelAccountMutationBody;
  writeConfigFile: OpenClawPluginApi["runtime"]["config"]["writeConfigFile"];
}): Promise<{
  ok: true;
  created: boolean;
  updated: boolean;
  account: ChannelAccountRecord;
  binding?: ChannelBindingRecord;
}> {
  const plugin = getChannelPlugin(params.channel);
  if (!plugin) {
    throw new Error(`Unknown channel "${params.channel}".`);
  }
  if (!plugin.setup?.applyAccountConfig) {
    throw new Error(`Channel ${params.channel} does not support account upsert.`);
  }

  const existingIds = new Set(plugin.config.listAccountIds(params.cfg));
  const created = !existingIds.has(params.accountId);
  let nextConfig = params.cfg;
  const input = buildChannelSetupInput(params.body.config);
  const effectiveDmPolicy = input.dmPolicy ?? (created ? "open" : undefined);
  const resolvedAccountId =
    plugin.setup.resolveAccountId?.({
      cfg: nextConfig,
      accountId: params.accountId,
      input,
    }) ?? normalizeAccountId(params.accountId);

  const validationError = plugin.setup.validateInput?.({
    cfg: nextConfig,
    accountId: resolvedAccountId,
    input,
  });
  if (validationError) {
    throw new Error(validationError);
  }

  const previousTelegramToken =
    plugin.id === "telegram"
      ? resolveTelegramAccount({ cfg: nextConfig, accountId: resolvedAccountId }).token.trim()
      : "";

  if (resolvedAccountId !== DEFAULT_ACCOUNT_ID) {
    nextConfig = moveSingleAccountChannelSectionToDefaultAccount({
      cfg: nextConfig,
      channelKey: plugin.id,
    });
  }

  nextConfig = applyChannelAccountConfig({
    cfg: nextConfig,
    channel: plugin.id,
    accountId: resolvedAccountId,
    input,
  });
  if (effectiveDmPolicy) {
    nextConfig = applyProvisionedDmPolicy({
      cfg: nextConfig,
      channel: plugin.id,
      accountId: resolvedAccountId,
      dmPolicy: effectiveDmPolicy,
    });
  }

  let binding: ChannelBindingRecord | undefined;
  const requestedAgentId = params.body.agentId?.trim();
  if (requestedAgentId) {
    const bindingResult = applyAgentBindings(nextConfig, [
      {
        type: "route",
        agentId: requestedAgentId,
        match: {
          channel: plugin.id,
          accountId: resolvedAccountId,
        },
      },
    ]);
    if (bindingResult.conflicts.length > 0) {
      const details = bindingResult.conflicts
        .map(
          (conflict) => `${describeBinding(conflict.binding)} (agent=${conflict.existingAgentId})`,
        )
        .join(", ");
      throw new Error(`Binding conflict: ${details}`);
    }
    nextConfig = bindingResult.config;
    const appliedBinding = bindingResult.updated[0] ?? bindingResult.added[0];
    if (appliedBinding) {
      binding = {
        agentId: appliedBinding.agentId,
        description: describeBinding(appliedBinding),
      };
    }
  }

  if (plugin.id === "telegram") {
    const nextTelegramToken = resolveTelegramAccount({
      cfg: nextConfig,
      accountId: resolvedAccountId,
    }).token.trim();
    if (previousTelegramToken !== nextTelegramToken) {
      await deleteTelegramUpdateOffset({ accountId: resolvedAccountId });
    }
  }

  await params.writeConfigFile(nextConfig);
  const snapshot = await buildChannelAccountSnapshot({
    plugin,
    cfg: nextConfig,
    accountId: resolvedAccountId,
  });
  return {
    ok: true,
    created,
    updated: !created,
    account: buildChannelAccountRecord({
      channel: plugin.id,
      label: plugin.meta.label ?? plugin.id,
      snapshot,
    }),
    ...(binding ? { binding } : {}),
  };
}

async function deleteChannelAccount(params: {
  cfg: OpenClawConfig;
  channel: string;
  accountId: string;
  writeConfigFile: OpenClawPluginApi["runtime"]["config"]["writeConfigFile"];
}): Promise<void> {
  const plugin = getChannelPlugin(params.channel);
  if (!plugin) {
    throw new Error(`Unknown channel "${params.channel}".`);
  }
  if (!plugin.config.deleteAccount) {
    throw new Error(`Channel ${params.channel} does not support delete.`);
  }
  const nextConfig = plugin.config.deleteAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  if (plugin.id === "telegram") {
    await deleteTelegramUpdateOffset({ accountId: params.accountId });
  }
  await params.writeConfigFile(nextConfig);
}

function detectResolveKind(input: string): ChannelResolveKind {
  const trimmed = input.trim();
  if (!trimmed) {
    return "group";
  }
  if (trimmed.startsWith("@")) {
    return "user";
  }
  if (/^<@!?/.test(trimmed)) {
    return "user";
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return "user";
  }
  if (
    /^(user|discord|slack|matrix|msteams|teams|zalo|zalouser|googlechat|google-chat|gchat):/i.test(
      trimmed,
    )
  ) {
    return "user";
  }
  return "group";
}

async function resolveChannelEntries(params: {
  cfg: OpenClawConfig;
  channel: string;
  accountId?: string;
  kind?: "auto" | "user" | "group";
  entries: string[];
}): Promise<ChannelResolveResult[]> {
  const plugin = getChannelPlugin(params.channel);
  if (!plugin?.resolver?.resolveTargets) {
    throw new Error(`Channel ${params.channel} does not support resolve.`);
  }
  const accountId = params.accountId?.trim() || null;
  if (params.kind && params.kind !== "auto") {
    return await plugin.resolver.resolveTargets({
      cfg: params.cfg,
      accountId,
      inputs: params.entries,
      kind: params.kind === "user" ? "user" : "group",
      runtime: defaultRuntime,
    });
  }
  const resolved: ChannelResolveResult[] = [];
  const groups = new Map<ChannelResolveKind, string[]>();
  for (const entry of params.entries) {
    const kind = detectResolveKind(entry);
    groups.set(kind, [...(groups.get(kind) ?? []), entry]);
  }
  for (const [kind, inputs] of groups.entries()) {
    resolved.push(
      ...(await plugin.resolver.resolveTargets({
        cfg: params.cfg,
        accountId,
        inputs,
        kind,
        runtime: defaultRuntime,
      })),
    );
  }
  const byInput = new Map(resolved.map((entry) => [entry.input, entry]));
  return params.entries.map(
    (entry) => byInput.get(entry) ?? { input: entry, resolved: false, note: "unresolved" },
  );
}

function createChannelProvisionerHandler(params: {
  logger: OpenClawPluginApi["logger"];
  basePath: string;
  loadConfig: OpenClawPluginApi["runtime"]["config"]["loadConfig"];
  writeConfigFile: OpenClawPluginApi["runtime"]["config"]["writeConfigFile"];
}): Parameters<OpenClawPluginApi["registerHttpRoute"]>[0]["handler"] {
  return async (req, res) => {
    const route = resolveChannelsRoute({ req, basePath: params.basePath });
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
      if (method === "GET" && (route.kind === "collection" || route.kind === "status")) {
        const channels = await buildChannelsStatus(cfg);
        return respondJson(res, 200, { ok: true, channels });
      }

      if (method === "GET" && route.kind === "resolve") {
        const url = getRequestUrl(req);
        const channel = normalizeChannelId(url.searchParams.get("channel"));
        if (!channel) {
          return respondJson(res, 400, { ok: false, error: "channel is required" });
        }
        const entries = [
          ...url.searchParams.getAll("q"),
          ...url.searchParams.getAll("entry"),
          ...url.searchParams.getAll("entries"),
        ]
          .map((entry) => entry.trim())
          .filter(Boolean);
        if (entries.length === 0) {
          return respondJson(res, 400, {
            ok: false,
            error: "at least one query entry is required",
          });
        }
        const kindValue = url.searchParams.get("kind");
        const kind =
          kindValue === "user" || kindValue === "group" || kindValue === "auto"
            ? kindValue
            : undefined;
        const results = await resolveChannelEntries({
          cfg,
          channel,
          accountId: url.searchParams.get("account") ?? undefined,
          kind,
          entries,
        });
        return respondJson(res, 200, { ok: true, results });
      }

      if (method === "POST" && route.kind === "accounts") {
        const mutation = await readChannelMutationBody({ req, res });
        if (!mutation) {
          return true;
        }
        const accountId = normalizeAccountId(mutation.body.accountId);
        const result = await upsertChannelAccount({
          cfg,
          channel: mutation.channel,
          accountId,
          body: mutation.body,
          writeConfigFile: params.writeConfigFile,
        });
        params.logger.info(
          `channel-provisioner: created ${mutation.channel} account "${result.account.accountId}"`,
        );
        return respondJson(res, 201, result);
      }

      if (method === "PUT" && route.kind === "account") {
        const mutation = await readChannelMutationBody({ req, res });
        if (!mutation) {
          return true;
        }
        const result = await upsertChannelAccount({
          cfg,
          channel: mutation.channel,
          accountId: route.accountId,
          body: mutation.body,
          writeConfigFile: params.writeConfigFile,
        });
        params.logger.info(
          `channel-provisioner: ${result.created ? "created" : "updated"} ${mutation.channel} account "${result.account.accountId}"`,
        );
        return respondJson(res, result.created ? 201 : 200, result);
      }

      if (method === "DELETE" && route.kind === "account") {
        const url = getRequestUrl(req);
        const channel = normalizeChannelId(url.searchParams.get("channel"));
        if (!channel) {
          return respondJson(res, 400, { ok: false, error: "channel is required" });
        }
        await deleteChannelAccount({
          cfg,
          channel,
          accountId: route.accountId,
          writeConfigFile: params.writeConfigFile,
        });
        params.logger.info(`channel-provisioner: deleted ${channel} account "${route.accountId}"`);
        return respondJson(res, 200, {
          ok: true,
          deleted: true,
          channel,
          accountId: route.accountId,
        });
      }

      return respondJson(res, 404, { ok: false, error: "not_found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      params.logger.warn(`channel-provisioner: request failed (${message})`);
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
  configSchema: ReturnType<typeof emptyPluginConfigSchema>;
  register: (api: OpenClawPluginApi) => void;
} = {
  id: "channel-provisioner",
  name: "Channel Provisioner",
  description: "Expose HTTP endpoints that manage OpenClaw channel accounts.",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    const basePath = DEFAULT_ROUTE_PATH;

    api.registerHttpRoute({
      path: basePath,
      match: "prefix",
      auth: "gateway",
      handler: createChannelProvisionerHandler({
        logger: api.logger,
        basePath,
        loadConfig: api.runtime.config.loadConfig,
        writeConfigFile: api.runtime.config.writeConfigFile,
      }),
    });

    api.logger.info(`channel-provisioner: route registered at ${basePath} (gateway-authenticated)`);
  },
};

export const __testing = {
  buildChannelSetupInput,
  createChannelProvisionerHandler,
  resolveChannelsRoute,
};

export default plugin;
