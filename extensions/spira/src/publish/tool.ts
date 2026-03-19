import { Type } from "@sinclair/typebox";
import type { SpiraPluginConfig } from "../config.js";
import { stringEnum } from "../shared/schema.js";
import { buildToolResult } from "../shared/tool-result.js";

const PUBLISH_ACTIONS = ["publish_now", "schedule", "status"] as const;

const SpiraPublishToolSchema = Type.Object(
  {
    action: stringEnum(PUBLISH_ACTIONS, "Publish action."),
    agentId: Type.Optional(Type.String({ description: "Optional agent override." })),
    payload: Type.Optional(Type.Unknown({ description: "Future publish payload." })),
    jobId: Type.Optional(Type.String({ description: "Future publish job id for status." })),
  },
  { additionalProperties: false },
);

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function createSpiraPublishTool(params: {
  config: SpiraPluginConfig;
  agentId?: string;
}) {
  return {
    name: "spira_publish",
    label: "Spira Publish",
    description:
      "Thin publish scaffold for future Spira social publishing flows. V1 registers the interface without full platform logic.",
    parameters: SpiraPublishToolSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const action = readOptionalString(rawParams.action);
      if (!action) {
        throw new Error("action required");
      }
      return buildToolResult({
        status: "not_implemented",
        action,
        agentId: readOptionalString(rawParams.agentId) ?? params.agentId ?? null,
        enabled: params.config.publish.enabled,
        message: "spira_publish is scaffolded in v1 but not fully implemented yet.",
      });
    },
  };
}
