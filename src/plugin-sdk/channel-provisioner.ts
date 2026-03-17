// Narrow plugin-sdk surface for the bundled channel-provisioner plugin.
// Keep this list additive and scoped to symbols used under extensions/channel-provisioner.

export type { OpenClawPluginApi } from "../plugins/types.js";
export type { OpenClawConfig } from "../config/config.js";
export type {
  ChannelResolveKind,
  ChannelResolveResult,
  ChannelSetupInput,
} from "../channels/plugins/types.js";
export { emptyPluginConfigSchema } from "../plugins/config-schema.js";
export {
  beginWebhookRequestPipelineOrReject,
  readJsonWebhookBodyOrReject,
} from "./webhook-request-guards.js";
export {
  getChannelPlugin,
  listChannelPlugins,
  normalizeChannelId,
} from "../channels/plugins/index.js";
export { moveSingleAccountChannelSectionToDefaultAccount } from "../channels/plugins/setup-helpers.js";
export { addWildcardAllowFrom } from "../channels/plugins/onboarding/helpers.js";
export { patchScopedAccountConfig } from "../channels/plugins/setup-helpers.js";
export { buildChannelAccountSnapshot } from "../channels/plugins/status.js";
export { applyChannelAccountConfig } from "../commands/channels/add-mutators.js";
export { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";
export { defaultRuntime } from "../runtime.js";
export { resolveTelegramAccount } from "../telegram/accounts.js";
export { deleteTelegramUpdateOffset } from "../telegram/update-offset-store.js";
