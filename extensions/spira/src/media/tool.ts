import { Type } from "@sinclair/typebox";
import type { SpiraPluginConfig } from "../config.js";
import { stringEnum } from "../shared/schema.js";
import { buildToolResult } from "../shared/tool-result.js";
import { executeMediaAction } from "./router.js";
import { MEDIA_ACTIONS } from "./types.js";

const MEDIA_PROVIDER_OPTIONS = ["auto", "spira", "viral-well-tools"] as const;

const SpiraMediaToolSchema = Type.Object(
  {
    action: stringEnum(MEDIA_ACTIONS, "Media action to run."),
    agentId: Type.Optional(Type.String({ description: "Optional agent override." })),
    provider: Type.Optional(
      stringEnum(MEDIA_PROVIDER_OPTIONS, "Provider override. Default: auto."),
    ),
    prompt: Type.Optional(Type.String({ description: "Prompt for generation actions." })),
    images: Type.Optional(
      Type.Array(Type.String({ description: "Input image URL." }), {
        description: "Input image URLs.",
      }),
    ),
    video: Type.Optional(Type.String({ description: "Input video URL." })),
    options: Type.Optional(Type.Unknown({ description: "Provider-specific advanced options." })),
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

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return strings.length > 0 ? strings : undefined;
}

export function createSpiraMediaTool(params: {
  config: SpiraPluginConfig;
  agentId?: string;
  fetchImpl?: typeof fetch;
}) {
  return {
    name: "spira_media",
    label: "Spira Media",
    description:
      "Run fixed media actions through Spira workflow mappings or viral-well-tools backends without exposing provider details to the model.",
    parameters: SpiraMediaToolSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const action = readOptionalString(rawParams.action);
      if (!action) {
        throw new Error("action required");
      }
      const result = await executeMediaAction({
        config: params.config,
        input: {
          action: action as (typeof MEDIA_ACTIONS)[number],
          agentId: readOptionalString(rawParams.agentId) ?? params.agentId,
          provider:
            (readOptionalString(rawParams.provider) as "auto" | "spira" | "viral-well-tools") ??
            "auto",
          prompt: readOptionalString(rawParams.prompt),
          images: readStringArray(rawParams.images),
          video: readOptionalString(rawParams.video),
          options: rawParams.options,
        },
        fetchImpl: params.fetchImpl,
      });
      return buildToolResult(result);
    },
  };
}
