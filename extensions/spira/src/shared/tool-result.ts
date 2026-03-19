type ToolResultPayload = {
  status: string;
  [key: string]: unknown;
};

export function buildToolResult(payload: ToolResultPayload) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    details: payload,
  };
}
