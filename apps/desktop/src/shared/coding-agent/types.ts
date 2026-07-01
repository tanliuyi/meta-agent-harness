/**
 * 本文件定义 desktop renderer 与 main 之间受控暴露的 coding agent IPC 类型。
 */

export type ThreadStatus =
  'new' | 'queued' | 'starting' | 'idle' | 'running' | 'stopping' | 'stopped' | 'error'

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface CreateThreadInput {
  threadId?: string
  cwd: string
  sessionFile?: string
  title?: string
  agentDir?: string
}

export interface ThreadSummary {
  threadId: string
  cwd: string
  sessionFile?: string
  title?: string
  status: ThreadStatus
  archivedAt?: string
  createdAt: string
  updatedAt: string
}

export interface ThreadSnapshot {
  threadId: string
  cwd: string
  sessionFile?: string
  title?: string
  status: ThreadStatus
  thinkingLevel: ThinkingLevel
  messages: ThreadMessage[]
  toolCalls: unknown[]
  fileChanges: unknown[]
  approvals: unknown[]
  queue: {
    steering: string[]
    followUp: string[]
  }
  diagnostics: unknown[]
}

export interface ApprovalRequest {
  approvalId: string
  threadId: string
  action: string
  risk: 'low' | 'medium' | 'high'
  scope: 'once' | 'thread' | 'workspace'
  choices?: string[]
  subject?: string
  defaultAction: 'allow' | 'deny'
  timeoutMs?: number
  createdAt: string
}

export interface ApprovalResponse {
  approvalId: string
  allow: boolean
  scope: 'once' | 'thread' | 'workspace'
  choice?: string
  reason?: string
}

export interface ThreadMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  text?: string
  createdAt?: string
}

export interface ThreadIdInput {
  threadId: string
}

export interface PromptInput extends ThreadIdInput {
  message: string
  images?: unknown[]
  streamingBehavior?: 'steer' | 'followUp'
}

export interface TextInput extends ThreadIdInput {
  message: string
  images?: unknown[]
}

export interface NewSessionInput extends ThreadIdInput {
  parentSession?: string
}

export interface SwitchSessionInput extends ThreadIdInput {
  sessionPath: string
  cwdOverride?: string
}

export interface ImportSessionInput extends ThreadIdInput {
  inputPath: string
  cwdOverride?: string
}

export interface ExportSessionInput extends ThreadIdInput {
  outputPath?: string
}

export interface ExportSessionResult {
  path: string
}

export interface ForkInput extends ThreadIdInput {
  entryId: string
  position?: 'before' | 'at'
}

export interface RenameThreadInput extends ThreadIdInput {
  name: string
}

export interface SetModelInput extends ThreadIdInput {
  provider: string
  modelId: string
}

export interface ModelCycleResult {
  model: ModelInfo
  thinkingLevel: ThinkingLevel
  isScoped: boolean
}

export interface SetThinkingInput extends ThreadIdInput {
  level: ThinkingLevel
}

export interface ThinkingCycleResult {
  level: ThinkingLevel
}

export interface CompactInput extends ThreadIdInput {
  customInstructions?: string
}

export interface ToggleInput extends ThreadIdInput {
  enabled: boolean
}

export interface CommandInfo {
  name: string
  description?: string
  source: 'extension' | 'prompt' | 'skill'
  sourceInfo: unknown
}

export interface ModelInfo {
  provider: string
  id: string
  name?: string
}

export interface CompactionResult {
  cancelled?: boolean
  [key: string]: unknown
}

export interface RunCommandInput extends ThreadIdInput {
  command: string
}

export interface ExtensionUiResponseInput {
  threadId: string
  response: unknown
}

export interface ApprovalResponseInput {
  threadId: string
  response: ApprovalResponse
}

export type CodingAgentIpcEvent =
  | { type: 'canonical'; threadId: string; event: unknown }
  | { type: 'projection'; threadId: string; event: unknown }
  | { type: 'worker'; threadId?: string; event: unknown }
  | { type: 'threadSnapshot'; threadId: string; snapshot: ThreadSnapshot }

export interface CodingAgentApi {
  createThread(input: CreateThreadInput): Promise<ThreadSnapshot>
  stopThread(threadId: string): Promise<void>
  restartThread(threadId: string): Promise<ThreadSnapshot>
  listThreads(): Promise<ThreadSummary[]>
  getThread(threadId: string): Promise<ThreadSnapshot>
  getSnapshot(threadId: string): Promise<ThreadSnapshot>
  prompt(input: PromptInput): Promise<void>
  steer(input: TextInput): Promise<void>
  followUp(input: TextInput): Promise<void>
  abort(threadId: string): Promise<void>
  newSession(input: NewSessionInput): Promise<ThreadSnapshot>
  switchSession(input: SwitchSessionInput): Promise<ThreadSnapshot>
  importSession(input: ImportSessionInput): Promise<ThreadSnapshot>
  exportSession(input: ExportSessionInput): Promise<ExportSessionResult>
  fork(input: ForkInput): Promise<ThreadSnapshot>
  clone(threadId: string): Promise<ThreadSnapshot>
  renameThread(input: RenameThreadInput): Promise<void>
  archiveThread(threadId: string): Promise<void>
  listModels(threadId: string): Promise<ModelInfo[]>
  setModel(input: SetModelInput): Promise<void>
  cycleModel(threadId: string): Promise<ModelCycleResult | null>
  setThinkingLevel(input: SetThinkingInput): Promise<void>
  cycleThinkingLevel(threadId: string): Promise<ThinkingCycleResult | null>
  compact(input: CompactInput): Promise<CompactionResult>
  setAutoCompaction(input: ToggleInput): Promise<void>
  setAutoRetry(input: ToggleInput): Promise<void>
  abortRetry(threadId: string): Promise<void>
  getCommands(threadId: string): Promise<CommandInfo[]>
  runCommand(input: RunCommandInput): Promise<void>
  respondUi(input: ExtensionUiResponseInput): Promise<void>
  respondApproval(input: ApprovalResponseInput): Promise<void>
  onEvent(listener: (event: CodingAgentIpcEvent) => void): () => void
}
