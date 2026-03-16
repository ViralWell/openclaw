import type { IncomingMessage } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockServerResponse } from "../../src/test-utils/mock-http-response.js";
import { createTestPluginApi } from "../test-utils/plugin-api.js";

const {
  buildChannelAccountSnapshotMock,
  getChannelPluginMock,
  listChannelPluginsMock,
  normalizeChannelIdMock,
  applyChannelAccountConfigMock,
  moveSingleAccountChannelSectionToDefaultAccountMock,
  resolveTelegramAccountMock,
  deleteTelegramUpdateOffsetMock,
} = vi.hoisted(() => ({
  buildChannelAccountSnapshotMock: vi.fn(),
  getChannelPluginMock: vi.fn(),
  listChannelPluginsMock: vi.fn(),
  normalizeChannelIdMock: vi.fn((value?: string | null) =>
    value && value.trim() ? value.trim() : null,
  ),
  applyChannelAccountConfigMock: vi.fn(({ cfg }) => cfg),
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

vi.mock("../../src/channels/plugins/setup-helpers.js", () => ({
  moveSingleAccountChannelSectionToDefaultAccount:
    moveSingleAccountChannelSectionToDefaultAccountMock,
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
  };
}

describe("channel-provisioner plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("creates a channel account via POST", async () => {
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
        url: "/plugins/channel-provisioner/channels/telegram/accounts",
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

    expect(res.statusCode).toBe(201);
    expect(writeConfigFile).toHaveBeenCalledTimes(1);
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
        url: "/plugins/channel-provisioner/channels/telegram/accounts/default",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          config: { token: "next" },
        }),
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(String(res.body))).toMatchObject({
      ok: true,
      created: false,
      updated: true,
      account: { accountId: "default", channel: "telegram" },
    });
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
        url: "/plugins/channel-provisioner/channels/telegram/accounts/default",
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
});
