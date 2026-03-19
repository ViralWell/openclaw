import { Type } from "@sinclair/typebox";
import type { SpiraPluginConfig } from "../config.js";
import { stringEnum } from "../shared/schema.js";
import { buildToolResult } from "../shared/tool-result.js";
import { filterWorkflowCatalogByContext, summarizeWorkflowCatalogEntry } from "./catalog.js";
import { getWorkflowRunStatus, loadWorkflowCatalog, startWorkflowRun } from "./client.js";
import { filterWorkflowsForAgentWithRules, isWorkflowAllowedForAgentWithRules } from "./policy.js";
import { validateWorkflowInputs } from "./validation.js";

const WORKFLOW_ACTIONS = ["list", "describe", "run", "status"] as const;

const SpiraWorkflowToolSchema = Type.Object(
  {
    action: stringEnum(WORKFLOW_ACTIONS, "Workflow action: list, describe, run, or status."),
    agentId: Type.Optional(Type.String({ description: "Optional agent override." })),
    workflowId: Type.Optional(Type.String({ description: "Workflow id for describe/run." })),
    runId: Type.Optional(Type.String({ description: "Run id for status." })),
    context: Type.Optional(
      Type.Unknown({ description: "Structured workflow selection context for list." }),
    ),
    inputs: Type.Optional(Type.Unknown({ description: "Structured workflow inputs for run." })),
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

export function createSpiraWorkflowTool(params: {
  config: SpiraPluginConfig;
  agentId?: string;
  fetchImpl?: typeof fetch;
}) {
  return {
    name: "spira_workflow",
    label: "Spira Workflow",
    description:
      "List, inspect, start, and check the status of fixed Spira workflows with optional agent-aware filtering.",
    parameters: SpiraWorkflowToolSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const action = readOptionalString(rawParams.action);
      const effectiveAgentId = readOptionalString(rawParams.agentId) ?? params.agentId;
      if (!action) {
        throw new Error("action required");
      }

      if (action === "status") {
        const runId = readOptionalString(rawParams.runId);
        if (!runId) {
          throw new Error("runId required");
        }
        const result = await getWorkflowRunStatus({
          config: params.config.workflows,
          runId,
          fetchImpl: params.fetchImpl,
        });
        return buildToolResult({
          status: "ok",
          action,
          agentId: effectiveAgentId ?? null,
          run: result,
        });
      }

      const catalog = await loadWorkflowCatalog(params.config.workflows, params.fetchImpl);
      const context = rawParams.context;
      const filteredByContext = filterWorkflowCatalogByContext(catalog, context);
      const filtered = filterWorkflowsForAgentWithRules(effectiveAgentId, filteredByContext);
      const allowedForAgent = filterWorkflowsForAgentWithRules(effectiveAgentId, catalog);

      if (action === "list") {
        return buildToolResult({
          status: "ok",
          action,
          agentId: effectiveAgentId ?? null,
          workflows: filtered.map(summarizeWorkflowCatalogEntry),
        });
      }

      const workflowId = readOptionalString(rawParams.workflowId);
      if (!workflowId) {
        throw new Error("workflowId required");
      }

      const workflow = allowedForAgent.find((entry) => entry.id === workflowId);
      if (!workflow) {
        const existsUnfiltered = catalog.some((entry) => entry.id === workflowId);
        if (existsUnfiltered && !isWorkflowAllowedForAgentWithRules(effectiveAgentId, workflowId, catalog)) {
          throw new Error(`workflow "${workflowId}" is filtered out for agent "${effectiveAgentId}"`);
        }
        throw new Error(`workflow "${workflowId}" not found`);
      }

      if (action === "describe") {
        return buildToolResult({
          status: "ok",
          action,
          agentId: effectiveAgentId ?? null,
          workflow,
        });
      }

      if (action === "run") {
        const inputs = rawParams.inputs;
        validateWorkflowInputs(workflow, inputs);
        const result = await startWorkflowRun({
          config: params.config.workflows,
          workflowId,
          inputs,
          fetchImpl: params.fetchImpl,
        });
        return buildToolResult({
          status: "ok",
          action,
          agentId: effectiveAgentId ?? null,
          workflowId,
          runId: result.runId,
          runStatus: result.status,
          createdAt: result.createdAt ?? null,
        });
      }

      throw new Error(`unsupported action: ${action}`);
    },
  };
}
