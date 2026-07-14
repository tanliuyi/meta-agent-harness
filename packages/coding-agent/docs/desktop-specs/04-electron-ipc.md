# 04. Electron IPC 与 Preload API Spec

## 目标

定义 renderer 与 Electron main 之间的受控 API。第一期必须完成 typed preload API、main IPC handlers、renderer 数据层联调和简单 UI。

## 分层

```text
Renderer
  |
  | window.api.codingAgent
  v
Preload
  |
  | ipcRenderer.invoke / ipcRenderer.on
  v
Electron main
  |
  | ThreadManager + ThreadWorkerRegistry
  v
Worker
```

## Preload API

建议暴露：

```ts
type CodingAgentApi = {
  listProjects(): Promise<ProjectSummary[]>
  createProject(): Promise<ProjectSummary | undefined>
  openProject(projectId: string): Promise<ProjectSummary>
  getProject(projectId: string): Promise<ProjectSummary>
  renameProject(input: RenameProjectInput): Promise<void>

  createThread(input: CreateThreadInput): Promise<ThreadSnapshot>
  stopThread(threadId: string): Promise<void>
  restartThread(threadId: string): Promise<ThreadSnapshot>
  listThreads(input?: { projectId?: string }): Promise<ThreadSummary[]>
  getThread(threadId: string): Promise<ThreadSnapshot>
  getSnapshot(threadId: string): Promise<ThreadSnapshot>

  // AG-UI threadId 当前等同 desktop threadId；底层 Pi session ID 不替换 thread identity。
  connectAgent(input: { threadId: string }): Promise<void>
  disconnectAgent(input: { threadId: string }): Promise<void>
  runAgent(input: RunAgentInput): Promise<void>

  /** @deprecated 使用 connectAgent；MESSAGES_SNAPSHOT 从 event stream 接收。 */
  openSessionMessageFeed(input: { sessionId: string }): Promise<MessagesSnapshotEvent>
  /** @deprecated 使用 disconnectAgent。 */
  closeSessionMessageFeed(): Promise<void>
  /** @deprecated 使用 runAgent。 */
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
  onAgentEvent(listener: (event: AGUIEvent) => void): () => void
  /** @deprecated 使用 onAgentEvent。 */
  onSessionAgentEvent(listener: (event: AGUIEvent) => void): () => void
}
```

API 可分模块实现，但 preload 暴露面必须稳定、受控、typed。

## IPC Events

```ts
type CodingAgentIpcEvent =
  | Exclude<DesktopIpcEvent, { type: 'threadSnapshot' }>
  | { type: 'threadSnapshot'; threadId: string; snapshot: ThreadSnapshot }
  | { type: 'threadWorker'; threadId?: string; event: ThreadWorkerLifecycleIpcEvent }
  | { type: 'project'; event: ProjectIpcEvent }
```

事件订阅要求：

- 返回 unsubscribe。
- main 应按 window 订阅状态转发，避免无关窗口收到全部事件。
- renderer 先安装 `onAgentEvent` listener，再调用 `connectAgent({ threadId })`；main repository 初始化期间的 Pi events 必须归入 snapshot，并将 `MESSAGES_SNAPSHOT` 作为连接成功后的第一条 AG-UI event 发送。
- `disconnectAgent({ threadId })` 只在当前 WebContents 的连接仍属于该 thread 时断开，迟到的旧组件清理不得影响新连接。
- `runAgent(input: RunAgentInput)` 使用标准 `threadId`、`runId` 和 message 输入；run stream 必须以请求对应的 `RUN_STARTED` 开始，随后才可发送 `MESSAGES_SNAPSHOT` 和增量事件，并以 `RUN_FINISHED` 或 `RUN_ERROR` 结束。Electron attach 是 transport 细节，不改变 `AbstractAgent.run()` 的官方生命周期。
- canonical Pi events 只进入 main adapter；thread 定向通道在线路上只发送 `@ag-ui/core` 的 `AGUIEvent`，不得附加 `sessionId`、revision 或自定义 envelope。普通 `onEvent` 保留 project、projection、worker、approval、tree/changes 等非 chat 功能。
- `openSessionMessageFeed`、`closeSessionMessageFeed` 与 `onSessionAgentEvent` 仅为迁移期兼容接口；新链路不通过 invoke 返回 snapshot，也不维护 revision 或 journal。
- compaction 完成后 main 失效 repository，从 canonical source 重载，并向仍订阅该 session 的窗口发送新的标准 `MESSAGES_SNAPSHOT`。
- 事件 payload 不包含 secret。
- 错误事件结构化。

## Main IPC Handlers

Electron main 负责：

- 参数校验。
- 权限和路径边界检查。
- 调用 ThreadManager。
- 将 worker lifecycle events 转发给订阅窗口。
- 将 extension UI 和 approval request 转成 IPC event。
- 在 app 退出时 shutdown thread worker registry。

## 错误模型

```ts
type IpcError = {
  code: string
  message: string
  recoverable: boolean
  details?: unknown
}
```

要求：

- 不把 raw stack 默认暴露给 renderer。
- diagnostics 可通过显式 debug API 获取。
- worker crash、protocol error、validation error、not found、permission denied 要有不同 code。

## 安全约束

preload 不暴露：

- `ipcRenderer` 原对象
- shell execution primitive
- filesystem primitive
- worker pid/process handle
- credential content
- arbitrary command transport

所有能力必须通过 named API。

## 验收

- renderer 可以通过 preload 创建 thread、发送 prompt、收到 streaming events。
- renderer 可以通过 preload 创建/打开 project，并在 active project 下创建 thread。
- renderer 可以取消事件订阅。
- renderer store 使用真实 `window.api.codingAgent`，不使用 mock。
- renderer 可以展示 active snapshot、基础事件列表和 pending approval，并能回传 approval response。
- renderer 无法直接访问 worker process 和 credential。
- main 能按 thread/window 路由事件。
- IPC error 结构化且无 secret 泄漏。
