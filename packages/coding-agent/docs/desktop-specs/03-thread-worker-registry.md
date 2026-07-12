# 03. Thread Worker Registry Spec

## 目标

Thread worker registry 负责管理 coding agent utility worker process 的创建、
thread 绑定、命令路由、生命周期事件和关闭清理。它不是 worker pool，不限制 agent
并行数量，也不维护 FIFO 启动队列。

## 所属层

Thread worker registry 位于 Electron main。

`packages/coding-agent` 提供：

- worker entrypoint
- protocol types
- typed worker client
- utility process transport helpers

`apps/desktop` 提供：

- thread worker registry
- thread registry
- app/window subscription routing
- preload IPC handlers

## 状态模型

```ts
type WorkerState = 'starting' | 'bound' | 'busy' | 'idle' | 'stopping' | 'exited' | 'crashed'

type ThreadRuntimeState = 'new' | 'starting' | 'idle' | 'running' | 'stopping' | 'stopped' | 'error'

type WorkerLease = {
  workerId: string
  threadId: string
  cwd: string
  sessionFile?: string
  acquiredAt: number
  lastActiveAt: number
}
```

## Registry 接口

```ts
type ThreadWorkerRegistry = {
  acquireThreadWorker(input: StartThreadInput): Promise<WorkerLease>
  releaseThreadWorker(
    threadId: string,
    reason: 'idle' | 'stop' | 'archive' | 'crash'
  ): Promise<void>
  send(threadId: string, command: WorkerCommand): Promise<WorkerResponse>
  listLeases(): WorkerLease[]
  shutdown(): Promise<void>
}
```

## 调度策略

第一期策略：

- running thread 独占 worker。
- idle thread 不永久占用 worker，保留 session file 和轻量 thread metadata。
- resume idle thread 时重新创建 utility worker。
- 并行 thread 各自立即创建独立 utility worker。
- 不提供 `maxWorkers`。
- 不提供 worker pool queue，也不把 thread start/prompt 放入全局 pending queue。

## 复用策略

第一期不跨 thread 复用 mutable agent runtime。停止、归档或释放 thread 时退出当前
worker；再次运行该 thread 时创建新的 utility worker。

必须避免保留或泄漏：

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
- utility process handle
- filesystem absolute secret path
- provider credentials
- raw shell handle

renderer 只能通过 preload API 和 IPC event 操作 thread。
