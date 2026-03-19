import type { WorkflowCatalogEntry } from "./catalog.js";

function describeType(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function matchesSchemaType(expected: string, value: unknown): boolean {
  if (expected === "array") {
    return Array.isArray(value);
  }
  if (expected === "object") {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  return typeof value === expected;
}

export function validateWorkflowInputs(workflow: WorkflowCatalogEntry, inputs: unknown): void {
  const schema = workflow.inputSchema;
  const requiredFromSchema = Array.isArray(schema.required)
    ? schema.required.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const required = Array.from(new Set([...workflow.requiredInputs, ...requiredFromSchema]));

  const record =
    inputs && typeof inputs === "object" && !Array.isArray(inputs)
      ? (inputs as Record<string, unknown>)
      : null;

  if (required.length > 0 && !record) {
    throw new Error("inputs must be an object");
  }

  for (const key of required) {
    const value = record?.[key];
    if (value === undefined || value === null || value === "") {
      throw new Error(`missing required input: ${key}`);
    }
  }

  const properties =
    schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
      ? (schema.properties as Record<string, unknown>)
      : {};

  if (record && schema.additionalProperties === false) {
    for (const key of Object.keys(record)) {
      if (!(key in properties)) {
        throw new Error(`unexpected input field: ${key}`);
      }
    }
  }

  for (const [key, specRaw] of Object.entries(properties)) {
    if (!record || !(key in record)) {
      continue;
    }
    const spec =
      specRaw && typeof specRaw === "object" && !Array.isArray(specRaw)
        ? (specRaw as Record<string, unknown>)
        : {};
    const expectedType = typeof spec.type === "string" ? spec.type : undefined;
    if (!expectedType) {
      continue;
    }
    const value = record[key];
    if (!matchesSchemaType(expectedType, value)) {
      throw new Error(
        `invalid input type for ${key}: expected ${expectedType}, got ${describeType(value)}`,
      );
    }
  }
}
