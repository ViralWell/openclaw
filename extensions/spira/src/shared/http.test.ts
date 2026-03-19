import { describe, expect, it, vi } from "vitest";
import { fetchJson } from "./http.js";

describe("fetchJson", () => {
  it("surfaces non-JSON error bodies with status context", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      text: async () => "<html>upstream exploded</html>",
    })) as unknown as typeof fetch;

    await expect(
      fetchJson({
        baseUrl: "https://spira.example.com",
        path: "/api/workflows/runs",
        fetchImpl,
      }),
    ).rejects.toThrow("502 Bad Gateway: <html>upstream exploded</html>");
  });

  it("throws a clear error when a successful response is not valid JSON", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "not-json",
    })) as unknown as typeof fetch;

    await expect(
      fetchJson({
        baseUrl: "https://spira.example.com",
        path: "/api/workflows/runs",
        fetchImpl,
      }),
    ).rejects.toThrow("invalid JSON response from https://spira.example.com/api/workflows/runs");
  });
});
