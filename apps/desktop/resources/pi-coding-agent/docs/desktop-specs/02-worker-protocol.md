# 02. Worker Protocol Spec

## 目标

定义 Electron main 与 coding agent utility worker 之间的协议。实时命令和事件走
Electron `utilityProcess` transport，不走数据库。协议分为 canonical agent protocol
和 desktop control protocol。

## Transport

第一期 desktop worker transport 固定为 Electron `utilityProcess.fork()`：

- main 侧使用 `utilityProcess.fork(workerEntry)` 启动 `coding-agent-utility-worker.js`。
- main 侧通过 `UtilityProcess.postMessage(envelope)` 发送命令。
- worker 入口通过 `process.parentPort.on("message")` 接收命令。
- worker 通过 `process.parentPort.postMessage(envelope)` 发送响应和事件。
- 传输对象是结构化 `WorkerEnvelope`，不是 stdin/stdout JSONL。

```ts
type TransportEnvelope = WorkerCommandEnvelope | WorkerResponseEnvelope | WorkerEventEnvelope
```

要求：

- 命令必须有 request id。
- 响应必须带对应 request id。
- 异步事件不依赖 request id。
- worker ready/error/exit 必须有明确 lifecycle event。
- stderr/stdout 只用于 diagnostics 捕获，不能作为协议通道。
- desktop 不保留 stdio worker 兼容入口，也不通过 `child_process.spawn(process.execPath)` 启动 worker。

## Canonical Agent Commands

这些命令保持 Pi 语义：

```ts
type CanonicalCommand =
  | {
      type: 'prompt'
      message: string
      images?: ImageInput[]
      streamingBehavior?: 'steer' | 'followUp'
    }
  | { type: 'steer'; message: string; images?: ImageInput[] }
  | { type: 'follow_up'; message: string; images?: ImageInput[] }
  | { type: 'abort' }
  | { type: 'get_state' }
  | { type: 'get_messages' }
  | { type: 'get_session_stats' }
  | { type: 'new_session'; parentSession?: string }
  | { type: 'switch_session'; sessionPath: string; cwdOverride?: string }
  | { type: 'import_session'; inputPath: string; cwdOverride?: string }
  | { type: 'export_html'; outputPath?: string }
  | { type: 'fork'; entryId: string; position?: 'before' | 'at' }
  | { type: 'clone' }
  | { type: 'get_fork_messages' }
  | { type: 'set_session_name'; name: string }
  | { type: 'get_available_models' }
  | { type: 'set_model'; provider: string; modelId: string }
  | { type: 'cycle_model' }
  | { type: 'set_thinking_level'; level: ThinkingLevel }
  | { type: 'cycle_thinking_level' }
  | { type: 'compact'; customInstructions?: string }
  | { type: 'set_auto_compaction'; enabled: boolean }
  | { type: 'set_auto_retry'; enabled: boolean }
  | { type: 'abort_retry' }
  | { type: 'bash'; command: string; excludeFromContext?: boolean }
  | { type: 'abort_bash' }
  | { type: 'get_commands' }
```

## Desktop Control Commands

这些命令属于 desktop host，不改变 Pi canonical 语义：

```ts
type DesktopControlCommand =
  | { type: 'worker.startThread'; input: StartThreadInput }
  | { type: 'worker.ping' }
  | { type: 'ui.respond'; response: ExtensionUiResponse }
  | { type: 'approval.respond'; response: ApprovalResponse }
```

Thread stop/restart 由 desktop host 的 thread lifecycle API 管理，worker snapshot 由 `WorkerClient.snapshot()` 在 transport client 本地生成；它们不属于可发送给 runtime service 的 `WorkerCommand`。

## Responses

```ts
type WorkerResponse<T = unknown> = {
  id: string
  type: 'response'
  command: string
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: unknown
  }
}
```

约束：

- prompt 类命令的 response 表示已接受、已排队或已拒绝，不代表 agent run 完成。
- run 完成由 canonical event 表示。
- transport error、parse error、worker fatal error 必须返回结构化 error。

## Events

事件分两类：

```ts
type WorkerEvent =
  | { type: 'canonical'; event: AgentSessionEvent; threadId: string }
  | { type: 'projection'; event: DesktopProjectionEvent; threadId: string }
  | { type: 'worker'; event: WorkerLifecycleEvent; threadId?: string }
```

必须支持：

- canonical event 原样或语义等价转发。
- projection event 从 canonical event 或 worker lifecycle 派生。
- worker event 表示 ready、exited、crashed、protocolError、heartbeatMissed。

## Snapshot

```ts
type WorkerSnapshot = {
  thread: ThreadSnapshot
  canonicalState: {
    sessionFile?: string
    sessionId: string
    cwd: string
    model?: ModelIdentity
    thinkingLevel: ThinkingLevel
    isStreaming: boolean
    isCompacting: boolean
    messageCount: number
    pendingMessageCount: number
  }
  projections: {
    toolCalls: DesktopToolCall[]
    fileChanges: DesktopFileChange[]
    approvals: ApprovalRequest[]
  }
  diagnostics: Diagnostic[]
}
```

Snapshot 通过 IPC 请求，不直接从 renderer 读取 session 文件或宿主 metadata。

## Extension UI

extension UI request 必须通过 transport 传给 Electron main，再通过 preload IPC 交给 renderer 或由 main 自动处理。

支持：

- select
- confirm
- input
- editor
- notify
- setStatus
- setWidget
- setTitle
- set_editor_text

dialog 类 request 必须支持 response correlation 和 timeout。

## 验收

- utility process transport 不需要改变 command/event TypeScript 类型。
- prompt 可收到 accepted response，并继续收到 streaming canonical events。
- worker crash 能发出 worker lifecycle event 或由 client 生成等价 event。
- extension UI request 可以往返。
- snapshot 可在 idle、running、error 状态下请求。
