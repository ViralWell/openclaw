import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { resolveSpiraPluginConfig } from "./src/config.js";
import { createSpiraMediaTool } from "./src/media/tool.js";
import { createSpiraPublishTool } from "./src/publish/tool.js";
import { createSpiraWorkflowTool } from "./src/workflows/tool.js";

const spiraPlugin = {
  id: "spira",
  name: "Spira",
  description: "Spira workflow/media/publish plugin",
  register(api: OpenClawPluginApi) {
    const config = resolveSpiraPluginConfig(api.pluginConfig);
    api.registerTool((ctx) =>
      createSpiraWorkflowTool({
        config,
        agentId: ctx.agentId,
      }),
    );
    api.registerTool((ctx) =>
      createSpiraMediaTool({
        config,
        agentId: ctx.agentId,
      }),
    );
    api.registerTool((ctx) =>
      createSpiraPublishTool({
        config,
        agentId: ctx.agentId,
      }),
    );
  },
};

export default spiraPlugin;
