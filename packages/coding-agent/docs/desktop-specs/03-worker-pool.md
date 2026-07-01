# 03. Worker Pool Spec

## 目标

Worker pool 负责管理 coding agent worker process 的创建、复用、并发限制、排队、空闲回收和崩溃隔离。第一期不做 renderer UI，但必须提供后端能力和 IPC 可观测状态。

## 所属层

Worker pool 位于 Electron main。

`packages/coding-agent` 提供：

- worker entrypoint
- protocol types
- typed worker client
- transport helpers

`apps/desktop` 提供：

- pool lifecycle
- thread registry
- app/window subscription routing
- preload IPC handlers

## 状态模型

```ts
type WorkerState =
  | 'starting'
  | 'ready'
  | 'bound'
  | 'busy'
  | 'idle'
  | 'stopping'
  | 'exited'
  | 'crashed'

type ThreadRuntimeState =
  | 'new'
  | 'queued'
  | 'starting'
  | 'idle'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error'

type WorkerLease = {
  workerId: string
  threadId: string
  cwd: string
  sessionFile?: string
  acquiredAt: number
  lastActiveAt: number
}
```

## Pool 接口

```ts
type WorkerPool = {
  acquireThreadWorker(input: StartThreadInput): Promise<WorkerLease>
  releaseThreadWorker(threadId: string, reason: 'idle' | 'stop' | 'archive' | 'crash'): Promise<void>
  send(threadId: string, command: WorkerCommand): Promise<WorkerResponse>
  getWorker(workerId: string): WorkerSnapshot | undefined
  listWorkers(): WorkerSnapshot[]
  listLeases(): WorkerLease[]
  shutdown(): Promise<void>
}
```

## 调度策略

第一期策略：

- running thread 独占 worker。
- idle thread 不永久占用 worker，保留 session file、snapshot 和数据库索引。
- resume idle thread 时重新 acquire worker。
- 默认最大并发数保守设置，例如 `max(1, min(3, logicalCpuCount - 1))`。
- 超出并发时进入 FIFO queue。
- queue 状态通过 IPC 发送 `thread.stateChanged` projection event。

## 复用策略

优先级：

1. 如果 worker reset 可以证明可靠，则允许复用。
2. 如果 reset 语义不可靠，第一期使用 one-shot worker。

复用前必须清理：

- cwd
- session manager
- agent messages
- tools
- extension runtime
- pending UI requests
- approvals
- bash process
- retry/compaction state
- event subscriptions

任何无法证明清理完成的 worker 必须退出重建。

## Crash / Exit

worker crash 时必须：

- 标记 worker 为 `crashed`。
- 标记绑定 thread 为 `error` 或 `stopped`，取决于退出原因。
- 发出 worker lifecycle event。
- 发出 thread state projection event。
- reject pending requests。
- 清理 lease。
- 保留 stderr、exitCode、signal、last command、last event time。

正常 stop 时必须：

- 优雅发送 stop/shutdown 命令。
- 等待超时。
- 超时后强制 kill。
- 清理 lease 和 subscriptions。

## Heartbeat

第一期应预留 heartbeat：

- main 定期发送 `worker.ping`。
- worker 返回 pong 或 lifecycle response。
- 超时后标记 heartbeat missed。
- 连续失败后按 crash 处理。

可以先实现为 no-op，但类型和状态要保留。

## 安全边界

renderer 不得访问：

- worker pid
- process handle
- stdin/stdout
- raw filesystem authority
- credential data

renderer 只能通过 preload API 观察 thread/worker 状态。

## 验收

- 同时创建超过 max concurrency 的 thread 时，多余 thread 进入 queue。
- running thread 独占 worker。
- idle release 后 worker 不再保留 thread runtime。
- worker crash 会清理 lease 并通知订阅方。
- app shutdown 会停止所有 worker。
- renderer 无法直接操作 worker process。
