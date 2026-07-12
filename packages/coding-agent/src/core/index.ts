/**
 * Core modules shared between all run modes.
 */

export {
  AgentSession,
  type AgentSessionConfig,
  type AgentSessionEvent,
  type AgentSessionEventListener,
  type ModelCycleResult,
  type PromptOptions,
  type SessionStats
} from './agent-session.ts'
export {
  AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  type CreateAgentSessionRuntimeResult,
  createAgentSessionRuntime
} from './agent-session-runtime.ts'
export {
  type AgentSessionRuntimeDiagnostic,
  type AgentSessionServices,
  type CreateAgentSessionFromServicesOptions,
  type CreateAgentSessionServicesOptions,
  createAgentSessionFromServices,
  createAgentSessionServices
} from './agent-session-services.ts'
export {
  type BashExecutorOptions,
  type BashResult,
  executeBashWithOperations
} from './bash-executor.ts'
export type { CompactionResult } from './compaction/index.ts'
export { createEventBus, type EventBus, type EventBusController } from './event-bus.ts'
export { areExperimentalFeaturesEnabled } from './experimental.ts'
// Extensions system
export {
  type AgentEndEvent,
  type AgentStartEvent,
  type AgentToolResult,
  type AgentToolUpdateCallback,
  type BeforeAgentStartEvent,
  type BeforeAgentStartEventResult,
  type BuildSystemPromptOptions,
  type ContextEvent,
  type DesktopPanelDisposedEvent,
  type DesktopPanelMessageEvent,
  type DesktopPanelRestoreEvent,
  type DesktopPanelViewStateChangedEvent,
  desktopWebviewHostStylesheetPath,
  defineTool,
  discoverAndLoadExtensions,
  type ExecOptions,
  type ExecResult,
  type DesktopWebviewPanelOptions,
  type DesktopWebviewPanelSource,
  type DesktopWebviewUriOptions,
  type Extension,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type ExtensionDesktopContext,
  type ExtensionError,
  type ExtensionEvent,
  type ExtensionFactory,
  type ExtensionFlag,
  type ExtensionHandler,
  ExtensionRunner,
  type ExtensionShortcut,
  type ExtensionUIContext,
  type LoadExtensionsResult,
  type RegisteredCommand,
  type SessionBeforeCompactEvent,
  type SessionBeforeForkEvent,
  type SessionBeforeSwitchEvent,
  type SessionBeforeTreeEvent,
  type SessionCompactEvent,
  type SessionShutdownEvent,
  type SessionStartEvent,
  type SessionTreeEvent,
  type ToolCallEvent,
  type ToolCallEventResult,
  type ToolDefinition,
  type ToolResultEvent,
  type TurnEndEvent,
  type TurnStartEvent,
  type WorkingIndicatorOptions
} from './extensions/index.ts'
export { createSyntheticSourceInfo } from './source-info.ts'
export {
  buildResourcesSnapshot,
  type ExtensionCommandSnapshot,
  type ExtensionFlagSnapshot,
  type ExtensionSnapshot,
  type ExtensionToolSnapshot,
  type ResourcePathSnapshot,
  type ResourcesSnapshot
} from './resource-snapshot.ts'
