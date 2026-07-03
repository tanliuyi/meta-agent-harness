# Desktop Coding Agent 架构

本文定义 `packages/coding-agent` 在 Meta Agent 中的演进方向。这个包来自
Pi，但 Meta Agent Desktop 不是 Pi 的桌面套壳。Desktop 是主要产品形态，
`packages/coding-agent` 应该演进为面向桌面产品的一等 coding agent worker
和运行时。

重要约束：Desktop 需要完整兼容 Pi 的核心能力和数据模型。迁移目标不是削弱 Pi
的 agent 能力，也不是另起一条 desktop-only 分支，而是把同一套 session、
event、config、resource、extension 和 tool 语义从 CLI/TUI 产品形态中抽离出来，
通过 desktop worker、transport、IPC 和 UI adapter 呈现。

更具体地说，Desktop 不是另开一个实现链路。凡是 Pi coding agent 已经有的线程、
session、prompt、queue、tool、compaction、retry、settings、resource、extension
链路，Desktop 都应优先复用同一份 `packages/coding-agent` core 代码和同一个
`AgentSession` 运行时对象。只有宿主进程隔离、Electron IPC、thread registry、
snapshot/projection 和 renderer 数据适配属于 Desktop 自己的 adapter 层；这些层
不得重新实现 Pi coding agent 的 agent loop 或消息队列状态机。

Desktop 和 Pi 应保持同构内核：

- 同构 session 格式和 branching 语义。
- 同构 agent/session/tool event 语义。
- 同构 settings/config/resource discovery 能力，默认路径、文件名、merge 顺序和错误边界与 Pi 一致。
- 同构 skills、prompt templates、extensions、custom tools 能力。
- 同构 auth/model registry/thinking/compaction/retry 行为。

Desktop 可以增加 thread worker registry、IPC、轻量 metadata 和 UI-friendly projection，
但这些只能是 adapter 或 projection，不能替代或分叉核心协议和状态语义。

特别是 live、持久化和恢复三段必须与 Pi 保持同一架构：

- live 阶段的会话真相是 worker 内的 `AgentSession.agent.state.messages`。
- `message_update` 只用于实时流式展示和订阅转发，不写入 durable message，不作为恢复来源。
- 持久化只发生在 Pi 相同的 session 边界，例如 `message_end` 调用
  `SessionManager.appendMessage()` 写入 Pi-compatible JSONL session。
- 恢复时从 JSONL session entries 通过 `SessionManager.buildSessionContext()` 重建
  `agent.state.messages`，再生成 desktop snapshot。
- Desktop 不引入 SQLite 或其他本地数据库作为第二状态层；thread/project metadata
  使用轻量文件或从 session 目录派生。当 metadata 与 JSONL session 冲突时，必须以
  JSONL canonical session 为准。

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

### Project / Workspace trust

Desktop 有 Project / Workspace 产品概念，因此 project trust 应属于 Project
状态，而不是 Thread 创建流程中的一次 approval。用户添加或打开 Project 时，
Electron main 应检测该目录是否存在 trust-requiring resources，例如
`.pi/settings.json`、`.pi/extensions`、`.pi/skills`、`.pi/prompts`、
`.pi/themes`、`.pi/SYSTEM.md`、`.pi/APPEND_SYSTEM.md`，以及 Project 或父目录下的
`.agents/skills`。检测结果应随 `ProjectSummary.trust` 返回给 renderer。

Project trust 状态分四类：

- `notRequired`：没有需要 trust 才加载的 Project 本地 agent 资源。
- `unknown`：存在需要 trust 的资源，但没有保存或本次会话决策。
- `untrusted`：用户明确不信任该 Project。
- `trusted`：用户信任该 Project，或本次会话临时信任。

当 Project 存在 trust-requiring resources 且未信任时，Project 列表或详情应显示
“未信任，本地 agent 资源已禁用”，并提供明确的 Project 级动作：

- 信任 Project：把当前 Project 路径写入 trust store。
- 信任父目录：把父目录写入 trust store，并清除当前 Project 的覆盖决策。
- 本次信任：只在当前 desktop 进程内启用 Project 本地 agent 资源。
- 不信任：把当前 Project 路径写入 deny 决策。

创建 Thread 不应弹出 project trust approval。Thread 创建只负责创建对话和启动
worker；worker 启动时读取当前 Project trust 状态：

- trusted / notRequired：传入 `projectTrustOverride: true`，允许 core runtime 加载
  Project 本地 settings、resources、packages、skills 和 extensions。
- unknown / untrusted：传入 `projectTrustOverride: false`，跳过这些 Project 本地
  agent 资源，但仍允许创建 Thread 和进行普通对话。

如果后续某个操作必须依赖 Project 本地 agent 资源，UI 应提示用户到 Project 层完成
trust 决策，而不是在 Thread 创建或普通 runtime approval 流程中临时弹
`project_trust`。Runtime approval bridge 仍用于危险命令、文件 mutation、扩展 UI
确认等运行时操作；Project trust 是 workspace 安全状态，不应混入一次性 tool
approval。

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
- Message queue：`steer`、`followUp`、streaming prompt queue、queue update、
  `steeringMode` 和 `followUpMode`，语义必须与 Pi `AgentSession` 完全一致。
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
- Desktop 不维护数据库 session 索引；session 真相源只有 Pi-compatible JSONL。
- live messages 不从宿主持久化层生成；running worker 的 messages 来自 `AgentSession.agent.state.messages`。
- 持久化 messages 只来自 JSONL session，写入时机与 Pi 相同，不能把流式 `message_update`
  token/delta 持久化为独立 message。
- 恢复 messages 时使用 Pi `SessionManager.buildSessionContext()` 的结果，而不是重放一套
  desktop-only conversation。
- 如果新增 desktop metadata，应放在可忽略的 metadata 层，不能破坏 Pi 读取。

Events：

- 保持 Pi 的 agent/session/tool event 语义作为 canonical event。
- Desktop 可以额外生成 UI projection event，但必须能追溯到 canonical event。
- 不应为了 UI 方便修改底层 event 含义。

Config/settings：

- 保持 Pi settings 的字段语义、merge 行为、runtime override 和错误处理边界。
- Desktop 默认使用 Pi 的 agentDir、settings、auth、models、session 和 resource discovery
  规则；不能定义一套 Meta Agent 专属默认配置根目录。
- 如通过 host options 指定 `agentDir`、`cwd` 或 session root，也必须调用 Pi 同一套
  SettingsManager、ResourceLoader、SessionManager 和 AuthStorage 逻辑，读写 Pi-compatible
  文件格式。
- `.pi` 是 Project 本地配置与资源来源的一等兼容路径，不是“导入兼容层”。
- Desktop 不得把 settings/auth/models/resources 迁移到 desktop-only schema；如需 UI
  管理配置，必须编辑或生成 Pi-compatible 配置文件。

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
- 文件编辑的 diff/patch 能力必须复用 Pi Coding Agent 的 `edit` 工具和
  `core/tools/edit-diff.ts`，Desktop 不另开发一条文件编辑、diff 计算或 patch 生成链路。

## 包职责

长期目标拆分如下：

```text
packages/coding-agent
  与 Pi 同构且被 Pi/Desktop 共同复用的 core agent runtime、tools、sessions、models、auth、compaction
  desktop worker process
  thread worker registry types / utility worker adapter
  Pi-compatible canonical protocol + desktop transport/projection
  给 Electron main 使用的 typed RPC client

apps/desktop
  Electron main thread manager
  preload API
  后端 IPC contract
  Vue renderer 数据层联调和简单 UI
  产品状态、布局和交互设计，后续继续重构 UI
```

desktop renderer 通过 preload IPC 和 Electron main 通信。Electron main 持有
coding agent workers。worker 内部运行的是同一个 Pi `AgentSession` / runtime 链路，
负责执行工具、调用模型、修改文件和持久化 session；worker 自身只负责进程边界、
transport envelope、lifecycle 和 desktop projection 适配。

第一期范围以后端能力、utility worker 与 IPC 为主，同时接入 renderer 数据层并提供简单
可用 UI，确保后续 UI 重构基于真实 API 而不是 mock：

- `packages/coding-agent` 提供 desktop worker、RPC protocol、typed client 和核心能力适配；
  desktop worker 必须调用已有 core runtime 入口，不复制 prompt/queue/tool/session 逻辑。
- `apps/desktop` 的 Electron main 提供 thread manager、thread worker registry、worker lifecycle、IPC handlers。
- `apps/desktop` 的 preload 暴露 typed API 和事件订阅能力。
- renderer 通过 Pinia store 消费 preload API、订阅实时事件、驱动 prompt/abort/approval 等核心操作。

```text
Vue renderer
  |
  | typed preload API
  v
Electron main
  |
  | utilityProcess postMessage transport
  v
Coding agent utility worker process
```

## UtilityProcess 优先的运行时

Desktop 默认采用进程隔离架构。Electron main 通过
`utilityProcess.fork()` 为每个运行中的 coding thread 创建独立 agent worker
process，并由 thread worker registry 管理 threadId 到 worker 的绑定、命令路由、
生命周期事件和关闭清理。Desktop 不设置 agent 并行上限，也不通过 worker pool
排队启动 thread；多个 thread 可以同时启动，各自拥有独立 utility process。

好处：

- agent run 崩溃不会拖垮桌面 UI
- shell 和文件系统能力不会进入 renderer
- 长任务可以独立停止或重启
- 多个 coding thread 可以并发运行
- idle thread 不需要永久占用进程
- 后续更容易加入 sandbox

worker 不是 `pi --mode rpc`，也不是通过 `child_process.spawn(process.execPath)`
启动的 Node/stdio 子进程。它应该是 Meta Agent 自己的 Electron utility worker
入口，由 `apps/desktop` 构建为 main 进程产物，例如：

```bash
apps/desktop/out/main/coding-agent-utility-worker.js
```

main 进程通过 `utilityProcess.fork(workerEntry)` 创建 worker，并通过
`child.postMessage(envelope)` 投递命令；worker 入口通过 `process.parentPort`
接收命令并回发响应和事件。该链路传输的是结构化 `WorkerEnvelope`，不使用
stdin/stdout JSONL 作为 desktop worker transport，也不保留旧 stdio worker
兼容入口。

utility worker entrypoint 只是新的进程宿主，不是新的 agent 实现。启动 thread 时，
worker 必须通过既有 runtime factory / `AgentSession` / `SessionManager` /
`SettingsManager` / `ResourceLoader` / tool registry 链路创建和恢复 Pi coding
agent 线程；prompt、steer、followUp、abort、tool execution、compaction、retry 和
session persistence 都应委托给这些 core 对象。

协议应兼容 Pi 的核心命令、事件和状态语义。Desktop 可以在此基础上增加 worker
lifecycle 控制命令和 UI projection，但不能设计成与 Pi RPC/session/event 割裂的第二套
核心协议，也不能因为 transport 从 stdio 变成 utilityProcess 就复制一份 agent
状态机。

## Thread Worker Registry

第一期使用 thread worker registry，而不是 worker pool。registry 属于 Electron
main 的后端基础设施；协议类型、worker entrypoint 和 worker client 由
`packages/coding-agent` 提供。

registry 职责：

- 按需启动 worker process。
- 为 thread 创建并绑定独立 worker。
- 维护 worker 与 thread 的绑定关系。
- 回收 idle worker。
- 处理 worker crash、exit、timeout。
- 捕获 worker stderr/stdout diagnostics，并处理 utility process error/exit。
- 将 worker events 路由回对应 thread 和 renderer subscriber。
- 在 app 退出时优雅停止所有 worker。

推荐第一期策略：

- active/running thread 独占一个 worker。
- idle thread 默认只保留 snapshot 和 session file，不永久占用 worker。
- resume idle thread 时，重新创建 utility worker 并加载对应 session。
- 不复用不同 thread 之间的 mutable agent runtime，避免 session、cwd、auth、
  extension runtime 泄漏。
- 不提供 `maxWorkers` 或 FIFO queue；agent 并行数量不由 registry 人为限制。

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

registry 接口：

```ts
type ThreadWorkerRegistry = {
  acquireThreadWorker(input: StartThreadInput): Promise<WorkerLease>
  releaseThreadWorker(threadId: string, reason: 'idle' | 'stop' | 'archive' | 'crash'): Promise<void>
  send(threadId: string, command: WorkerCommand): Promise<WorkerResponse>
  listLeases(): WorkerLease[]
  shutdown(): Promise<void>
}
```

必须避免的情况：

- 两个 running thread 共享同一个 mutable agent runtime。
- worker 复用后保留上一个 thread 的 cwd、messages、tools、extension handlers。
- worker crash 后 thread 状态仍显示 running。
- renderer 直接知道 worker pid 或直接操作 worker process。

## 第一期交付范围

第一期必须完成 worker、Electron main、preload IPC 与 renderer 数据层闭环，并覆盖
Pi 核心能力在协议层的位置。UI 层只做简单实现，后续可以重构视觉和交互。

必须交付：

- Desktop utility worker entrypoint：启动后通过 `process.parentPort` 接收结构化
  `WorkerEnvelope` 命令，并通过 `postMessage` 发送响应和事件。
- Thread worker registry：支持 lease、idle 回收、crash/exit cleanup；不设置 agent 并行上限。
- Desktop protocol types：命令、响应、事件、snapshot、tool results、approval、diagnostics。
- Utility process worker client：供 Electron main 管理 worker process 和发送命令。
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
- Project trust：Project 列表/详情展示 trust 状态，提供信任 Project、信任父目录、
  本次信任、不信任动作，并在 worker 启动时传入 Project trust override。
- Approval bridge：危险操作、一次性/线程/workspace 决策；不承载 Thread 创建时的
  Project trust 弹窗。
- File change reporting：从 tool results 产生结构化 file change event。
- Preload API：renderer 可调用的 typed command API 和 event subscription API。
- Renderer 数据层：thread list、active snapshot、事件订阅、prompt、abort、approval response。
- Renderer 简单 UI：可创建 thread、切换 thread、发送 prompt、查看基础状态和处理审批。

第一期不交付：

- 聊天 timeline 的视觉设计。
- diff viewer 的视觉实现。
- 设置页、模型选择页、session browser 的前端实现。
- 任何 IDE 式代码编辑器。

第一期验收标准：

- 可以从 Electron main 或测试脚本创建一个 coding thread。
- 可以通过 IPC/preload API 发送 prompt 并收到 streaming events。
- 可以在 agent running 时通过 IPC/preload API 发送 `steer`、`followUp`，以及带
  `streamingBehavior` 的 `prompt`；消息顺序、交付时机、queue update 和 pending
  snapshot 与 Pi `AgentSession` 测试语义一致。
- 可以通过 IPC/preload API 切换 `steeringMode` 和 `followUpMode`，并验证
  `one-at-a-time` 与 `all` 两种模式均生效。
- 可以执行并观察工具调用事件。
- 可以 abort 当前运行。
- 可以查询 thread snapshot、messages、stats、available models、commands。
- 可以新建、恢复、fork、clone、导入、导出 session 的后端流程。
- worker 崩溃或退出时 main 能发出 thread error/exited 事件并清理资源。
- thread worker registry 能立即为并行 thread 创建独立 utility worker、释放 idle worker，并能在 app 退出时停止全部 worker。
- renderer 数据层使用真实 preload API，不使用 mock 或直接访问 worker/credential/filesystem。

## Desktop 协议形态

命令应分成两层：

1. Canonical agent protocol：与 Pi 的 session、event、tool、config 语义同构。
2. Desktop control protocol：thread worker registry、thread registry、窗口订阅、
   projection 查询等 desktop 宿主能力。

Canonical 层优先保持 Pi 兼容，例如 prompt、steer、followUp、abort、session、
model、thinking、compaction、retry、bash、commands、extension UI 等能力。

Desktop control 层可以围绕产品概念分组。

### Message Queue / Steering 对齐

Desktop 必须完整对齐 coding-agent 的排队消息能力，不能只实现普通 `prompt` 和
`abort` 主链路。队列语义以 `AgentSession` 为唯一事实来源：

- Desktop 的实现路径应是 preload/Electron main/worker command routing 到
  `AgentSession`，而不是在 desktop thread manager、worker client 或 renderer store
  中重建一套 queue scheduler。
- `thread.steer` 必须调用 worker 内同一个 `AgentSession.steer(message, images)`。
  steering message 在当前 assistant turn 的工具调用结束后、下一次 LLM 调用前送达。
- `thread.followUp` 必须调用 `AgentSession.followUp(message, images)`。follow-up
  message 只在当前 agent run 没有更多 tool call 或 steering message 后送达。
- `thread.prompt` 在 worker streaming/running 时必须支持 Pi 同构的
  `streamingBehavior: 'steer' | 'followUp'`，并把该选项透传给
  `AgentSession.prompt()`；没有提供 `streamingBehavior` 时，错误边界应与 Pi 一致。
- `steer`、`followUp` 和带 `streamingBehavior` 的 `prompt` 都必须支持图片附件，
  并复用 core 的 prompt template、skill command 展开和 extension command 禁止排队规则。
- Desktop 不得在 Electron main、preload、renderer 或 metadata 层实现自己的消息 FIFO。
  UI 展示的 pending queue 必须来自 worker 转发的 canonical `queue_update` 或 snapshot
  中由 `AgentSession` 派生的 `queue.steering` / `queue.followUp`。
- `queue_update` 必须作为 canonical session event 通过 worker transport、Electron main
  和 preload 转发；renderer 可以派生 `queue.changed`，但不能改变字段名、顺序或交付语义。
- `set_steering_mode` / `set_follow_up_mode` 必须可从 desktop API 到达
  `AgentSession.setSteeringMode()` / `AgentSession.setFollowUpMode()`，并保留
  `'one-at-a-time'` 与 `'all'` 两种 Pi 模式。
- abort 行为必须与 Pi 保持一致：中止当前 run 时，未交付的 queued messages 应按 core
  语义保留或恢复给 UI；Desktop 不能静默丢弃 pending steering/follow-up。
- extension 通过 `sendUserMessage(..., { deliverAs: 'steer' | 'followUp' })` 注入的消息，
  也必须经由同一队列链路进入 Desktop UI 和 snapshot。

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
运行状态变化。实时事件必须走 transport，不通过宿主持久化层轮询或触发器传递。
第一版 desktop transport 固定使用 Electron `utilityProcess.fork()` 与
`postMessage`/`process.parentPort`；stdin/stdout JSONL 可以继续作为 Pi CLI/RPC
相关能力存在，但不属于 desktop worker 数据链路。TypeScript protocol types 是
事实来源。

因此 canonical worker command 至少必须包含并保持 Pi 命名：

```ts
{ type: 'prompt'; message: string; images?: ImageInput[]; streamingBehavior?: 'steer' | 'followUp' }
{ type: 'steer'; message: string; images?: ImageInput[] }
{ type: 'follow_up'; message: string; images?: ImageInput[] }
{ type: 'set_steering_mode'; mode: 'one-at-a-time' | 'all' }
{ type: 'set_follow_up_mode'; mode: 'one-at-a-time' | 'all' }
```

preload/renderer API 可以使用产品化命名 `followUp`，但 worker protocol 中的
canonical command type 不应改名为 desktop-only 风格。

Desktop 不使用数据库。Pi-compatible JSONL session 是 session 持久化真相源；
thread/project 列表等宿主 metadata 只能作为轻量索引或从 session 文件派生，不能
参与 canonical conversation 恢复。

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

持久化只通过 Pi SessionManager 写入 JSONL session。Electron main 可以保留内存态
projection 供当前窗口展示，但不落入数据库。

当前 projection event 只保留 worker/renderer 实际消费的 UI 派生状态：

```ts
thread.stateChanged
thread.error

tool.started
tool.updated
tool.finished

file.changed
approval.requested
extensionUi.requested

thinking.changed
queue.changed
```

message、model、session、compaction 等 canonical 事实不再定义第二套 projection
事件；renderer 需要展示时从 canonical event 或 snapshot 派生。provider-specific
或低层事件可以作为诊断详情保留。canonical event 是兼容契约，projection event 是
UI 契约。

### Live / Persistence / Restore

Desktop 的 live、持久化和恢复必须复用 Pi 的 AgentSession/SessionManager 语义，
不能在 Electron main 或宿主持久化层中重新实现一套会话状态机。

Live 阶段：

- worker 持有唯一 live runtime：`AgentSession`。
- live messages 来自 `agent.state.messages`，renderer 通过 streaming event 增量更新 UI。
- `get_state` 复用 Pi RPC 的 `RpcSessionState` 字段；Desktop 只追加当前 runtime `cwd`，
  不维护第二套 live state 协议。
- `get_messages` 复用 Pi RPC `{ messages: AgentMessage[] }` 语义，Desktop message 展示由共享
  `toDesktopMessages()` 转换派生。
- model list、model cycle、thinking cycle、slash command list 等 IPC 返回类型从 Pi
  `RpcResponse` 提取，不在 Desktop shared types 中重新声明第二套协议。
- `message_start` 创建或显示消息占位。
- `message_update` 更新同一个 live assistant message，用于 text/thinking/tool call delta
  展示和外部订阅。
- `message_end` 表示该 message finalized。
- Electron main 可以转发 canonical event，也可以派生 projection event，但不能把
  `message_update` 持久化成 message。

持久化阶段：

- 与 Pi 一样，普通 user/assistant/toolResult/custom message 只在 `message_end` 后通过
  `SessionManager.appendMessage()` 或对应 append API 写入 JSONL。
- bash、compaction、branch summary、session info、model/thinking change 等使用 Pi
  已有 session entry 类型和写入时机。
- JSONL session 是 durable conversation log 和 branching graph。
- Electron main 可以在内存中维护 tool/file/approval projection、diagnostics 和 thread
  metadata；需要跨重启保留的 conversation 内容必须写入 JSONL session。

恢复阶段：

- 启动或 resume thread 时，worker 使用 Pi `SessionManager.open()` 打开对应 JSONL session。
- Desktop 需要在启动 worker 前解析 cwd 时，必须复用与 `SessionManager.open()` 同源的 JSONL
  header 解析逻辑，不能用宿主 Project.path 覆盖 session header cwd。
- 使用 `SessionManager.buildSessionContext()` 根据 leaf、branch、compaction 规则重建
  `agent.state.messages`、thinking level 和 model context。
- desktop snapshot 从 worker live state 或 JSONL 重建结果派生。
- snapshot 必须从 worker live state 或 JSONL 重建结果派生；不得从独立数据库 cache
  恢复 conversation。

## Thread Snapshot

worker 应该能在任何时刻返回完整 thread snapshot。这让 desktop 在刷新和
重连后可以恢复 UI 状态。worker 重启后的会话恢复必须先按 Pi 语义从 JSONL
session 重建 live runtime，再由 runtime 派生 snapshot。

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

snapshot 用于状态恢复和首次渲染。流式事件用于增量更新。snapshot 不是独立的
session 持久化格式，不能取代 JSONL session。

snapshot 只能由 worker 当前内存状态或 JSONL session 的 `buildSessionContext()`
结果派生。renderer 仍通过 IPC 请求 snapshot，不直接读取 session 文件。snapshot
不应成为与 Pi session 状态不一致的第二真相源。

## 状态存储定位

Desktop 不引入本地数据库。状态存储按 Pi 同构拆成三类：

- Pi-compatible JSONL session：唯一 durable conversation log，包含 messages、
  branching、compaction、model/thinking/session info 等 canonical entries。
- worker live state：当前运行中的 `AgentSession`，负责 streaming、queue、tool
  execution、approval bridge 和 runtime 状态。
- desktop metadata：thread/project 列表、归档、展示名称等轻量宿主信息，可以用
  JSON 文件或从 sessions 目录派生；它不参与 agent context 恢复。

宿主持久化层不负责：

- assistant streaming delta 的实时传递
- assistant streaming delta 或 token 的 durable message 持久化
- 从 `message_update` 构建 canonical messages
- tool output streaming 的实时传递
- prompt、abort、steer、followUp 等命令投递
- worker heartbeat 和 lifecycle control
- backpressure、cancel、timeout 等实时控制

推荐组合：

```text
Transport: Electron utilityProcess postMessage
Session raw log: Pi-compatible JSONL session
Metadata: lightweight JSON files or session-directory derived index
```

metadata 规则：

- JSONL session 用于 agent 上下文、兼容导入导出和原始会话日志，是 session 的
  canonical persistence。
- metadata 不保存 messages、tool result 正文、streaming delta 或 provider payload。
- metadata 可删除；删除后可通过 session 目录和 JSONL session 文件重建 thread 列表和
  最小 snapshot。
- metadata 与 JSONL session 冲突时，以 JSONL session 为准。

## 能力边界

Renderer：

- 渲染 threads、messages、tool calls、diffs、approvals、settings 和 status
- 通过 preload API 发送用户意图
- 永远不获得原始 shell 或文件系统权限
- 永远不保存模型密钥

Electron main：

- 通过 `utilityProcess.fork()` 启动和停止 worker processes
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
- `core/auth-storage.ts`，保持 Pi-compatible auth.json 语义；desktop credential policy
  只能作为 Pi 支持的 credential backend/override，不改变 provider credential 解析结果
- `core/model-registry.ts`，与 `packages/ai` 对齐
- `core/skills.ts` 和 `core/prompt-templates.ts`，保持 Pi 发现语义和默认根目录
- `modes/rpc/*` 的 framing 和 typed client 思路，作为 canonical protocol 兼容基础

从 desktop 默认产品面中移除或隔离，但不丢失底层能力：

- 旧终端交互呈现层已移除，不作为 desktop-only runtime 的组成部分。
- terminal UI components 和 themes：不进入 desktop runtime contract。
- CLI startup flows 和 selectors：能力迁移到 desktop onboarding/settings/session UI。
- package-manager CLI 行为：扩展/技能/模板管理能力可保留，但入口应 desktop 化。
- Pi self-update 行为：desktop 更新由 Electron updater 或 Meta Agent 自己的更新机制负责。
- `.pi` 默认路径：作为 Pi-compatible Project 配置和资源发现路径保留；desktop 不定义替代默认语义。
- Pi-specific migrations：保留为显式导入或兼容工具，不在正常启动路径自动执行。
- package root 中对 TUI components 的 public exports：改为 legacy export 或移除 public contract。

## 配置和存储

Desktop 必须完整兼容 Pi 的 session.jsonl、settings、auth、models、resources、skills、
prompt templates 和 extensions。默认情况下使用 Pi 的 `getDefaultAgentDir()`、
默认 session 目录、`settings.json`、`auth.json`、`models.json` 和 Project `.pi`
发现规则。路径可以作为显式 host override 传入，但配置模型、文件格式和 merge 语义不能分叉。

建议存储层：

- agent-level data 默认使用 Pi agentDir。
- workspace/project-level config 默认使用 Pi 支持的 Project `.pi` 资源路径。
- per-thread session files 默认使用 Pi SessionManager 的 session directory 规则。
- credentials 默认使用 Pi-compatible `auth.json` / OAuth / env / runtime override 解析。
- Desktop metadata 可以放在 Electron `userData`，但不得包含 canonical settings、auth、
  models、resources 或 session messages。

同一个 project、agentDir 和 sessionFile 在 Pi 和 Desktop 中必须得到相同的 session
context、settings resolution、resource discovery、model registry 和 credential resolution
结果。Desktop UI 是这些 Pi-compatible 文件和 runtime 状态的呈现层，不是新的配置系统。

## 工具结果

工具应保留 Pi-compatible tool result，同时可以返回或派生适合 desktop 渲染的结构化
projection。

文件编辑对齐规则：

- Desktop 文件编辑必须调用 Pi Coding Agent 已有的 `createEditToolDefinition()` /
  `createEditTool()` 执行编辑，不绕过工具实现直接写文件。
- Desktop 展示 diff 时消费 `edit` tool result 的 `details.diff`；需要标准 patch
  时消费 `details.patch`，该 patch 由 `generateUnifiedPatch()` 生成。
- 如需编辑前预览，只能复用 `computeEditsDiff()` 或同一 `edit-diff.ts` 模块中的
  diff 生成逻辑；不得在 Desktop worker、Electron main 或 renderer 中重新实现
  old/new content diff 算法。
- Desktop 的 file change / diff projection 只是从 Pi-compatible tool result 派生的
  UI 视图，必须保留原始 tool result 作为 canonical source。
- Renderer 可以产品化 diff viewer，但只能渲染 worker projection 或 tool result
  中的 diff/patch 数据；不得引入独立的文件编辑协议、patch schema 或代码编辑器链路。
- 文件变更摘要 UI 参考 Codex 风格：一行展示操作状态、文件名和增删行数，例如
  `已编辑 desktop-architecture.md +35 -18`；文件名、additions 和 deletions 来自
  `edit` result 派生的 file change projection，而不是 renderer 重新扫描 git diff。

示例：

- `bash`：command、cwd、status、stdout/stderr chunks、exit code、duration、
  truncation metadata
- `read`：path、range、content summary、truncation metadata
- `edit`：path、display diff、unified patch、first changed line、applied status、
  conflict/error detail
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

Phase 1：后端能力、IPC 与 renderer 数据层联调

- 保持复制来的实现可运行
- 增加 desktop architecture docs 和 protocol drafts
- 避免把新的 desktop 能力继续加到旧 CLI/TUI surface 上
- 增加 `src/worker/protocol.ts`
- 增加 Electron utility worker 入口 `src/desktop/worker/worker-main.ts`
- 增加 utility process worker client/transport
- 增加 thread worker registry，支持 lease、idle 回收和 crash cleanup，不设置 agent 并行上限
- 支持多 thread 的 prompt、abort、snapshot 和 streaming events
- 增加 Electron main thread manager 和 preload typed IPC
- 接入 renderer Pinia store 和简单 UI，验证 thread/prompt/event/approval 主链路
- 覆盖 session、model、tool、compaction、retry、settings、auth、resource、extension UI、approval 的后端接口
- 确保 session/event/config/resource/extension/tool 语义与 Pi 同构，不引入 desktop-only 核心分支

Phase 2：renderer 产品化重构

- 在第一期真实数据层上重构 Vue UI
- 产品化 thread list、timeline、tool calls、diffs、settings、session browser

Phase 3：归一化和产品化事件

- 将现有 agent/session/tool events 映射成 desktop event types
- 返回 thread snapshots
- 增加 file change 和 tool timeline models

Phase 4：移除 terminal coupling

- 从 core tools 移除 TUI 依赖
- 停止从 package root 导出 interactive components
- 将 CLI 和 TUI 代码隔离到 legacy entrypoints，或删除

Phase 5：产品化 sessions 和 settings

- 产品化 Pi-compatible session browser 和 settings UI
- 显式暴露当前 Pi agentDir/sessionDir/settings/auth/models 路径
- 集成 desktop UI 到 Pi-compatible auth 和 model settings
- 支持 resume、fork、clone、rename 和 archive

## 待决问题

- 每个 thread 是否始终持有一个 worker process，还是 idle thread 只保留 snapshot，
  直到恢复时再启动 worker？
- utility process worker 是否采用 one-shot 还是可复用 reset 模型？
- 旧 Pi extension system 保留多少？哪些能力应该升级为 desktop first-class
  integrations？
- file changes 只从工具结果追踪，还是 worker 同时 watch filesystem 以捕获外部修改？
- Windows、macOS、Linux 的第一版 credential backend 分别是什么？

## 指导原则

复制来的包是原材料，不是产品边界。Meta Agent Desktop 拥有用户体验、领域模型、
存储约定、安全模型和 RPC 协议。`packages/coding-agent` 应该成为服务这个产品
的 worker-grade agent runtime。
