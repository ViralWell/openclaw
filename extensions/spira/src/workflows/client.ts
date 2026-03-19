import type { SpiraWorkflowConfig } from "../config.js";
import { applyTemplate, fetchJson } from "../shared/http.js";
import type { WorkflowCatalogEntry } from "./catalog.js";

type WorkflowCatalogPayload =
  | WorkflowCatalogEntry[]
  | {
      workflows?: WorkflowCatalogEntry[];
      items?: WorkflowCatalogEntry[];
    };

export async function loadWorkflowCatalog(
  config: SpiraWorkflowConfig,
  fetchImpl?: typeof fetch,
): Promise<WorkflowCatalogEntry[]> {
  if (config.catalog.length > 0) {
    return config.catalog;
  }
  if (!config.baseUrl || !config.catalogUrl) {
    throw new Error("spira workflow catalog not configured");
  }
  const payload = await fetchJson<WorkflowCatalogPayload>({
    baseUrl: config.baseUrl,
    path: config.catalogUrl,
    apiKey: config.apiKey,
    fetchImpl,
  });
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload.workflows)) {
    return payload.workflows;
  }
  if (Array.isArray(payload.items)) {
    return payload.items;
  }
  throw new Error("spira workflow catalog response shape is invalid");
}

export async function startWorkflowRun(params: {
  config: SpiraWorkflowConfig;
  workflowId: string;
  inputs: unknown;
  fetchImpl?: typeof fetch;
}) {
  if (!params.config.baseUrl) {
    throw new Error("spira workflow baseUrl not configured");
  }
  return await fetchJson<{
    runId: string;
    status: string;
    createdAt?: number;
  }>({
    baseUrl: params.config.baseUrl,
    path: params.config.runPath,
    method: "POST",
    apiKey: params.config.apiKey,
    body: {
      workflowId: params.workflowId,
      inputs: params.inputs,
    },
    fetchImpl: params.fetchImpl,
  });
}

export async function getWorkflowRunStatus(params: {
  config: SpiraWorkflowConfig;
  runId: string;
  fetchImpl?: typeof fetch;
}) {
  if (!params.config.baseUrl) {
    throw new Error("spira workflow baseUrl not configured");
  }
  return await fetchJson<Record<string, unknown>>({
    baseUrl: params.config.baseUrl,
    path: applyTemplate(params.config.statusPathTemplate, { runId: params.runId }),
    apiKey: params.config.apiKey,
    fetchImpl: params.fetchImpl,
  });
}
