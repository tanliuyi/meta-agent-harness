/**
 * Extension system for lifecycle events and custom tools.
 */

export type { SlashCommandInfo, SlashCommandSource } from '../slash-commands.ts'
export type { SourceInfo } from '../source-info.ts'
export {
  createExtensionRuntime,
  discoverAndLoadExtensions,
  loadExtensionFromFactory,
  loadExtensions
} from './loader.ts'
export type {
  ExtensionErrorListener,
  ForkHandler,
  NavigateTreeHandler,
  NewSessionHandler,
  ShutdownHandler,
  SwitchSessionHandler
} from './runner.ts'
export { ExtensionRunner } from './runner.ts'
export { desktopWebviewHostStylesheetPath } from './types.ts'
export type {
  AfterProviderResponseEvent,
  AgentEndEvent,
  AgentStartEvent,
  // Re-exports
  AgentToolResult,
  AgentToolUpdateCallback,
  AppendEntryHandler,
  // App keybindings (for custom editors)
  AppKeybinding,
  // Events - Tool (ToolCallEvent types)
  BashToolCallEvent,
  BashToolResultEvent,
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  BeforeProviderRequestEvent,
  BeforeProviderRequestEventResult,
  BuildSystemPromptOptions,
  // Context
  CompactOptions,
  // Events - Agent
  ContextEvent,
  // Event Results
  ContextEventResult,
  ContextUsage,
  CustomToolCallEvent,
  CustomToolResultEvent,
  EditToolCallEvent,
  DesktopPanelDisposedEvent,
  DesktopPanelMessageEvent,
  DesktopPanelRestoreEvent,
  DesktopPanelViewStateChangedEvent,
  DesktopWebviewUriOptions,
  EditToolResultEvent,
  ExecOptions,
  ExecResult,
  Extension,
  ExtensionActions,
  // API
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionCommandContextActions,
  DesktopWebviewPanelOptions,
  DesktopWebviewPanelSource,
  ExtensionContext,
  ExtensionContextActions,
  ExtensionDesktopContext,
  // Errors
  ExtensionError,
  ExtensionEvent,
  ExtensionFactory,
  ExtensionFlag,
  ExtensionHandler,
  ExtensionMode,
  // Runtime
  ExtensionRuntime,
  ExtensionShortcut,
  ExtensionTheme,
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  ExtensionWidgetOptions,
  FindToolCallEvent,
  FindToolResultEvent,
  GetActiveToolsHandler,
  GetAllToolsHandler,
  GetCommandsHandler,
  GetThinkingLevelHandler,
  GrepToolCallEvent,
  GrepToolResultEvent,
  // Events - Input
  InputEvent,
  InputEventResult,
  InputSource,
  KeybindingsManager,
  LoadExtensionsResult,
  LsToolCallEvent,
  LsToolResultEvent,
  // Events - Message
  MessageEndEvent,
  MessageStartEvent,
  MessageUpdateEvent,
  ModelSelectEvent,
  ModelSelectSource,
  ProjectTrustContext,
  ProjectTrustEvent,
  ProjectTrustEventDecision,
  ProjectTrustEventResult,
  ProjectTrustHandler,
  // Provider Registration
  ProviderConfig,
  ProviderModelConfig,
  ReadToolCallEvent,
  ReadToolResultEvent,
  // Commands
  RegisteredCommand,
  RegisteredTool,
  ReplacedSessionContext,
  ResolvedCommand,
  // Events - Resources
  ResourcesDiscoverEvent,
  ResourcesDiscoverResult,
  SendMessageHandler,
  SendUserMessageHandler,
  SessionBeforeCompactEvent,
  SessionBeforeCompactResult,
  SessionBeforeForkEvent,
  SessionBeforeForkResult,
  SessionBeforeSwitchEvent,
  SessionBeforeSwitchResult,
  SessionBeforeTreeEvent,
  SessionBeforeTreeResult,
  SessionCompactEvent,
  SessionEvent,
  SessionShutdownEvent,
  // Events - Session
  SessionStartEvent,
  SessionTreeEvent,
  SetActiveToolsHandler,
  SetLabelHandler,
  SetModelHandler,
  SetThinkingLevelHandler,
  // Events - Tool
  ToolCallEvent,
  ToolCallEventResult,
  // Tools
  ToolDefinition,
  // Events - Tool Execution
  ToolExecutionEndEvent,
  // Tool execution mode
  ToolExecutionMode,
  ToolExecutionStartEvent,
  ToolExecutionUpdateEvent,
  ToolInfo,
  ToolResultEvent,
  ToolResultEventResult,
  TerminalInputHandler,
  TreePreparation,
  TurnEndEvent,
  TurnStartEvent,
  // Events - User Bash
  UserBashEvent,
  UserBashEventResult,
  WidgetPlacement,
  WorkingIndicatorOptions,
  WriteToolCallEvent,
  WriteToolResultEvent
} from './types.ts'
// Type guards
export {
  defineTool,
  isBashToolResult,
  isEditToolResult,
  isFindToolResult,
  isGrepToolResult,
  isLsToolResult,
  isReadToolResult,
  isToolCallEventType,
  isWriteToolResult
} from './types.ts'
export { wrapRegisteredTool, wrapRegisteredTools } from './wrapper.ts'
