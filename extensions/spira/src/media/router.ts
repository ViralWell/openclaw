import type { SpiraMediaConfig, SpiraPluginConfig } from "../config.js";
import { fetchJson } from "../shared/http.js";
import type { MediaAction, MediaProviderName } from "./types.js";

type MediaToolInput = {
  action: MediaAction;
  agentId?: string;
  prompt?: string;
  images?: string[];
  video?: string;
  options?: unknown;
  provider?: MediaProviderName | "auto";
};

function buildSpiraMediaInputs(input: MediaToolInput) {
  const merged = {
    ...(input.options && typeof input.options === "object" && !Array.isArray(input.options)
      ? (input.options as Record<string, unknown>)
      : {}),
  };
  if (input.prompt) {
    merged.prompt = input.prompt;
  }
  if (input.images && input.images.length > 0) {
    merged.images = input.images;
  }
  if (input.video) {
    merged.video = input.video;
  }
  if (input.agentId) {
    merged.agentId = input.agentId;
  }
  return merged;
}

async function trySpiraProvider(params: {
  config: SpiraMediaConfig["spira"];
  input: MediaToolInput;
  fetchImpl?: typeof fetch;
}) {
  if (!params.config.enabled) {
    return { supported: false as const };
  }
  const mapping = params.config.actions[params.input.action];
  if (!mapping?.workflowId) {
    return { supported: false as const };
  }
  if (!params.config.baseUrl) {
    throw new Error("spira media provider baseUrl not configured");
  }
  const result = await fetchJson<{ runId: string; status: string; createdAt?: number }>({
    baseUrl: params.config.baseUrl,
    path: params.config.runPath,
    method: "POST",
    apiKey: params.config.apiKey,
    body: {
      workflowId: mapping.workflowId,
      inputs: buildSpiraMediaInputs(params.input),
    },
    fetchImpl: params.fetchImpl,
  });
  return {
    supported: true as const,
    result: {
      status: "ok",
      provider: "spira" as const,
      action: params.input.action,
      agentId: params.input.agentId ?? null,
      workflowId: mapping.workflowId,
      runId: result.runId,
      runStatus: result.status,
      createdAt: result.createdAt ?? null,
    },
  };
}

async function tryViralWellToolsProvider(params: {
  config: SpiraMediaConfig["viralWellTools"];
  input: MediaToolInput;
  fetchImpl?: typeof fetch;
}) {
  if (!params.config.enabled) {
    return { supported: false as const };
  }
  const endpoint = params.config.endpoints[params.input.action];
  if (!endpoint) {
    return { supported: false as const };
  }
  if (!params.config.baseUrl) {
    throw new Error("viral-well-tools baseUrl not configured");
  }
  const result = await fetchJson<Record<string, unknown>>({
    baseUrl: params.config.baseUrl,
    path: endpoint,
    method: "POST",
    apiKey: params.config.apiKey,
    body: {
      action: params.input.action,
      agentId: params.input.agentId ?? null,
      prompt: params.input.prompt,
      images: params.input.images,
      video: params.input.video,
      options: params.input.options,
    },
    fetchImpl: params.fetchImpl,
  });
  return {
    supported: true as const,
    result: {
      status: "ok",
      provider: "viral-well-tools" as const,
      action: params.input.action,
      agentId: params.input.agentId ?? null,
      jobId: typeof result.jobId === "string" ? result.jobId : null,
      jobStatus: typeof result.status === "string" ? result.status : "submitted",
      outputs:
        result.outputs ??
        result.output ??
        result.result ??
        null,
      raw: result,
    },
  };
}

function buildProviderOrder(
  config: SpiraPluginConfig,
  provider: MediaToolInput["provider"],
): MediaProviderName[] {
  if (provider === "spira" || provider === "viral-well-tools") {
    return [provider];
  }
  return config.media.defaultProviderOrder;
}

export async function executeMediaAction(params: {
  config: SpiraPluginConfig;
  input: MediaToolInput;
  fetchImpl?: typeof fetch;
}) {
  const providers = buildProviderOrder(params.config, params.input.provider);
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      const attempted =
        provider === "spira"
          ? await trySpiraProvider({
              config: params.config.media.spira,
              input: params.input,
              fetchImpl: params.fetchImpl,
            })
          : await tryViralWellToolsProvider({
              config: params.config.media.viralWellTools,
              input: params.input,
              fetchImpl: params.fetchImpl,
            });
      if (attempted.supported) {
        return attempted.result;
      }
    } catch (error) {
      errors.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  throw new Error(`no configured media provider can handle action "${params.input.action}"`);
}
