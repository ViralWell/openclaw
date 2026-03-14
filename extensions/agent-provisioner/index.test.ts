import { mkdtemp, readFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createMockServerResponse } from "../../src/test-utils/mock-http-response.js";
import { createTestPluginApi } from "../test-utils/plugin-api.js";
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
    url: input.url ?? "/plugins/agent-provisioner/agents",
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

describe("agent-provisioner plugin", () => {
  it("registers the configured plugin route as a prefix route", () => {
    const registerHttpRoute = vi.fn();

    plugin.register?.(
      createTestPluginApi({
        id: "agent-provisioner",
        name: "Agent Provisioner",
        description: "Agent Provisioner",
        source: "test",
        config: {},
        pluginConfig: { path: "/hooks/agents", authToken: "secret" },
        runtime: {
          config: { loadConfig: vi.fn(() => ({})), writeConfigFile: vi.fn() },
          state: { resolveStateDir: vi.fn(() => "/tmp/openclaw-state") },
        } as never,
        registerHttpRoute,
      }),
    );

    expect(registerHttpRoute).toHaveBeenCalledTimes(1);
    expect(registerHttpRoute.mock.calls[0]?.[0]).toMatchObject({
      path: "/hooks/agents",
      match: "prefix",
      auth: "plugin",
    });
  });

  it("rejects unauthorized requests", async () => {
    const handler = __testing.createAgentProvisionerHandler({
      logger: { info() {}, warn() {}, error() {} },
      authToken: "secret",
      basePath: "/plugins/agent-provisioner/agents",
      loadConfig: () => ({}),
      writeConfigFile: vi.fn(),
    });

    const res = createMockServerResponse();
    await handler(
      localReq({
        method: "GET",
        headers: {},
      }),
      res,
    );

    expect(res.statusCode).toBe(401);
    expect(String(res.body)).toContain("unauthorized");
  });

  it("creates a new agent via POST", async () => {
    const writeConfigFile = vi.fn();
    const handler = __testing.createAgentProvisionerHandler({
      logger: { info() {}, warn() {}, error() {} },
      authToken: "secret",
      basePath: "/plugins/agent-provisioner/agents",
      loadConfig: () => ({}),
      writeConfigFile,
    });

    const res = createMockServerResponse();
    await handler(
      localReq({
        method: "POST",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: "ops-bot",
          name: "Ops Bot",
          emoji: "🤖",
          avatar: "https://example.com/avatar.png",
          bindings: ["telegram"],
        }),
      }),
      res,
    );

    const result = JSON.parse(String(res.body)) as Record<string, any>;
    expect(res.statusCode).toBe(201);
    expect(result).toMatchObject({
      ok: true,
      created: true,
      updated: false,
      agent: {
        id: "ops-bot",
        name: "Ops Bot",
        workspace: path.join(os.homedir(), ".openclaw", "workspace-ops-bot"),
        bindings: ["telegram"],
      },
    });
    expect(writeConfigFile).toHaveBeenCalledTimes(1);

    const identity = await readFile(
      path.join(os.homedir(), ".openclaw", "workspace-ops-bot", "IDENTITY.md"),
      "utf8",
    );
    expect(identity).toContain("- Name: Ops Bot");
    expect(identity).toContain("- Emoji: 🤖");
    expect(identity).toContain("- Avatar: https://example.com/avatar.png");
  });

  it("returns a single agent via GET", async () => {
    const handler = __testing.createAgentProvisionerHandler({
      logger: { info() {}, warn() {}, error() {} },
      authToken: "secret",
      basePath: "/plugins/agent-provisioner/agents",
      loadConfig: () => ({
        agents: {
          list: [
            {
              id: "ops-bot",
              name: "Ops Bot",
              workspace: "/tmp/workspace-ops-bot",
              agentDir: "/tmp/agent-ops-bot",
            },
          ],
        },
        bindings: [{ type: "route", agentId: "ops-bot", match: { channel: "telegram" } }],
      }),
      writeConfigFile: vi.fn(),
    });

    const res = createMockServerResponse();
    await handler(
      localReq({
        method: "GET",
        url: "/plugins/agent-provisioner/agents/ops-bot",
        headers: { authorization: "Bearer secret" },
      }),
      res,
    );

    const result = JSON.parse(String(res.body)) as Record<string, any>;
    expect(res.statusCode).toBe(200);
    expect(result).toMatchObject({
      ok: true,
      agent: {
        id: "ops-bot",
        name: "Ops Bot",
        bindings: ["telegram"],
      },
    });
  });

  it("updates an existing agent via PUT", async () => {
    const writeConfigFile = vi.fn();
    const handler = __testing.createAgentProvisionerHandler({
      logger: { info() {}, warn() {}, error() {} },
      authToken: "secret",
      basePath: "/plugins/agent-provisioner/agents",
      loadConfig: () => ({
        agents: {
          list: [
            {
              id: "ops-bot",
              name: "Existing Ops Bot",
              workspace: "/tmp/workspace-ops-bot",
              agentDir: "/tmp/agent-ops-bot",
            },
          ],
        },
      }),
      writeConfigFile,
    });

    const res = createMockServerResponse();
    await handler(
      localReq({
        method: "PUT",
        url: "/plugins/agent-provisioner/agents/ops-bot",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Updated Ops Bot",
          bindings: ["telegram"],
        }),
      }),
      res,
    );

    const result = JSON.parse(String(res.body)) as Record<string, any>;
    expect(res.statusCode).toBe(200);
    expect(result).toMatchObject({
      ok: true,
      created: false,
      updated: true,
      agent: {
        id: "ops-bot",
        name: "Updated Ops Bot",
        bindings: ["telegram"],
      },
    });
    expect(writeConfigFile).toHaveBeenCalledTimes(1);
  });

  it("deletes an existing agent via DELETE", async () => {
    const writeConfigFile = vi.fn();
    const handler = __testing.createAgentProvisionerHandler({
      logger: { info() {}, warn() {}, error() {} },
      authToken: "secret",
      basePath: "/plugins/agent-provisioner/agents",
      loadConfig: () => ({
        agents: {
          list: [
            { id: "ops-bot", name: "Ops Bot", workspace: "/tmp/workspace", agentDir: "/tmp/agent" },
          ],
        },
      }),
      writeConfigFile,
    });

    const res = createMockServerResponse();
    await handler(
      localReq({
        method: "DELETE",
        url: "/plugins/agent-provisioner/agents/ops-bot",
        headers: { authorization: "Bearer secret" },
      }),
      res,
    );

    const result = JSON.parse(String(res.body)) as Record<string, any>;
    expect(res.statusCode).toBe(200);
    expect(result).toMatchObject({
      ok: true,
      deleted: true,
      agentId: "ops-bot",
    });
    expect(writeConfigFile).toHaveBeenCalledTimes(1);
  });

  it("upserts identity fields without duplicating lines", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "agent-provisioner-identity-"));

    await __testing.upsertIdentityFile({
      workspaceDir: tmp,
      name: "First Name",
      emoji: "😀",
    });
    await __testing.upsertIdentityFile({
      workspaceDir: tmp,
      name: "Second Name",
      avatar: "https://example.com/avatar.png",
    });

    const identity = await readFile(path.join(tmp, "IDENTITY.md"), "utf8");
    expect(identity.match(/- Name:/g)).toHaveLength(1);
    expect(identity).toContain("- Name: Second Name");
    expect(identity).toContain("- Emoji: 😀");
    expect(identity).toContain("- Avatar: https://example.com/avatar.png");
  });
});
