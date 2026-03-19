import type { WorkflowCatalogEntry } from "./catalog.js";

type AgentWorkflowRules = Record<string, string[]>;

const HARD_CODED_BLOCKLIST_BY_AGENT: AgentWorkflowRules = Object.freeze({});

export function filterWorkflowsForAgentWithRules(
  agentId: string | undefined,
  workflows: WorkflowCatalogEntry[],
  rules: AgentWorkflowRules = HARD_CODED_BLOCKLIST_BY_AGENT,
): WorkflowCatalogEntry[] {
  if (!agentId?.trim()) {
    return workflows;
  }
  const blocked = new Set(rules[agentId] ?? []);
  if (blocked.size === 0) {
    return workflows;
  }
  return workflows.filter((workflow) => !blocked.has(workflow.id));
}

export function isWorkflowAllowedForAgentWithRules(
  agentId: string | undefined,
  workflowId: string,
  workflows: WorkflowCatalogEntry[],
  rules: AgentWorkflowRules = HARD_CODED_BLOCKLIST_BY_AGENT,
): boolean {
  return filterWorkflowsForAgentWithRules(agentId, workflows, rules).some(
    (workflow) => workflow.id === workflowId,
  );
}
