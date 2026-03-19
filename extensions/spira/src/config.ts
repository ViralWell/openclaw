import type { MediaAction } from "./media/types.js";
import type { WorkflowCatalogEntry } from "./workflows/catalog.js";

export type SpiraWorkflowConfig = {
  baseUrl?: string;
  apiKey?: string;
  catalogUrl?: string;
  runPath: string;
  statusPathTemplate: string;
  catalog: WorkflowCatalogEntry[];
};

export type SpiraMediaProviderOrder = "spira" | "viral-well-tools";

export type SpiraMediaSpiraConfig = {
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
  runPath: string;
  statusPathTemplate: string;
  actions: Partial<Record<MediaAction, { workflowId: string }>>;
};

export type SpiraMediaViralWellToolsConfig = {
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
  statusPathTemplate?: string;
  endpoints: Partial<Record<MediaAction, string>>;
};

export type SpiraMediaConfig = {
  defaultProviderOrder: SpiraMediaProviderOrder[];
  spira: SpiraMediaSpiraConfig;
  viralWellTools: SpiraMediaViralWellToolsConfig;
};

export type SpiraPublishConfig = {
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
};

export type SpiraPluginConfig = {
  workflows: SpiraWorkflowConfig;
  media: SpiraMediaConfig;
  publish: SpiraPublishConfig;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(readString).filter((entry): entry is string => Boolean(entry));
}

function normalizeCatalogEntry(value: unknown): WorkflowCatalogEntry | null {
  const record = asRecord(value);
  const id = readString(record.id);
  if (!id) {
    return null;
  }
  return {
    id,
    title: readString(record.title) ?? readString(record.name) ?? id,
    summary: readString(record.summary) ?? readString(record.description) ?? "",
    requiredInputs: readStringArray(record.requiredInputs),
    inputSchema: asRecord(record.inputSchema),
    outputSchema: asRecord(record.outputSchema),
    attributes: asRecord(record.attributes),
    enabled: readBoolean(record.enabled, true),
    version: readString(record.version),
  };
}

function resolveProviderOrder(value: unknown): SpiraMediaProviderOrder[] {
  const order = readStringArray(value)
    .filter((entry): entry is SpiraMediaProviderOrder =>
      entry === "spira" || entry === "viral-well-tools",
    )
    .filter((entry, index, list) => list.indexOf(entry) === index);
  return order.length > 0 ? order : ["spira", "viral-well-tools"];
}

function normalizeMediaActionMap(value: unknown): Partial<Record<MediaAction, { workflowId: string }>> {
  const record = asRecord(value);
  const result: Partial<Record<MediaAction, { workflowId: string }>> = {};
  for (const action of ["text_to_image", "image_to_video", "video_frames", "caption_video"] as const) {
    const workflowId = readString(asRecord(record[action]).workflowId);
    if (workflowId) {
      result[action] = { workflowId };
    }
  }
  return result;
}

function normalizeMediaEndpoints(value: unknown): Partial<Record<MediaAction, string>> {
  const record = asRecord(value);
  const result: Partial<Record<MediaAction, string>> = {};
  for (const action of ["text_to_image", "image_to_video", "video_frames", "caption_video"] as const) {
    const endpoint = readString(record[action]);
    if (endpoint) {
      result[action] = endpoint;
    }
  }
  return result;
}

export function resolveSpiraPluginConfig(
  raw: unknown,
  env: NodeJS.ProcessEnv = process.env,
): SpiraPluginConfig {
  const root = asRecord(raw);
  const workflowsRaw = asRecord(root.workflows);
  const mediaRaw = asRecord(root.media);
  const mediaSpiraRaw = asRecord(mediaRaw.spira);
  const mediaViralWellRaw = asRecord(mediaRaw.viralWellTools);
  const publishRaw = asRecord(root.publish);

  const workflowCatalog = Array.isArray(workflowsRaw.catalog)
    ? workflowsRaw.catalog.map(normalizeCatalogEntry).filter((entry): entry is WorkflowCatalogEntry => Boolean(entry))
    : [];

  return {
    workflows: {
      baseUrl: readString(workflowsRaw.baseUrl) ?? readString(env.SPIRA_WORKFLOWS_BASE_URL),
      apiKey: readString(workflowsRaw.apiKey) ?? readString(env.SPIRA_WORKFLOWS_API_KEY),
      catalogUrl: readString(workflowsRaw.catalogUrl) ?? readString(env.SPIRA_WORKFLOWS_CATALOG_URL),
      runPath: readString(workflowsRaw.runPath) ?? "/api/workflows/runs",
      statusPathTemplate:
        readString(workflowsRaw.statusPathTemplate) ?? "/api/workflows/runs/{runId}",
      catalog: workflowCatalog,
    },
    media: {
      defaultProviderOrder: resolveProviderOrder(mediaRaw.defaultProviderOrder),
      spira: {
        enabled: readBoolean(mediaSpiraRaw.enabled, true),
        baseUrl: readString(mediaSpiraRaw.baseUrl) ?? readString(env.SPIRA_MEDIA_SPIRA_BASE_URL),
        apiKey: readString(mediaSpiraRaw.apiKey) ?? readString(env.SPIRA_MEDIA_SPIRA_API_KEY),
        runPath: readString(mediaSpiraRaw.runPath) ?? "/api/workflows/runs",
        statusPathTemplate:
          readString(mediaSpiraRaw.statusPathTemplate) ?? "/api/workflows/runs/{runId}",
        actions: normalizeMediaActionMap(mediaSpiraRaw.actions),
      },
      viralWellTools: {
        enabled: readBoolean(mediaViralWellRaw.enabled, true),
        baseUrl:
          readString(mediaViralWellRaw.baseUrl) ?? readString(env.VIRAL_WELL_TOOLS_BASE_URL),
        apiKey:
          readString(mediaViralWellRaw.apiKey) ?? readString(env.VIRAL_WELL_TOOLS_API_KEY),
        statusPathTemplate:
          readString(mediaViralWellRaw.statusPathTemplate) ??
          readString(env.VIRAL_WELL_TOOLS_STATUS_PATH_TEMPLATE),
        endpoints: normalizeMediaEndpoints(mediaViralWellRaw.endpoints),
      },
    },
    publish: {
      enabled: readBoolean(publishRaw.enabled, true),
      baseUrl: readString(publishRaw.baseUrl) ?? readString(env.SPIRA_PUBLISH_BASE_URL),
      apiKey: readString(publishRaw.apiKey) ?? readString(env.SPIRA_PUBLISH_API_KEY),
    },
  };
}
