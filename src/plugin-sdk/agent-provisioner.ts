// Narrow plugin-sdk surface for the bundled agent-provisioner plugin.
// Keep this list additive and scoped to symbols used under extensions/agent-provisioner.

export type { OpenClawConfig } from "../config/config.js";
export type { OpenClawPluginApi } from "../plugins/types.js";
export { emptyPluginConfigSchema } from "../plugins/config-schema.js";
export {
  beginWebhookRequestPipelineOrReject,
  readJsonWebhookBodyOrReject,
} from "./webhook-request-guards.js";
export { resolveAgentDir } from "../agents/agent-scope.js";
export { DEFAULT_IDENTITY_FILENAME, ensureAgentWorkspace } from "../agents/workspace.js";
export {
  applyAgentBindings,
  describeBinding,
  parseBindingSpecs,
} from "../commands/agents.bindings.js";
export {
  applyAgentConfig,
  buildAgentSummaries,
  findAgentEntryIndex,
  listAgentEntries,
} from "../commands/agents.config.js";
export { isRouteBinding, listRouteBindings } from "../config/bindings.js";
export { resolveStateDir } from "../config/paths.js";
export { resolveSessionTranscriptsDirForAgent } from "../config/sessions/paths.js";
export { normalizeAgentId } from "../routing/session-key.js";
export { resolveUserPath } from "../utils.js";
