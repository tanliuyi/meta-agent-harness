# Desktop Coding Agent 架构

本文定义 `packages/coding-agent` 在 Meta Agent 中的演进方向。这个包来自
Pi，但 Meta Agent Desktop 不是 Pi 的桌面套壳。Desktop 是主要产品形态，
`packages/coding-agent` 应该演进为面向桌面产品的一等 coding agent worker
和运行时。

重要约束：Desktop 需要完整兼容 Pi 的核心能力和数据模型。迁移目标不是削弱 Pi
的 agent 能力，也不是另起一条 desktop-only 分支，而是把同一套 session、
event、config、resource、extension 和 tool 语义从 CLI/TUI 产品形态中抽离出来，
通过 desktop worker、transport、IPC 和 UI adapter 呈现。

Desktop 和 Pi 应保持同构内核：

- 同构 session 格式和 branching 语义。
- 同构 agent/session/tool event 语义。
- 同构 settings/config/resource discovery 能力，默认路径可由宿主配置。
- 同构 skills、prompt templates、extensions、custom tools 能力。
- 同构 auth/model registry/thinking/compaction/retry 行为。

Desktop 可以增加索引、缓存、worker pool、IPC、数据库和 UI-friendly projection，
但这些只能是 adapter 或 projection，不能替代或分叉核心协议和状态语义。

## 产品边界

Meta Agent Desktop 是类似 Codex 的 AI coding workbench。它不是 IDE，也不
应该围绕内置代码编辑器来设计。

核心产品对象是 coding thread：

- 一个项目工作目录
- 一个持久化的对话/session
- 一个 agent 进程
- 一组模型和 reasoning 配置
- 一条由消息、工具调用、文件变更、审批请求和运行状态组成的事件流
- 停止、恢复、分叉、克隆、重命名、归档等生命周期操作

Desktop 的目标是帮助用户分派编码任务、观察 agent 的执行过程、审查变更、
在必要时介入，并在之后恢复或分叉工作。

## 非目标

- 不把 desktop 做成 Pi CLI 的图形外壳。
- 不把 terminal/TUI 概念暴露成桌面产品模型。
- 不让 renderer 进程负责文件系统、shell 或模型凭据访问。
- 不让 UI 直接消费底层 provider 事件作为主要状态模型。
- 不把 Pi 的 CLI 参数、TUI 组件、终端 keybinding 和 `.pi` 路径作为 desktop
  默认产品界面。
- 不创建与 Pi session/event/config 不兼容的 desktop-only 核心分支。

这些非目标不代表丢弃 Pi 的核心能力。能力应保留，入口、命名、存储和呈现方式
应通过 adapter desktop 化。

## 必须保留的 Pi 核心能力

Desktop 版本应完整保留并产品化以下能力：

- Agent loop：多轮 LLM 调用、工具调用、tool result 回传和自动继续。
- Streaming：assistant text、thinking、tool call、tool result 的增量事件。
- Tools：`read`、`bash`、`edit`、`write`、`grep`、`find`、`ls`，以及自定义工具。
- 工具安全边界：项目信任、危险操作确认、路径约束、输出截断和 mutation queue。
- Session persistence：JSONL session、恢复、切换、导入、导出。
- Branching：fork、clone、tree navigation、branch summary。
- Compaction：手动压缩、阈值压缩、overflow 后自动压缩和重试。
- Retry：provider transient error 自动重试和中止 retry。
- Models：provider/model registry、默认模型、scoped models、model cycling。
- Thinking levels：`off`、`minimal`、`low`、`medium`、`high`、`xhigh`，并按模型能力 clamp。
- Auth：API key、OAuth、环境变量、runtime override 和自定义 provider credential。
- Settings：全局设置、项目设置、运行时 override、持久化和错误收集。
- Resource loading：AGENTS/context files、skills、prompt templates、extensions、custom models。
- Skills：发现、格式化进 system prompt、按需调用。
- Prompt templates 和 slash commands：作为 desktop command palette / quick actions 呈现。
- Extensions：事件 hooks、自定义工具、自定义命令、context transform、provider request hooks。
- Extension UI：select、confirm、input、editor、notify、status/widget/title 等能力，映射为 desktop UI。
- Bash execution：交互外 shell 命令、输出流、截断、取消和上下文注入。
- Export：HTML 或后续 desktop export 格式。
- Diagnostics：resource/settings/extension/model loading 诊断。
- Image support：图片输入、resize、block images 设置和剪贴板/附件相关能力。

如果某项能力暂时不进入第一版 UI，也应在 worker/core 层保留架构位置，避免之后
为了补齐能力而推翻协议。

## Pi 同构兼容

Desktop 后端应与 Pi 保持同构，不走两套核心分支。兼容重点包括：

Session：

- 保持 JSONL session entry 类型、parent/branch 关系和 current leaf 语义。
- 保持 resume、switch、fork、clone、import、export 的行为兼容。
- Desktop 数据库只能索引和缓存 session，不应成为不兼容的新 session 真相源。
- 如果新增 desktop metadata，应放在可忽略的 metadata 层，不能破坏 Pi 读取。

Events：

- 保持 Pi 的 agent/session/tool event 语义作为 canonical event。
- Desktop 可以额外生成 UI projection event，但必须能追溯到 canonical event。
- 不应为了 UI 方便修改底层 event 含义。

Config/settings：

- 保持 Pi settings 的字段语义、merge 行为、runtime override 和错误处理边界。
- Desktop 可以改变默认存储根目录，也可以通过 host options 指定 agentDir/cwd。
- `.pi` 可作为兼容导入和项目配置来源保留；Meta Agent 默认路径不能破坏 Pi 配置语义。

Resources：

- 保持 AGENTS/context files、skills、prompt templates、extensions、models 的加载语义。
- Desktop command palette、设置页、扩展 UI 都是这些资源的呈现层。

Extensions：

- 保持 extension hooks、自定义工具、自定义命令、context transform、provider request hooks。
- Desktop 将 extension UI request 映射为桌面弹窗、通知、状态和输入能力。
- 不应把 extension API 拆成 Pi API 和 Desktop API 两套互不兼容的接口。

Tools：

- 保持 tool input/output 的核心语义。
- Desktop 可以增加结构化 projection，例如 file change、timeline item、diff view metadata。
- projection 不应替代 tool result 本体。

## 包职责

长期目标拆分如下：

```text
packages/coding-agent
  与 Pi 同构的 core agent runtime、tools、sessions、models、auth、compaction
  desktop worker process
  worker pool runtime
  Pi-compatible canonical protocol + desktop transport/projection
  给 Electron main 使用的 typed RPC client

apps/desktop
  Electron main thread manager
  preload API
  后端 IPC contract
  Vue renderer UI，第一期不实现
  产品状态、布局和交互设计，第一期只保留类型和接口边界
```

desktop renderer 通过 preload IPC 和 Electron main 通信。Electron main 持有
coding agent workers。worker 负责执行工具、调用模型、修改文件和持久化
session。

第一期范围不包含 renderer 前端实现。第一期交付目标是完成所有后端能力、worker
池与 IPC：

- `packages/coding-agent` 提供 desktop worker、RPC protocol、typed client 和核心能力适配。
- `apps/desktop` 的 Electron main 提供 thread manager、worker pool、worker lifecycle、IPC handlers。
- `apps/desktop` 的 preload 暴露 typed API 和事件订阅能力。
- renderer 只需要能在之后基于稳定 API 接入 UI，不在第一期实现具体界面。

```text
Vue renderer
  |
  | typed preload API
  v
Electron main
  |
  | typed RPC client
  v
Coding agent worker process
```

## RPC 优先的运行时

Desktop 默认采用进程隔离架构，并在第一期引入或开发 worker 池。worker 池负责
管理 agent worker process 的创建、复用、并发限制、空闲回收和崩溃隔离。

好处：

- agent run 崩溃不会拖垮桌面 UI
- shell 和文件系统能力不会进入 renderer
- 长任务可以独立停止或重启
- 多个 coding thread 可以并发运行
- 可以限制并发 worker 数量，避免模型请求、shell 进程和文件 IO 失控
- idle thread 不需要永久占用进程
- 后续更容易加入 sandbox

worker 不是 `pi --mode rpc`。它应该是 Meta Agent 自己的 worker 入口，例如：

```bash
node packages/coding-agent/dist/worker/worker-main.js
```

协议应兼容 Pi 的核心命令、事件和状态语义。Desktop 可以在此基础上增加 transport
层、worker pool 控制命令和 UI projection，但不能设计成与 Pi RPC/session/event
割裂的第二套核心协议。

## Worker 池

第一期需要引入或开发 worker 池。worker 池属于 Electron main 的后端基础设施，
但协议类型、worker entrypoint 和 worker client 由 `packages/coding-agent`
提供。

worker 池职责：

- 按需启动 worker process。
- 为 thread 分配 worker。
- 维护 worker 与 thread 的绑定关系。
- 限制最大并发 worker 数。
- 支持排队启动 thread。
- 回收 idle worker。
- 处理 worker crash、exit、timeout。
- 捕获 worker stderr/stdout protocol error。
- 将 worker events 路由回对应 thread 和 renderer subscriber。
- 在 app 退出时优雅停止所有 worker。

推荐第一期池化策略：

- active/running thread 独占一个 worker。
- idle thread 默认只保留 snapshot 和 session file，不永久占用 worker。
- resume idle thread 时，从池中获取 worker 并加载对应 session。
- worker 可以复用，但复用前必须 reset runtime state，避免 session、cwd、auth、
  extension runtime 泄漏。
- 如果 reset 语义不够可靠，第一期优先采用 one-shot worker：thread stop/idle 后
  退出 worker，由 pool 负责下次重启。
- pool 提供最大并发数，默认值应保守，例如 `max(1, min(3, logicalCpuCount - 1))`。
- 超出并发时 thread start/prompt 进入 pending queue，并向 IPC 发出 queued state。

建议状态模型：

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

type WorkerLease = {
  workerId: string
  threadId: string
  cwd: string
  sessionFile?: string
  acquiredAt: number
  lastActiveAt: number
}
```

池化接口：

```ts
type WorkerPool = {
  acquireThreadWorker(input: StartThreadInput): Promise<WorkerLease>
  releaseThreadWorker(threadId: string, reason: 'idle' | 'stop' | 'archive' | 'crash'): Promise<void>
  getWorker(workerId: string): WorkerSnapshot | undefined
  listWorkers(): WorkerSnapshot[]
  shutdown(): Promise<void>
}
```

必须避免的情况：

- 两个 running thread 共享同一个 mutable agent runtime。
- worker 复用后保留上一个 thread 的 cwd、messages、tools、extension handlers。
- worker crash 后 thread 状态仍显示 running。
- renderer 直接知道 worker pid 或直接操作 worker process。

## 第一期交付范围

第一期不包含 renderer 前端开发。第一期必须完成 worker、Electron main 和 preload
IPC 的后端闭环，并覆盖 Pi 核心能力在协议层的位置。

必须交付：

- Desktop worker entrypoint：启动后通过 JSONL 或等价 transport 接收命令、发送事件。
- Worker pool：支持并发限制、排队、lease、idle 回收、crash/exit cleanup。
- Desktop protocol types：命令、响应、事件、snapshot、tool results、approval、diagnostics。
- Typed RPC client：供 Electron main 管理 worker process 和发送命令。
- Electron main thread manager：创建、停止、重启、列出、查询 thread。
- Worker lifecycle：start、stop、exit、crash、stderr capture、timeout、cleanup。
- Thread snapshot：任意时刻可查询完整状态。
- Prompt lifecycle：prompt、steer、followUp、abort。
- Streaming events：message delta、thinking delta、tool call lifecycle、queue change、agent state。
- Session lifecycle：new/resume/switch/import/export/fork/clone/rename/archive 的后端接口。
- Model lifecycle：list、set、cycle、thinking set/cycle、scoped models。
- Tool capabilities：read、bash、edit、write、grep、find、ls、自定义工具注册位置。
- Compaction/retry：manual compaction、auto compaction 开关、retry 开关、abort retry。
- Settings/auth/resource loading：后端接口和 storage path 约定。
- Skills/prompt templates/commands/extensions：发现、列表、调用和事件/Hook 的协议位置。
- Extension UI bridge：select、confirm、input、editor、notify、status/widget/title、set editor text。
- Approval bridge：危险操作、workspace trust、一次性/线程/workspace 决策。
- File change reporting：从 tool results 产生结构化 file change event。
- Preload API：renderer 可调用的 typed command API 和 event subscription API。

第一期不交付：

- Vue renderer 页面、组件、布局和交互。
- 聊天 timeline 的视觉设计。
- diff viewer 的视觉实现。
- 设置页、模型选择页、session browser 的前端实现。
- 任何 IDE 式代码编辑器。

第一期验收标准：

- 可以从 Electron main 或测试脚本创建一个 coding thread。
- 可以通过 IPC/preload API 发送 prompt 并收到 streaming events。
- 可以执行并观察工具调用事件。
- 可以 abort 当前运行。
- 可以查询 thread snapshot、messages、stats、available models、commands。
- 可以新建、恢复、fork、clone、导入、导出 session 的后端流程。
- worker 崩溃或退出时 main 能发出 thread error/exited 事件并清理资源。
- worker pool 能限制并发、排队启动 thread、释放 idle worker，并能在 app 退出时停止全部 worker。
- renderer 前端即使未实现，也能依赖稳定类型接入。

## Desktop 协议形态

命令应分成两层：

1. Canonical agent protocol：与 Pi 的 session、event、tool、config 语义同构。
2. Desktop control protocol：worker pool、thread registry、窗口订阅、数据库索引、
   projection 查询等 desktop 宿主能力。

Canonical 层优先保持 Pi 兼容，例如 prompt、steer、followUp、abort、session、
model、thinking、compaction、retry、bash、commands、extension UI 等能力。

Desktop control 层可以围绕产品概念分组。

Thread 命令：

```ts
thread.start
thread.stop
thread.snapshot
thread.prompt
thread.steer
thread.followUp
thread.abort
thread.rename
thread.resume
thread.fork
thread.clone
thread.archive
```

Model 命令：

```ts
model.list
model.set
thinking.set
```

Workspace 和安全命令：

```ts
workspace.inspect
workspace.setTrust
approval.respond
```

Extension 或集成命令：

```ts
ui.respond
command.list
command.run
```

协议应该为命令提供 request/response correlation，同时使用独立的异步事件传递
运行状态变化。实时事件必须走 transport，不通过数据库轮询或数据库触发器传递。
第一版 transport 可以使用 stdin/stdout JSONL、Node IPC 或 Electron
`utilityProcess`/`MessagePort`，但 TypeScript protocol types 才是事实来源。

数据库可以用于持久化、索引、恢复和查询，但不是实时通信通道。

## Desktop 事件模型

worker 事件分为 canonical event 和 projection event：

- canonical event 与 Pi agent/session/tool event 同构，是后端事实事件。
- projection event 面向 desktop UI，可由 canonical event 派生。

renderer 不应该直接依赖 provider-specific delta，但 Electron main/worker 必须保留
canonical event，确保 Pi 兼容、session 可重放、扩展行为一致。

实时事件链路：

```text
Worker
  |
  | transport event
  v
Electron main
  |
  | preload IPC event
  v
Renderer
```

数据库只接收事件副本或归一化后的状态更新，用于持久化和恢复：

```text
Worker/Main
  |
  | append/update
  v
SQLite 或其他本地状态库
```

推荐 projection event 族：

```ts
thread.started
thread.stateChanged
thread.exited
thread.error

message.added
message.delta
message.finished

tool.started
tool.updated
tool.finished

file.changed
approval.requested

compaction.started
compaction.finished

model.changed
thinking.changed
queue.changed
```

provider-specific 或低层事件可以作为诊断详情保留。canonical event 是兼容契约，
projection event 是 UI 契约。

## Thread Snapshot

worker 应该能在任何时刻返回完整 thread snapshot。这让 desktop 在刷新、
重连和 worker 重启后可以恢复状态。

最小 snapshot 字段：

```ts
type ThreadSnapshot = {
  threadId: string
  cwd: string
  sessionFile?: string
  title?: string
  status: 'starting' | 'idle' | 'running' | 'stopping' | 'stopped' | 'error'
  model?: {
    provider: string
    id: string
    displayName?: string
  }
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  messages: DesktopMessage[]
  toolCalls: DesktopToolCall[]
  fileChanges: DesktopFileChange[]
  queue: {
    steering: string[]
    followUp: string[]
  }
  context?: {
    tokens?: number
    contextWindow?: number
    percent?: number
  }
  cost?: {
    total: number
  }
  diagnostics: Diagnostic[]
}
```

snapshot 用于状态恢复和首次渲染。流式事件用于增量更新。

如果引入数据库，snapshot 可以由 worker 当前内存状态、session 文件和数据库索引
共同构建，但 renderer 仍通过 IPC 请求 snapshot，不直接读取数据库。snapshot 不应
成为与 Pi session 状态不一致的第二真相源。

## 数据库定位

第一期可以引入本地数据库作为 desktop 后端状态层，但它不替代 worker transport。

数据库适合存储：

- threads registry
- session metadata
- messages index
- tool call timeline
- file changes
- approvals
- worker run records
- crash/error diagnostics
- model/settings 快照
- event log 或 normalized state cache

数据库不负责：

- assistant streaming delta 的实时传递
- tool output streaming 的实时传递
- prompt、abort、steer、followUp 等命令投递
- worker heartbeat 和 lifecycle control
- backpressure、cancel、timeout 等实时控制

推荐组合：

```text
Transport: JSONL / Node IPC / Electron utilityProcess MessagePort
Database: SQLite 或等价本地数据库
Session raw log: Pi-compatible JSONL session
```

如果同时保留 JSONL session 和数据库：

- JSONL session 用于 agent 上下文、兼容导入导出和原始会话日志，是 session 的
  canonical persistence。
- 数据库用于 desktop 查询、索引、状态恢复、线程列表、工具时间线和审计视图。
- 两者通过明确的 session id/thread id 关联，避免互相替代导致职责混乱。

## 能力边界

Renderer：

- 渲染 threads、messages、tool calls、diffs、approvals、settings 和 status
- 通过 preload API 发送用户意图
- 永远不获得原始 shell 或文件系统权限
- 永远不保存模型密钥

Electron main：

- 启动和停止 worker processes
- 映射桌面窗口和 active threads
- 暴露受限 preload API
- 处理 worker 崩溃和重启
- 可以在转发命令前执行 app-level policy

Worker：

- 持有 agent runtime
- 持有工具执行能力
- 持有 session persistence
- 持有模型调用和凭据解析
- 发出 desktop protocol events

## 从复制包中保留和改造什么

保留或改造：

- `core/agent-session.ts` 的行为，保持兼容，内部可拆成更小的 runtime 模块
- `core/agent-session-runtime.ts` 的概念，保持兼容，外层可增加 thread/worker adapter
- `core/tools/*` 的工具实现，但移除 terminal rendering 依赖
- `core/session-manager.ts` 的持久化和 branching 语义
- `core/compaction/*`
- `core/auth-storage.ts`，接入 desktop credential policy
- `core/model-registry.ts`，与 `packages/ai` 对齐
- `core/skills.ts` 和 `core/prompt-templates.ts`，保持 Pi 发现语义，并允许 host 配置默认根目录
- `modes/rpc/*` 的 framing 和 typed client 思路，作为 canonical protocol 兼容基础

从 desktop 默认产品面中移除或隔离，但不丢失底层能力：

- `modes/interactive/*`：TUI 呈现层隔离为 legacy/compat，不作为 desktop UI 基础。
- terminal UI components 和 themes：不进入 desktop runtime contract。
- CLI startup flows 和 selectors：能力迁移到 desktop onboarding/settings/session UI。
- package-manager CLI 行为：扩展/技能/模板管理能力可保留，但入口应 desktop 化。
- Pi self-update 行为：desktop 更新由 Electron updater 或 Meta Agent 自己的更新机制负责。
- `.pi` 默认路径：保留兼容能力；desktop 可通过 host options 改默认根目录，但不能破坏 Pi config 语义。
- Pi-specific migrations：保留为显式导入或兼容工具，不在正常启动路径自动执行。
- package root 中对 TUI components 的 public exports：改为 legacy export 或移除 public contract。

## 配置和存储

desktop 产品可以使用 Meta Agent app data 作为宿主默认路径，但必须保持 Pi config/settings
语义兼容。路径是宿主配置，配置模型不能分叉。

建议存储层：

- app-level data 存在 Electron `app.getPath('userData')`
- workspace-level config 如有需要，使用 Meta Agent 项目目录
- per-thread session files 存在 Meta Agent sessions 目录
- credentials 存入 app 控制的 credential store 或加密文件 backend

项目本地发现规则应优先保持 Pi 兼容。Meta Agent 可以增加自己的宿主级存储和索引，
但不应让同一个项目在 Pi 和 Desktop 中得到不兼容的资源加载结果。

## 工具结果

工具应保留 Pi-compatible tool result，同时可以返回或派生适合 desktop 渲染的结构化
projection。

示例：

- `bash`：command、cwd、status、stdout/stderr chunks、exit code、duration、
  truncation metadata
- `read`：path、range、content summary、truncation metadata
- `edit`：path、unified patch、applied status、conflict/error detail
- `write`：path、created/updated status、byte count
- `grep/find/ls`：query/path、results、truncation metadata

terminal-specific render helpers 不应进入 worker-to-desktop projection contract，但
tool result 本体应保持 Pi 兼容。

## 审批和信任

审批应该是一等协议对象，而不是 extension-specific UI request。

示例：

```ts
approval.requested
approval.respond
workspace.setTrust
```

approval object 应标识：

- 请求的 action
- risk level
- 涉及的 command 或 file path
- timeout 或 dismiss 时的默认行为
- 决策作用范围：仅一次、当前 thread、或整个 workspace

## 迁移计划

具体实现规格见 [Desktop Specs](desktop-specs/README.md)。架构文档定义方向和约束，
spec 文档定义第一期可实现、可验收的后端拆分。

Phase 1：后端能力与 IPC

- 保持复制来的实现可运行
- 增加 desktop architecture docs 和 protocol drafts
- 避免把新的 desktop 能力继续加到旧 CLI/TUI surface 上
- 增加 `src/worker/protocol.ts`
- 增加 `src/worker/worker-main.ts`
- 增加 `src/client/rpc-client.ts`
- 增加 worker pool，支持 lease、并发限制、排队、idle 回收和 crash cleanup
- 支持多 thread 的 prompt、abort、snapshot 和 streaming events
- 增加 Electron main thread manager 和 preload typed IPC
- 覆盖 session、model、tool、compaction、retry、settings、auth、resource、extension UI、approval 的后端接口
- 确保 session/event/config/resource/extension/tool 语义与 Pi 同构，不引入 desktop-only 核心分支

Phase 2：renderer 接入

- 基于第一期 IPC 实现 Vue UI
- 渲染 thread list、timeline、tool calls、diffs、settings、session browser

Phase 3：归一化和产品化事件

- 将现有 agent/session/tool events 映射成 desktop event types
- 返回 thread snapshots
- 增加 file change 和 tool timeline models

Phase 4：移除 terminal coupling

- 从 core tools 移除 TUI 依赖
- 停止从 package root 导出 interactive components
- 将 CLI 和 TUI 代码隔离到 legacy entrypoints，或删除

Phase 5：产品化 sessions 和 settings

- 替换 `.pi` defaults
- 定义 Meta Agent session locations
- 集成 desktop auth 和 model settings
- 支持 resume、fork、clone、rename 和 archive

## 待决问题

- 每个 thread 是否始终持有一个 worker process，还是 idle thread 只保留 snapshot，
  直到恢复时再启动 worker？
- worker protocol 是否长期使用 stdio JSONL，还是之后切换到 Electron 更适合的
  transport？
- 旧 Pi extension system 保留多少？哪些能力应该升级为 desktop first-class
  integrations？
- file changes 只从工具结果追踪，还是 worker 同时 watch filesystem 以捕获外部修改？
- Windows、macOS、Linux 的第一版 credential backend 分别是什么？

## 指导原则

复制来的包是原材料，不是产品边界。Meta Agent Desktop 拥有用户体验、领域模型、
存储约定、安全模型和 RPC 协议。`packages/coding-agent` 应该成为服务这个产品
的 worker-grade agent runtime。
