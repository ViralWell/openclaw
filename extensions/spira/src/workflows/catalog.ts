export type WorkflowCatalogEntry = {
  id: string;
  title: string;
  summary: string;
  requiredInputs: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  attributes: Record<string, unknown>;
  enabled: boolean;
  version?: string;
};

function matchesContextValue(attribute: unknown, contextValue: unknown): boolean {
  if (attribute === undefined) {
    return true;
  }
  if (Array.isArray(attribute)) {
    if (typeof contextValue === "string") {
      return attribute.includes(contextValue);
    }
    if (Array.isArray(contextValue)) {
      return contextValue.some((value) => attribute.includes(value));
    }
    return false;
  }
  if (typeof attribute === "boolean") {
    return attribute === contextValue;
  }
  if (typeof attribute === "string") {
    if (Array.isArray(contextValue)) {
      return contextValue.includes(attribute);
    }
    return attribute === contextValue;
  }
  return true;
}

export function filterWorkflowCatalogByContext(
  workflows: WorkflowCatalogEntry[],
  context: unknown,
): WorkflowCatalogEntry[] {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return workflows.filter((entry) => entry.enabled);
  }
  const contextRecord = context as Record<string, unknown>;
  return workflows.filter((workflow) => {
    if (!workflow.enabled) {
      return false;
    }
    for (const [key, value] of Object.entries(workflow.attributes)) {
      if (!matchesContextValue(value, contextRecord[key])) {
        return false;
      }
    }
    return true;
  });
}

export function summarizeWorkflowCatalogEntry(entry: WorkflowCatalogEntry) {
  return {
    id: entry.id,
    title: entry.title,
    summary: entry.summary,
    attributes: entry.attributes,
    requiredInputs: entry.requiredInputs,
    outputSummary: {
      schemaVersion: entry.version ?? "v1",
      outputKeys: Object.keys(entry.outputSchema),
    },
  };
}
