export function joinUrl(baseUrl: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  return new URL(pathOrUrl, ensureTrailingSlash(baseUrl)).toString();
}

export function applyTemplate(template: string, values: Record<string, string>): string {
  let next = template;
  for (const [key, value] of Object.entries(values)) {
    next = next.replaceAll(`{${key}}`, encodeURIComponent(value));
  }
  return next;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function tryParseJson<T>(text: string): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return { ok: false };
  }
}

function buildHttpErrorMessage(params: {
  response: Response;
  text: string;
  parsed: unknown;
}): string {
  if (
    params.parsed &&
    typeof params.parsed === "object" &&
    "error" in (params.parsed as Record<string, unknown>)
  ) {
    return String((params.parsed as Record<string, unknown>).error);
  }

  const trimmed = params.text.trim();
  const excerpt = trimmed.slice(0, 300);
  const suffix = trimmed.length > excerpt.length ? "..." : "";
  const fallback = `${params.response.status} ${params.response.statusText}`;
  return excerpt ? `${fallback}: ${excerpt}${suffix}` : fallback;
}

export async function fetchJson<T>(params: {
  baseUrl: string;
  path: string;
  method?: "GET" | "POST";
  apiKey?: string;
  body?: unknown;
  fetchImpl?: typeof fetch;
}): Promise<T> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    accept: "application/json",
  };
  if (params.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (params.apiKey?.trim()) {
    headers.authorization = `Bearer ${params.apiKey.trim()}`;
  }

  const response = await fetchImpl(joinUrl(params.baseUrl, params.path), {
    method: params.method ?? "GET",
    headers,
    body: params.body === undefined ? undefined : JSON.stringify(params.body),
  });

  const text = await response.text();
  const trimmed = text.trim();
  const parsedResult = trimmed ? tryParseJson<T>(trimmed) : { ok: true as const, value: {} as T };
  const parsed = parsedResult.ok ? parsedResult.value : undefined;
  if (!response.ok) {
    throw new Error(
      buildHttpErrorMessage({
        response,
        text,
        parsed,
      }),
    );
  }

  if (!trimmed) {
    return {} as T;
  }
  if (!parsedResult.ok) {
    throw new Error(`invalid JSON response from ${joinUrl(params.baseUrl, params.path)}`);
  }
  return parsedResult.value;
}
