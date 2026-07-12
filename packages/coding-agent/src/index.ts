/**
 * 本文件导出 coding-agent 包的公共 API。
 */

// Core session management

export { type Args, type Mode, parseArgs, printHelp } from './cli/args.ts'
export { processFileArguments } from './cli/file-processor.ts'
export { buildInitialMessage } from './cli/initial-message.ts'
export { listModels } from './cli/list-models.ts'

// Config paths
export {
  CONFIG_DIR_NAME,
  ENV_SESSION_DIR,
  expandTildePath,
  getAgentDir,
  getDocsPath,
  getExamplesPath,
  getPackageDir,
  getReadmePath,
  VERSION
} from './config.ts'
export {
  AgentSession,
  type AgentSessionConfig,
  type AgentSessionEvent,
  type AgentSessionEventListener,
  type ExtensionBindings,
  type ModelCycleResult,
  type ParsedSkillBlock,
  type PromptOptions,
  parseSkillBlock,
  type SessionStats
} from './core/agent-session.ts'
// Auth and model registry
export {
  type ApiKeyCredential,
  type AuthCredential,
  type AuthStatus,
  AuthStorage,
  type AuthStorageBackend,
  FileAuthStorageBackend,
  InMemoryAuthStorageBackend,
  type OAuthCredential
} from './core/auth-storage.ts'
// Compaction
export {
  type BranchPreparation,
  type BranchSummaryResult,
  type CollectEntriesResult,
  type CompactionResult,
  type CutPointResult,
  calculateContextTokens,
  collectEntriesForBranchSummary,
  compact,
  DEFAULT_COMPACTION_SETTINGS,
  estimateTokens,
  type FileOperations,
  findCutPoint,
  findTurnStartIndex,
  type GenerateBranchSummaryOptions,
  generateBranchSummary,
  generateSummary,
  getLastAssistantUsage,
  prepareBranchEntries,
  serializeConversation,
  shouldCompact
} from './core/compaction/index.ts'
export { createEventBus, type EventBus, type EventBusController } from './core/event-bus.ts'
// Extension system
export type {
  AgentEndEvent,
  AgentStartEvent,
  AgentToolResult,
  AgentToolUpdateCallback,
  AppKeybinding,
  BashToolCallEvent,
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  BeforeProviderRequestEvent,
  BeforeProviderRequestEventResult,
  BuildSystemPromptOptions,
  CompactOptions,
  ContextEvent,
  ContextUsage,
  CustomToolCallEvent,
  DesktopPanelDisposedEvent,
  DesktopPanelMessageEvent,
  DesktopPanelRestoreEvent,
  DesktopPanelViewStateChangedEvent,
  EditToolCallEvent,
  ExecOptions,
  ExecResult,
  Extension,
  ExtensionActions,
  DesktopWebviewPanelOptions,
  DesktopWebviewPanelSource,
  DesktopWebviewUriOptions,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionCommandContextActions,
  ExtensionContext,
  ExtensionContextActions,
  ExtensionDesktopContext,
  ExtensionError,
  ExtensionEvent,
  ExtensionFactory,
  ExtensionFlag,
  ExtensionHandler,
  ExtensionRuntime,
  ExtensionShortcut,
  ExtensionTheme,
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  ExtensionWidgetOptions,
  FindToolCallEvent,
  GrepToolCallEvent,
  InputEvent,
  InputEventResult,
  InputSource,
  LoadExtensionsResult,
  LsToolCallEvent,
  ProjectTrustContext,
  ProjectTrustEvent,
  ProjectTrustEventDecision,
  ProjectTrustEventResult,
  ProjectTrustHandler,
  ProviderConfig,
  ProviderModelConfig,
  ReadToolCallEvent,
  RegisteredCommand,
  RegisteredTool,
  ResolvedCommand,
  SessionBeforeCompactEvent,
  SessionBeforeForkEvent,
  SessionBeforeSwitchEvent,
  SessionBeforeTreeEvent,
  SessionCompactEvent,
  SessionShutdownEvent,
  SessionStartEvent,
  SessionTreeEvent,
  SlashCommandInfo,
  SlashCommandSource,
  SourceInfo,
  ToolCallEvent,
  ToolCallEventResult,
  ToolDefinition,
  ToolExecutionMode,
  ToolInfo,
  ToolResultEvent,
  TerminalInputHandler,
  TurnEndEvent,
  TurnStartEvent,
  UserBashEvent,
  UserBashEventResult,
  WidgetPlacement,
  WorkingIndicatorOptions,
  WriteToolCallEvent
} from './core/extensions/index.ts'
export {
  createExtensionRuntime,
  desktopWebviewHostStylesheetPath,
  defineTool,
  discoverAndLoadExtensions,
  ExtensionRunner,
  isBashToolResult,
  isEditToolResult,
  isFindToolResult,
  isGrepToolResult,
  isLsToolResult,
  isReadToolResult,
  isToolCallEventType,
  isWriteToolResult,
  wrapRegisteredTool,
  wrapRegisteredTools
} from './core/extensions/index.ts'
// Footer data provider (git branch + extension statuses - data not otherwise available to extensions)
export type { ReadonlyFooterDataProvider } from './core/footer-data-provider.ts'
export { convertToLlm, type CustomMessage } from './core/messages.ts'
export { ModelRegistry } from './core/model-registry.ts'
export type {
  PackageManager,
  PathMetadata,
  ProgressCallback,
  ProgressEvent,
  ResolvedPaths,
  ResolvedResource
} from './core/package-manager.ts'
export { DefaultPackageManager } from './core/package-manager.ts'
export type {
  ResourceCollision,
  ResourceDiagnostic,
  ResourceLoader
} from './core/resource-loader.ts'
export { DefaultResourceLoader, loadProjectContextFiles } from './core/resource-loader.ts'
export {
  buildResourcesSnapshot,
  type ExtensionCommandSnapshot,
  type ExtensionFlagSnapshot,
  type ExtensionSnapshot,
  type ExtensionToolSnapshot,
  type ResourcePathSnapshot,
  type ResourcesSnapshot
} from './core/resource-snapshot.ts'
// SDK for programmatic usage
export {
  type CreateAgentSessionOptions,
  type CreateAgentSessionResult,
  // Factory
  createAgentSession,
  createBashTool,
  // Tool factories (for custom cwd)
  createCodingTools,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadOnlyTools,
  createReadTool,
  createWriteTool,
  type PromptTemplate
} from './core/sdk.ts'
export {
  AgentSessionRuntime,
  type AgentSessionRuntimeDiagnostic,
  type AgentSessionServices,
  type CreateAgentSessionFromServicesOptions,
  type CreateAgentSessionRuntimeFactory,
  type CreateAgentSessionRuntimeResult,
  type CreateAgentSessionServicesOptions,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices
} from './core/agent-session-runtime.ts'
export {
  type BranchSummaryEntry,
  buildSessionContext,
  type CompactionEntry,
  CURRENT_SESSION_VERSION,
  type CustomEntry,
  type CustomMessageEntry,
  type FileEntry,
  getLatestCompactionEntry,
  type ModelChangeEntry,
  migrateSessionEntries,
  type NewSessionOptions,
  parseSessionEntries,
  type SessionContext,
  type SessionEntry,
  type SessionEntryBase,
  type SessionHeader,
  type SessionInfo,
  type SessionInfoEntry,
  SessionManager,
  type SessionMessageEntry,
  type SessionTreeNode,
  type ThinkingLevelChangeEntry,
  assertValidSessionId,
  resolveSessionCwd
} from './core/session-manager.ts'
export {
  type CompactionSettings,
  type DefaultProjectTrust,
  type ImageSettings,
  type PackageSource,
  type RetrySettings,
  SettingsManager,
  type SettingsManagerCreateOptions
} from './core/settings-manager.ts'
// Skills
export {
  formatSkillsForPrompt,
  type LoadSkillsFromDirOptions,
  type LoadSkillsResult,
  loadSkills,
  loadSkillsFromDir,
  type Skill,
  type SkillFrontmatter
} from './core/skills.ts'
export { formatNoModelsAvailableMessage } from './core/auth-guidance.ts'
export { exportFromFile } from './core/export-html/index.ts'
export { applyHttpProxySettings, configureHttpDispatcher } from './core/http-dispatcher.ts'
export { KeybindingsManager, type KeyId } from './core/keybindings.ts'
export { type ScopedModel, resolveCliModel, resolveModelScope } from './core/model-resolver.ts'
export { restoreStdout, takeOverStdout } from './core/output-guard.ts'
export { type AppMode, resolveProjectTrusted } from './core/project-trust.ts'
export {
  MissingSessionCwdError,
  formatMissingSessionCwdPrompt,
  getMissingSessionCwdIssue
} from './core/session-cwd.ts'
export { createSyntheticSourceInfo } from './core/source-info.ts'
export { printTimings, resetTimings, time } from './core/timings.ts'
export {
  type EditDiffResult,
  generateDiffString,
  generateUnifiedPatch
} from './core/tools/edit-diff.ts'
// Tools
export {
  type BashOperations,
  type BashSpawnContext,
  type BashSpawnHook,
  type BashToolDetails,
  type BashToolInput,
  type BashToolOptions,
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLocalBashOperations,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type EditOperations,
  type EditToolDetails,
  type EditToolInput,
  type EditToolOptions,
  type FindOperations,
  type FindToolDetails,
  type FindToolInput,
  type FindToolOptions,
  formatSize,
  type GrepOperations,
  type GrepToolDetails,
  type GrepToolInput,
  type GrepToolOptions,
  type LsOperations,
  type LsToolDetails,
  type LsToolInput,
  type LsToolOptions,
  type ReadOperations,
  type ReadToolDetails,
  type ReadToolInput,
  type ReadToolOptions,
  type ToolsOptions,
  type TruncationOptions,
  type TruncationResult,
  truncateHead,
  truncateLine,
  truncateTail,
  type WriteOperations,
  type WriteToolInput,
  type WriteToolOptions,
  withFileMutationQueue
} from './core/tools/index.ts'
export {
  hasTrustRequiringProjectResources,
  type ProjectTrustDecision,
  ProjectTrustStore,
  type ProjectTrustStoreEntry,
  type ProjectTrustUpdate
} from './core/trust-manager.ts'
// Main entry point
export { type MainOptions, main } from './main.ts'
// Run modes for programmatic SDK usage
export {
  type ModelInfo,
  type PrintModeOptions,
  RpcClient,
  type RpcClientOptions,
  type RpcCommand,
  type RpcEventListener,
  type RpcExtensionUIRequest,
  type RpcExtensionUIResponse,
  type RpcResponse,
  type RpcSessionState,
  type RpcSlashCommand,
  runPrintMode,
  runRpcMode
} from './modes/index.ts'
export { runMigrations } from './migrations.ts'
export { handleConfigCommand, handlePackageCommand } from './package-manager-cli.ts'
// Clipboard utilities
export { formatTokens } from './utils/format.ts'
export { copyToClipboard } from './utils/clipboard.ts'
export { parseFrontmatter, stripFrontmatter } from './utils/frontmatter.ts'
export { convertToPng } from './utils/image-convert.ts'
export { formatDimensionNote, type ResizedImage, resizeImage } from './utils/image-resize.ts'
// Shell utilities
export { isLocalPath, normalizePath, resolvePath } from './utils/paths.ts'
export { getShellConfig } from './utils/shell.ts'
export { cleanupWindowsSelfUpdateQuarantine } from './utils/windows-self-update.ts'
