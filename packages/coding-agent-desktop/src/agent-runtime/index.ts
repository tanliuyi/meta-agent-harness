export {
	AgentSession,
	type AgentSessionConfig,
	type AgentSessionEvent,
	type AgentSessionEventListener,
	type ExtensionBindings,
	type ModelCycleResult,
	type PromptOptions,
	type SessionStats,
} from "./core/agent-session.ts";
export {
	AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	type CreateAgentSessionRuntimeResult,
	createAgentSessionRuntime,
} from "./core/agent-session-runtime.ts";
export {
	type AgentSessionRuntimeDiagnostic,
	type AgentSessionServices,
	type CreateAgentSessionFromServicesOptions,
	type CreateAgentSessionServicesOptions,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "./core/agent-session-services.ts";
export { createAgentSession, type CreateAgentSessionOptions, type PromptTemplate } from "./core/sdk.ts";
export { AuthStorage } from "./core/auth-storage.ts";
export { formatNoModelsAvailableMessage } from "./core/auth-guidance.ts";
export { exportFromFile } from "./core/export-html/index.ts";
export { type CustomMessage } from "./core/messages.ts";
export { ModelRegistry } from "./core/model-registry.ts";
export {
	resolveCliModel,
	resolveModelScope,
	resolveModelScopeWithDiagnostics,
	type ScopedModel,
} from "./core/model-resolver.ts";
export {
	assertValidSessionId,
	buildContextEntries,
	buildSessionContext,
	sessionEntryToContextMessages,
	SessionManager,
	type ModelChangeEntry,
	type SessionEntry,
	type SessionInfoEntry,
	type SessionTreeNode,
	type ThinkingLevelChangeEntry,
} from "./core/session-manager.ts";
export {
	MissingSessionCwdError,
	formatMissingSessionCwdPrompt,
	getMissingSessionCwdIssue,
	resolveSessionCwd,
} from "./core/session-cwd.ts";
export { SettingsManager, type PackageSource, type TransportSetting } from "./core/settings-manager.ts";
export { DefaultPackageManager } from "./core/package-manager.ts";
export {
	resolveProjectTrusted,
	type AppMode,
} from "./core/project-trust.ts";
export { hasTrustRequiringProjectResources, ProjectTrustStore } from "./core/trust-manager.ts";
export {
	ExtensionRunner,
	type ContextUsage,
	type ExtensionCommandContextActions,
	type ExtensionContext,
	type ExtensionUIContext,
	type ExtensionUIDialogOptions,
	type ProjectTrustContext,
	type ProjectTrustContext as ExtensionProjectTrustContext,
	type WorkingIndicatorOptions,
} from "./core/extensions/index.ts";
export type { RpcSlashCommand } from "./modes/rpc/rpc-types.ts";
export { KeybindingsManager, type KeyId } from "./core/keybindings.ts";
export { applyHttpProxySettings, configureHttpDispatcher } from "./core/http-dispatcher.ts";
export { restoreStdout, takeOverStdout } from "./core/output-guard.ts";
export { createSyntheticSourceInfo, type SourceInfo } from "./core/source-info.ts";
export { printTimings, resetTimings, time } from "./core/timings.ts";
export { getAgentDir, getPackageDir, ENV_SESSION_DIR, VERSION, expandTildePath } from "./config.ts";
export { runMigrations } from "./migrations.ts";
export { handleConfigCommand, handlePackageCommand } from "./package-manager-cli.ts";
export { type Args, type Mode, parseArgs, printHelp } from "./cli/args.ts";
export { buildInitialMessage } from "./cli/initial-message.ts";
export { listModels } from "./cli/list-models.ts";
export { processFileArguments } from "./cli/file-processor.ts";
export { runPrintMode } from "./modes/print-mode.ts";
export { runRpcMode } from "./modes/rpc/rpc-mode.ts";
export type { RpcCommand, RpcResponse, RpcSessionState } from "./modes/rpc/rpc-types.ts";
export { isLocalPath, normalizePath, resolvePath } from "./utils/paths.ts";
export { cleanupWindowsSelfUpdateQuarantine } from "./utils/windows-self-update.ts";
