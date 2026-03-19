import { describe, expect, it, vi } from "vitest";
import { resolveSpiraPluginConfig } from "../config.js";
import { createSpiraMediaTool } from "./tool.js";

describe("spira_media tool", () => {
  it("routes image_to_video to a spira workflow mapping first", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 201,
      statusText: "Created",
      text: async () =>
        JSON.stringify({
          runId: "run-media-1",
          status: "running",
          createdAt: 42,
        }),
    })) as unknown as typeof fetch;

    const config = resolveSpiraPluginConfig({
      media: {
        spira: {
          baseUrl: "https://spira.example.com",
          actions: {
            image_to_video: {
              workflowId: "wf-image-to-video",
            },
          },
        },
      },
    });

    const tool = createSpiraMediaTool({ config, agentId: "influencer-a", fetchImpl });
    const result = (await tool.execute("call-1", {
      action: "image_to_video",
      images: ["https://example.com/a.png"],
      prompt: "Animate this image",
    })) as { details: { provider: string; workflowId: string; runId: string } };

    expect(result.details.provider).toBe("spira");
    expect(result.details.workflowId).toBe("wf-image-to-video");
    expect(result.details.runId).toBe("run-media-1");
  });

  it("falls back to viral-well-tools when the preferred spira provider errors", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Server Error",
        text: async () => JSON.stringify({ error: "spira down" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () =>
          JSON.stringify({
            jobId: "job-1",
            status: "queued",
            outputs: { imageUrl: "https://example.com/out.png" },
          }),
      });

    const config = resolveSpiraPluginConfig({
      media: {
        spira: {
          baseUrl: "https://spira.example.com",
          actions: {
            text_to_image: {
              workflowId: "wf-text-to-image",
            },
          },
        },
        viralWellTools: {
          baseUrl: "https://tools.example.com",
          endpoints: {
            text_to_image: "/text-to-image",
          },
        },
      },
    });

    const tool = createSpiraMediaTool({ config, fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = (await tool.execute("call-1", {
      action: "text_to_image",
      prompt: "Create a thumbnail",
    })) as { details: { provider: string; jobId: string; jobStatus: string } };

    expect(result.details.provider).toBe("viral-well-tools");
    expect(result.details.jobId).toBe("job-1");
    expect(result.details.jobStatus).toBe("queued");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
