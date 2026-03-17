import type { IncomingMessage } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockServerResponse } from "../../src/test-utils/mock-http-response.js";
import { createTestPluginApi } from "../test-utils/plugin-api.js";

const {
  applyAgentBindingsMock,
  buildChannelAccountSnapshotMock,
  getChannelPluginMock,
  listChannelPluginsMock,
  normalizeChannelIdMock,
  addWildcardAllowFromMock,
  applyChannelAccountConfigMock,
  describeBindingMock,
  patchScopedAccountConfigMock,
  moveSingleAccountChannelSectionToDefaultAccountMock,
  resolveTelegramAccountMock,
  deleteTelegramUpdateOffsetMock,
} = vi.hoisted(() => ({
  applyAgentBindingsMock: vi.fn((cfg) => ({
    config: cfg,
    added: [],
    updated: [],
    skipped: [],
    conflicts: [],
  })),
  buildChannelAccountSnapshotMock: vi.fn(),
  getChannelPluginMock: vi.fn(),
  listChannelPluginsMock: vi.fn(),
  normalizeChannelIdMock: vi.fn((value?: string | null) =>
    value && value.trim() ? value.trim() : null,
  ),
  addWildcardAllowFromMock: vi.fn((allowFrom?: Array<string | number> | null) => {
    const entries = Array.isArray(allowFrom) ? allowFrom.map((entry) => String(entry)) : [];
    return entries.includes("*") ? entries : [...entries, "*"];
  }),
  applyChannelAccountConfigMock: vi.fn(({ cfg }) => cfg),
  describeBindingMock: vi.fn((binding) => {
    const accountId = binding.match?.accountId ? ` accountId=${binding.match.accountId}` : "";
    return `${binding.match.channel}${accountId}`;
  }),
  patchScopedAccountConfigMock: vi.fn(({ cfg, channelKey, accountId, patch }) => ({
    ...cfg,
    channels: {
      ...(cfg.channels ?? {}),
      [channelKey]: {
        ...((cfg.channels ?? {})[channelKey] as Record<string, unknown> | undefined),
        ...(accountId === "default"
          ? patch
          : {
              accounts: {
                ...(((cfg.channels ?? {})[channelKey] as { accounts?: Record<string, unknown> })
                  ?.accounts ?? {}),
                [accountId]: patch,
              },
            }),
      },
    },
  })),
  moveSingleAccountChannelSectionToDefaultAccountMock: vi.fn(({ cfg }) => cfg),
  resolveTelegramAccountMock: vi.fn(() => ({ token: "" })),
  deleteTelegramUpdateOffsetMock: vi.fn(),
}));

vi.mock("../../src/channels/plugins/status.js", () => ({
  buildChannelAccountSnapshot: buildChannelAccountSnapshotMock,
}));

vi.mock("../../src/channels/plugins/index.js", () => ({
  getChannelPlugin: getChannelPluginMock,
  listChannelPlugins: listChannelPluginsMock,
  normalizeChannelId: normalizeChannelIdMock,
}));

vi.mock("../../src/commands/channels/add-mutators.js", () => ({
  applyChannelAccountConfig: applyChannelAccountConfigMock,
}));

vi.mock("../../src/commands/agents.bindings.js", () => ({
  applyAgentBindings: applyAgentBindingsMock,
  describeBinding: describeBindingMock,
}));

vi.mock("../../src/channels/plugins/onboarding/helpers.js", () => ({
  addWildcardAllowFrom: addWildcardAllowFromMock,
}));

vi.mock("../../src/channels/plugins/setup-helpers.js", () => ({
  moveSingleAccountChannelSectionToDefaultAccount:
    moveSingleAccountChannelSectionToDefaultAccountMock,
  patchScopedAccountConfig: patchScopedAccountConfigMock,
}));

vi.mock("../../src/telegram/accounts.js", () => ({
  resolveTelegramAccount: resolveTelegramAccountMock,
}));

vi.mock("../../src/telegram/update-offset-store.js", () => ({
  deleteTelegramUpdateOffset: deleteTelegramUpdateOffsetMock,
}));

import plugin, { __testing } from "./index.js";

function localReq(input: {
  method: string;
  url?: string;
  headers?: IncomingMessage["headers"];
  body?: string;
}): IncomingMessage {
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  let emitted = false;
  const emitBody = () => {
    if (emitted) {
      return;
    }
    emitted = true;
    queueMicrotask(() => {
      for (const handler of listeners.get("data") ?? []) {
        handler(Buffer.from(input.body ?? "", "utf8"));
      }
      for (const handler of listeners.get("end") ?? []) {
        handler();
      }
    });
  };
  const req = {
    method: input.method,
    url: input.url ?? "/plugins/channel-provisioner/channels",
    headers: input.headers ?? {},
    socket: { remoteAddress: "127.0.0.1" },
    on(event: string, listener: (...args: any[]) => void) {
      const current = listeners.get(event) ?? [];
      current.push(listener);
      listeners.set(event, current);
      if (event === "data" || event === "end") {
        emitBody();
      }
      return req;
    },
    once(event: string, listener: (...args: any[]) => void) {
      return req.on(event, listener);
    },
    off() {
      return req;
    },
    removeListener() {
      return req;
    },
    setTimeout() {
      return req;
    },
    resume() {
      emitBody();
      return req;
    },
  };
  return req as unknown as IncomingMessage;
}

function makePlugin(overrides?: {
  id?: string;
  label?: string;
  accountIds?: string[];
  deleteAccount?: boolean;
  resolve?: boolean;
  auth?: {
    login?: (params: any) => Promise<void>;
  };
}) {
  const accountIds = overrides?.accountIds ?? ["default"];
  const id = overrides?.id ?? "telegram";
  const label = overrides?.label ?? "Telegram";
  return {
    id,
    meta: { label },
    config: {
      listAccountIds: vi.fn(() => accountIds),
      deleteAccount: overrides?.deleteAccount === false ? undefined : vi.fn(({ cfg }) => cfg),
    },
    setup: {
      applyAccountConfig: vi.fn(({ cfg }) => cfg),
      resolveAccountId: vi.fn(({ accountId }) => accountId ?? "default"),
      validateInput: vi.fn(() => null),
    },
    resolver:
      overrides?.resolve === false
        ? undefined
        : {
            resolveTargets: vi.fn(async ({ inputs }) =>
              inputs.map((input: string) => ({
                input,
                resolved: true,
                id: `id:${input}`,
                name: input,
              })),
            ),
          },
    ...(overrides?.auth ? { auth: overrides.auth } : {}),
  };
}

describe("channel-provisioner plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyAgentBindingsMock.mockImplementation((cfg) => ({
      config: cfg,
      added: [],
      updated: [],
      skipped: [],
      conflicts: [],
    }));
    buildChannelAccountSnapshotMock.mockResolvedValue({
      accountId: "default",
      configured: true,
      enabled: true,
      tokenSource: "env",
    });
  });

  it("registers the default plugin route as a prefix route", () => {
    const registerHttpRoute = vi.fn();

    plugin.register?.(
      createTestPluginApi({
        id: "channel-provisioner",
        name: "Channel Provisioner",
        description: "Channel Provisioner",
        source: "test",
        config: {},
        runtime: {
          config: { loadConfig: vi.fn(() => ({})), writeConfigFile: vi.fn() },
        } as never,
        registerHttpRoute,
      }),
    );

    expect(registerHttpRoute).toHaveBeenCalledTimes(1);
    expect(registerHttpRoute.mock.calls[0]?.[0]).toMatchObject({
      path: "/plugins/channel-provisioner/channels",
      match: "prefix",
      auth: "gateway",
    });
  });

  it("lists channels with account snapshots", async () => {
    const telegram = makePlugin();
    listChannelPluginsMock.mockReturnValue([telegram]);
    getChannelPluginMock.mockImplementation((id) => (id === "telegram" ? telegram : undefined));

    const handler = __testing.createChannelProvisionerHandler({
      logger: { info() {}, warn() {}, error() {} },
      basePath: "/plugins/channel-provisioner/channels",
      loadConfig: () => ({}),
      writeConfigFile: vi.fn(),
    });

    const res = createMockServerResponse();
    await handler(
      localReq({
        method: "GET",
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(String(res.body))).toMatchObject({
      ok: true,
      channels: [
        {
          id: "telegram",
          accounts: [{ accountId: "default", configured: true, enabled: true }],
        },
      ],
    });
  });

  it('creates a channel account via POST with default allowFrom ["*"]', async () => {
    const telegram = makePlugin({ accountIds: [] });
    getChannelPluginMock.mockImplementation((id) => (id === "telegram" ? telegram : undefined));

    const writeConfigFile = vi.fn();
    const handler = __testing.createChannelProvisionerHandler({
      logger: { info() {}, warn() {}, error() {} },
      basePath: "/plugins/channel-provisioner/channels",
      loadConfig: () => ({}),
      writeConfigFile,
    });

    const res = createMockServerResponse();
    await handler(
      localReq({
        method: "POST",
        url: "/plugins/channel-provisioner/channels/accounts",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channel: "telegram",
          accountId: "default",
          config: { token: "abc" },
        }),
      }),
      res,
    );

    expect(res.statusCode).toBe(201);
    expect(writeConfigFile).toHaveBeenCalledTimes(1);
    expect(patchScopedAccountConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channelKey: "telegram",
        accountId: "default",
        patch: expect.objectContaining({
          dmPolicy: "open",
          allowFrom: ["*"],
        }),
      }),
    );
    expect(addWildcardAllowFromMock).toHaveBeenCalledWith(undefined);
    expect(JSON.parse(String(res.body))).toMatchObject({
      ok: true,
      created: true,
      updated: false,
      account: { accountId: "default", channel: "telegram" },
    });
  });

  it("updates a channel account via PUT", async () => {
    const telegram = makePlugin();
    getChannelPluginMock.mockImplementation((id) => (id === "telegram" ? telegram : undefined));

    const handler = __testing.createChannelProvisionerHandler({
      logger: { info() {}, warn() {}, error() {} },
      basePath: "/plugins/channel-provisioner/channels",
      loadConfig: () => ({}),
      writeConfigFile: vi.fn(),
    });

    const res = createMockServerResponse();
    await handler(
      localReq({
        method: "PUT",
        url: "/plugins/channel-provisioner/channels/accounts/default",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channel: "telegram",
          config: { token: "next" },
        }),
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(patchScopedAccountConfigMock).not.toHaveBeenCalled();
    expect(JSON.parse(String(res.body))).toMatchObject({
      ok: true,
      created: false,
      updated: true,
      account: { accountId: "default", channel: "telegram" },
    });
  });

  it("adds an account binding when agentId is provided", async () => {
    const telegram = makePlugin({ accountIds: [] });
    getChannelPluginMock.mockImplementation((id) => (id === "telegram" ? telegram : undefined));
    applyAgentBindingsMock.mockImplementation((_cfg, bindings) => ({
      config: { bindings },
      added: bindings,
      updated: [],
      skipped: [],
      conflicts: [],
    }));

    const writeConfigFile = vi.fn();
    const handler = __testing.createChannelProvisionerHandler({
      logger: { info() {}, warn() {}, error() {} },
      basePath: "/plugins/channel-provisioner/channels",
      loadConfig: () => ({}),
      writeConfigFile,
    });

    const res = createMockServerResponse();
    await handler(
      localReq({
        method: "POST",
        url: "/plugins/channel-provisioner/channels/accounts",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channel: "telegram",
          accountId: "default",
          agentId: "ops",
          config: { token: "abc" },
        }),
      }),
      res,
    );

    expect(res.statusCode).toBe(201);
    expect(applyAgentBindingsMock).toHaveBeenCalledWith(expect.anything(), [
      {
        type: "route",
        agentId: "ops",
        match: { channel: "telegram", accountId: "default" },
      },
    ]);
    expect(writeConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({
        bindings: [
          {
            type: "route",
            agentId: "ops",
            match: { channel: "telegram", accountId: "default" },
          },
        ],
      }),
    );
    expect(JSON.parse(String(res.body))).toMatchObject({
      ok: true,
      binding: {
        agentId: "ops",
        description: "telegram accountId=default",
      },
    });
  });

  it("fails the request when the requested binding conflicts", async () => {
    const telegram = makePlugin({ accountIds: [] });
    getChannelPluginMock.mockImplementation((id) => (id === "telegram" ? telegram : undefined));
    applyAgentBindingsMock.mockImplementation((cfg, bindings) => ({
      config: cfg,
      added: [],
      updated: [],
      skipped: [],
      conflicts: [{ binding: bindings[0], existingAgentId: "main" }],
    }));

    const writeConfigFile = vi.fn();
    const handler = __testing.createChannelProvisionerHandler({
      logger: { info() {}, warn() {}, error() {} },
      basePath: "/plugins/channel-provisioner/channels",
      loadConfig: () => ({}),
      writeConfigFile,
    });

    const res = createMockServerResponse();
    await handler(
      localReq({
        method: "POST",
        url: "/plugins/channel-provisioner/channels/accounts",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channel: "telegram",
          accountId: "default",
          agentId: "ops",
          config: { token: "abc" },
        }),
      }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(writeConfigFile).not.toHaveBeenCalled();
    expect(JSON.parse(String(res.body))).toMatchObject({
      ok: false,
      error: "Binding conflict: telegram accountId=default (agent=main)",
    });
  });

  it("honors an explicit dmPolicy from the request body", async () => {
    const telegram = makePlugin({ accountIds: [] });
    getChannelPluginMock.mockImplementation((id) => (id === "telegram" ? telegram : undefined));

    const handler = __testing.createChannelProvisionerHandler({
      logger: { info() {}, warn() {}, error() {} },
      basePath: "/plugins/channel-provisioner/channels",
      loadConfig: () => ({}),
      writeConfigFile: vi.fn(),
    });

    const res = createMockServerResponse();
    await handler(
      localReq({
        method: "POST",
        url: "/plugins/channel-provisioner/channels/accounts",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channel: "telegram",
          accountId: "default",
          config: { token: "abc", dmPolicy: "disabled" },
        }),
      }),
      res,
    );

    expect(res.statusCode).toBe(201);
    expect(patchScopedAccountConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channelKey: "telegram",
        accountId: "default",
        patch: expect.objectContaining({
          dmPolicy: "disabled",
        }),
      }),
    );
    expect(addWildcardAllowFromMock).not.toHaveBeenCalled();
  });

  it("adds wildcard allowFrom when the request explicitly sets dmPolicy to open", async () => {
    const telegram = makePlugin({ accountIds: [] });
    getChannelPluginMock.mockImplementation((id) => (id === "telegram" ? telegram : undefined));

    const handler = __testing.createChannelProvisionerHandler({
      logger: { info() {}, warn() {}, error() {} },
      basePath: "/plugins/channel-provisioner/channels",
      loadConfig: () => ({}),
      writeConfigFile: vi.fn(),
    });

    const res = createMockServerResponse();
    await handler(
      localReq({
        method: "POST",
        url: "/plugins/channel-provisioner/channels/accounts",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channel: "telegram",
          accountId: "default",
          config: { token: "abc", dmPolicy: "open" },
        }),
      }),
      res,
    );

    expect(res.statusCode).toBe(201);
    expect(patchScopedAccountConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channelKey: "telegram",
        accountId: "default",
        patch: expect.objectContaining({
          dmPolicy: "open",
          allowFrom: ["*"],
        }),
      }),
    );
    expect(addWildcardAllowFromMock).toHaveBeenCalledWith(undefined);
  });

  it("deletes a channel account via DELETE", async () => {
    const telegram = makePlugin();
    getChannelPluginMock.mockImplementation((id) => (id === "telegram" ? telegram : undefined));

    const writeConfigFile = vi.fn();
    const handler = __testing.createChannelProvisionerHandler({
      logger: { info() {}, warn() {}, error() {} },
      basePath: "/plugins/channel-provisioner/channels",
      loadConfig: () => ({}),
      writeConfigFile,
    });

    const res = createMockServerResponse();
    await handler(
      localReq({
        method: "DELETE",
        url: "/plugins/channel-provisioner/channels/accounts/default?channel=telegram",
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(writeConfigFile).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(res.body))).toMatchObject({
      ok: true,
      deleted: true,
      channel: "telegram",
      accountId: "default",
    });
  });

  it("resolves channel entries via GET", async () => {
    const slack = makePlugin({ id: "slack", label: "Slack" });
    getChannelPluginMock.mockImplementation((id) => (id === "slack" ? slack : undefined));

    const handler = __testing.createChannelProvisionerHandler({
      logger: { info() {}, warn() {}, error() {} },
      basePath: "/plugins/channel-provisioner/channels",
      loadConfig: () => ({}),
      writeConfigFile: vi.fn(),
    });

    const res = createMockServerResponse();
    await handler(
      localReq({
        method: "GET",
        url: "/plugins/channel-provisioner/channels/resolve?channel=slack&q=%23general",
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(String(res.body))).toMatchObject({
      ok: true,
      results: [{ input: "#general", resolved: true, id: "id:#general" }],
    });
  });

  it("rejects POST when channel is missing from the body", async () => {
    const telegram = makePlugin({ accountIds: [] });
    getChannelPluginMock.mockImplementation((id) => (id === "telegram" ? telegram : undefined));

    const handler = __testing.createChannelProvisionerHandler({
      logger: { info() {}, warn() {}, error() {} },
      basePath: "/plugins/channel-provisioner/channels",
      loadConfig: () => ({}),
      writeConfigFile: vi.fn(),
    });

    const res = createMockServerResponse();
    await handler(
      localReq({
        method: "POST",
        url: "/plugins/channel-provisioner/channels/accounts",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          accountId: "default",
          config: { token: "abc" },
        }),
      }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(String(res.body))).toMatchObject({
      ok: false,
      error: "channel is required",
    });
  });

  it("handles POST /login for WhatsApp with QR code", async () => {
    const startWebLoginWithQrMock = vi.fn().mockResolvedValue({
      qrDataUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      message: "Scan this QR in WhatsApp → Linked Devices.",
    });

    vi.doMock("../whatsapp/src/runtime.js", () => ({
      getWhatsAppRuntime: () => ({
        channel: {
          whatsapp: {
            startWebLoginWithQr: startWebLoginWithQrMock,
          },
        },
      }),
    }));

    const handler = __testing.createChannelProvisionerHandler({
      logger: { info() {}, warn() {}, error() {} },
      basePath: "/plugins/channel-provisioner/channels",
      loadConfig: () => ({}),
      writeConfigFile: vi.fn(),
    });

    const res = createMockServerResponse();
    await handler(
      localReq({
        method: "POST",
        url: "/plugins/channel-provisioner/channels/login?channel=whatsapp&account=default&verbose=true",
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(String(res.body));
    expect(body).toMatchObject({
      ok: true,
      channel: "whatsapp",
      accountId: "default",
      message: "Scan this QR in WhatsApp → Linked Devices.",
    });
    expect(body.qrDataUrl).toContain("data:image/png;base64,");
    expect(startWebLoginWithQrMock).toHaveBeenCalledWith({
      accountId: "default",
      verbose: true,
      force: false,
      runtime: expect.any(Object),
    });

    vi.doUnmock("../whatsapp/src/runtime.js");
  });

  it("handles GET /login/wait for WhatsApp", async () => {
    const waitForWebLoginMock = vi.fn().mockResolvedValue({
      connected: true,
      message: "WhatsApp connected successfully.",
    });

    vi.doMock("../whatsapp/src/runtime.js", () => ({
      getWhatsAppRuntime: () => ({
        channel: {
          whatsapp: {
            waitForWebLogin: waitForWebLoginMock,
          },
        },
      }),
    }));

    const handler = __testing.createChannelProvisionerHandler({
      logger: { info() {}, warn() {}, error() {} },
      basePath: "/plugins/channel-provisioner/channels",
      loadConfig: () => ({}),
      writeConfigFile: vi.fn(),
    });

    const res = createMockServerResponse();
    await handler(
      localReq({
        method: "GET",
        url: "/plugins/channel-provisioner/channels/login/wait?channel=whatsapp&account=default&timeout=5000",
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(String(res.body))).toMatchObject({
      ok: true,
      channel: "whatsapp",
      accountId: "default",
      connected: true,
      message: "WhatsApp connected successfully.",
    });
    expect(waitForWebLoginMock).toHaveBeenCalledWith({
      accountId: "default",
      timeoutMs: 5000,
      runtime: expect.any(Object),
    });

    vi.doUnmock("../whatsapp/src/runtime.js");
  });

  it("handles POST /login for channels with auth.login support", async () => {
    const loginMock = vi.fn().mockResolvedValue(undefined);
    const telegram = makePlugin({
      id: "telegram",
      accountIds: ["default"],
      auth: {
        login: loginMock,
      },
    });
    getChannelPluginMock.mockImplementation((id) => (id === "telegram" ? telegram : undefined));

    const handler = __testing.createChannelProvisionerHandler({
      logger: { info() {}, warn() {}, error() {} },
      basePath: "/plugins/channel-provisioner/channels",
      loadConfig: () => ({}),
      writeConfigFile: vi.fn(),
    });

    const res = createMockServerResponse();
    await handler(
      localReq({
        method: "POST",
        url: "/plugins/channel-provisioner/channels/login?channel=telegram&account=default&verbose=true",
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(String(res.body))).toMatchObject({
      ok: true,
      channel: "telegram",
      accountId: "default",
      message: "Login completed successfully",
    });
    expect(loginMock).toHaveBeenCalledWith({
      cfg: {},
      accountId: "default",
      runtime: expect.any(Object),
      verbose: true,
    });
  });

  it("rejects POST /login when channel does not support login", async () => {
    const telegram = makePlugin({ accountIds: ["default"] });
    getChannelPluginMock.mockImplementation((id) => (id === "telegram" ? telegram : undefined));

    const handler = __testing.createChannelProvisionerHandler({
      logger: { info() {}, warn() {}, error() {} },
      basePath: "/plugins/channel-provisioner/channels",
      loadConfig: () => ({}),
      writeConfigFile: vi.fn(),
    });

    const res = createMockServerResponse();
    await handler(
      localReq({
        method: "POST",
        url: "/plugins/channel-provisioner/channels/login?channel=telegram&account=default",
      }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(String(res.body))).toMatchObject({
      ok: false,
      error: "Channel telegram does not support login",
    });
  });

  it("rejects POST /login when channel is missing", async () => {
    const handler = __testing.createChannelProvisionerHandler({
      logger: { info() {}, warn() {}, error() {} },
      basePath: "/plugins/channel-provisioner/channels",
      loadConfig: () => ({}),
      writeConfigFile: vi.fn(),
    });

    const res = createMockServerResponse();
    await handler(
      localReq({
        method: "POST",
        url: "/plugins/channel-provisioner/channels/login",
      }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(String(res.body))).toMatchObject({
      ok: false,
      error: "channel is required",
    });
  });
});
