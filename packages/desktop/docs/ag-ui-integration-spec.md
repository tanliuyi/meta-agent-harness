# Desktop AG-UI 集成规范

状态：Implemented  
最后更新：2026-07-15

> Thread 切换、active run 恢复和 Electron 订阅原子性已由 [Desktop assistant-ui Thread Adapter 与原子 Attach 规范](./assistant-ui-thread-attach-spec.md) 取代。本规范后续只作为 Pi -> AG-UI 映射、控制面和 catalog/runtime 基础规范。

## 1. 背景

Desktop 当前通过以下链路把 Pi `AgentSession` 状态传给 renderer：

```text
AgentSessionEvent
  -> SessionRuntime.onEvent()
  -> 构造完整 SessionSnapshot
  -> Electron IPC 广播
  -> renderer reducer
  -> assistant-ui ExternalStoreRuntime
```

该实现能够形成完整闭环，但在长会话和流式输出期间存在结构性成本：

- `message_update` 和 `tool_execution_update` 最多每 32 ms 生成一次完整快照。
- 每次快照都会重新遍历、投影和序列化全部历史消息。
- Electron IPC 会结构化克隆完整消息数组并广播给全部窗口。
- renderer 收到快照后再次把全部消息转换为 assistant-ui 消息。
- `SessionManager.list()` 会读取 Project 下所有 JSONL 文件；打开单个 session 前也会重复执行该扫描。
- `SessionSupervisor.list()` 为获取运行中 session 的列表摘要而生成完整快照。

本规范采用 AG-UI（Agent User Interaction Protocol）作为 Pi Agent 与 renderer 之间的活动会话数据协议，并将 `SessionSupervisor` 收敛为 session 生命周期与资源管理组件。

## 2. 目标

本次重构必须满足以下目标：

1. 流式事件的传输与历史消息总量无关。
2. 完整消息快照只用于首次打开、重新连接和协议失步恢复。
3. 使用 AG-UI 标准事件表达 run、消息、reasoning 和 tool call。
4. 使用 assistant-ui 官方 `@assistant-ui/react-ag-ui` runtime，不继续维护自制消息 runtime。
5. Electron IPC 继续作为本地传输层，不引入 HTTP server、SSE server 或 WebSocket server。
6. 主进程保持 Pi session 的唯一权威数据源。
7. renderer 的消息时间线只由 AG-UI runtime 投影；Pi 特有状态保持为独立低频控制面。
8. 会话列表、磁盘索引和 runtime 创建必须避免重复全量扫描与并发重复创建。
9. 现有 prompt、steer、follow-up、cancel、compact、model、thinking level 和扩展 UI 能力不得丢失。

## 3. 非目标

以下内容不属于本规范的首期范围：

- 不把 Pi Agent 改造成远程 AG-UI HTTP 服务。
- 不替换 Pi `SessionManager` 的 JSONL 持久化格式。
- 不把 Project、文件、终端或 Workbench Panel 状态放入 AG-UI。
- 不引入 A2A、MCP 或 A2UI 协议变更。
- 不实现 AG-UI draft meta events、branching 或 time-travel。
- 不长期保留旧 `SessionSnapshot.messages` 与 AG-UI 消息流双写。

## 4. 设计原则

### 4.1 单一数据源

`AgentSession` 和 `SessionManager` 是消息、run 状态与持久化历史的唯一数据源。renderer 不得自行推断持久化结果，也不得维护与 main 并行演进的第二套消息模型。

### 4.2 控制面与数据面分离

Desktop IPC 分为两类：

- 控制面：Project、session 目录、模型选择、thinking level、队列、归档、文件、终端和 Workbench。
- AG-UI 数据面：run 生命周期、消息流、reasoning、tool call、tool result 和权威消息快照。

高频数据不得通过控制面完整快照传输。

### 4.3 标准事件优先

Pi 事件能够映射到 AG-UI 标准事件时，必须使用标准事件。只有标准协议无法表达的 Desktop/Pi 特有语义才能使用 `CUSTOM`，调试透传才能使用 `RAW`。

### 4.4 快照用于建立基线

`MESSAGES_SNAPSHOT` 只允许用于：

- 首次打开 session；
- renderer 重新加载；
- IPC 订阅重新建立；
- sequence 不连续后的恢复；
- 无法安全表达为 delta 的整体状态切换。
- run settle 前校正 queued user message、tool loop 分组及 live/persisted ID 差异。

普通流式输出不得发送完整消息快照。

## 5. 目标架构

```text
Main process

Pi AgentSession
  -> PiAgUiAdapter
       -> AG-UI BaseEvent
       -> SessionEventEnvelope(sequence)
  -> SessionSupervisor
       -> runtime registry
       -> session catalog cache
       -> renderer subscriptions
  -> Electron webContents.send

Renderer process

preload sessions.subscribe()
  -> renderer SessionEventBus
  -> ElectronPiAgent extends AbstractAgent
  -> @assistant-ui/react-ag-ui useAgUiRuntime()
  -> AssistantRuntimeProvider
  -> assistant-ui primitives
```

## 6. 组件职责

### 6.1 `SessionSupervisor`

`SessionSupervisor` 只负责：

- 按 `projectId + threadId` 管理 `SessionRuntime` 生命周期；
- 保证同一 session 的 runtime 创建为 single-flight；
- 管理 Project 级 session catalog cache；
- 处理 create、open、rename、archive、remove 和 dispose；
- 管理 renderer 对 session 的订阅关系；
- 将 `PiAgUiAdapter` 产生的事件定向发送给订阅窗口；
- 提供首次同步和失步恢复入口。

`SessionSupervisor` 不再：

- 在每次 Pi 事件后生成完整消息快照；
- 为构造 `Thread` 摘要调用 `SessionRuntime.snapshot()`；
- 向所有窗口广播所有 session 的事件；
- 为每次 open、rename 或 remove 重复扫描全部 session 文件。

### 6.2 `SessionRuntime`

`SessionRuntime` 负责：

- 创建或恢复一个 Pi `AgentSession`；
- 绑定扩展 UI context；
- 执行 prompt、steer、follow-up、cancel、compact、model 和 thinking 操作；
- 持有一个 `PiAgUiAdapter`；
- 提供不含完整历史投影的轻量 `threadSummary()`；
- 在 dispose 时取消 Pi 订阅并释放扩展资源。

### 6.3 `PiAgUiAdapter`

`PiAgUiAdapter` 是 main 内唯一的 Pi -> AG-UI 转换层，负责：

- 订阅 `AgentSessionEvent`；
- 为每次执行维护 `runId`；
- 生成稳定的 `messageId` 与 `toolCallId`；
- 把 Pi 增量内容转换为 AG-UI 增量事件；
- 缓存并压缩当前 active run 的续接事件日志；
- 在 bootstrap 和 run settle 时生成 `MESSAGES_SNAPSHOT`；
- 保留事件顺序，不在 renderer 重新解释 Pi 原始事件。

### 6.4 `ElectronPiAgent`

renderer 中新增 `ElectronPiAgent extends AbstractAgent`：

- 由 assistant-ui `UseAgUiThreadListAdapter` hydrate bootstrap messages；
- `run(input)` 把 `RunAgentInput` 转发给 preload API；
- 返回由 Electron IPC 事件构造的 `Observable<BaseEvent>`；
- 只接收匹配 `projectId`、`threadId` 和 `runId` 的事件；
- assistant-ui cancel 同时结束本地 Observable 并调用 `sessions.cancel()`；
- 发现 sequence 缺口时停止应用后续 delta，并通过原子 attach 请求完整 bootstrap；
- active run 在官方 thread adapter hydrate 完成后，以 bootstrap history head 为 parent replay 压缩事件日志；
- thread 切换调用 `agent.detachActiveRun()`，只解除本地 Observable，不隐式 abort Pi run。

不得在 renderer 中创建 `HttpAgent`。本地 Electron IPC 是该 agent 的传输实现。

### 6.5 assistant-ui runtime

活动会话必须使用：

```tsx
const runtime = useAgUiRuntime({ agent });

return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
```

`@assistant-ui/react-ag-ui` 负责：

- AG-UI 事件解析；
- 流式消息重建；
- reasoning 与 tool-call 投影；
- cancel 和标准 run 对接；
- assistant-ui `ExternalStoreRuntime` 集成。

官方 runtime 不提供 Pi mid-run steer/follow-up、Electron `AbstractAgent` event-stream 续接和 tool result error 字段。Desktop 分别使用控制面 enqueue、原子 attach + active replay 和 `SessionToolUpdate` external store 补齐，且这些高频状态不进入 Desktop reducer。

renderer 的通用聊天交互使用 assistant-ui primitives：

- thread、message、message part 和 Markdown 使用 `ThreadPrimitive`、`MessagePrimitive`、`MessagePartPrimitive`；
- Composer 草稿、输入、idle send、cancel、附件选择和附件列表使用 `ComposerPrimitive`；
- 附件容器、名称和移除操作使用 `AttachmentPrimitive`；
- run error 和消息复制使用 `ErrorPrimitive`、`ActionBarPrimitive`；
- 图片读取由 `SimpleImageAttachmentAdapter` 负责，不在组件内维护第二套图片数组或 `FileReader` 链路。

官方 `ComposerPrimitive.Send` 在 thread running 且 runtime 未声明 assistant-ui queue capability 时会禁用。Pi 的 mid-run steer/follow-up 仍由 `ComposerPrimitive.Root` 的 submit 扩展分支调用 Desktop `enqueue()`，不得伪装为新的 AG-UI run。queue、model/thinking、HostUi、SessionStatus 和 Pi tool 内容没有等价 primitive，继续作为业务扩展槽。当前版本只提供文件扩展名 thumb，图片预览允许保留在 `AttachmentPrimitive.Root` 内的薄展示组件。

完成切换后，删除当前 `usePiRuntime` 中的自制 `convertMessage()`、`messageStatus()` 和 `useExternalStoreRuntime()` 适配逻辑。

## 7. IPC 协议

### 7.1 事件信封

AG-UI `BaseEvent` 外层必须增加 Desktop 传输信封：

```ts
interface SessionEventEnvelope {
	protocolVersion: number;
	projectId: string;
	threadId: string;
	runId?: string;
	sequence: number;
	event: BaseEvent;
}
```

要求：

- `sequence` 在单个 `projectId + threadId` 内严格单调递增；
- sequence 由 main 分配，renderer 不得生成；
- renderer 必须丢弃重复事件；
- renderer 发现 sequence 缺口时必须请求 resync；
- `runId` 使用 AG-UI run input 中的 ID，不得在 main 和 renderer 分别生成两个 ID。

### 7.2 事件批次

为减少 Electron IPC 调用次数，main 可以按一个渲染帧内的事件组成批次：

```ts
interface SessionEventBatch {
	protocolVersion: number;
	projectId: string;
	threadId: string;
	fromSequence: number;
	toSequence: number;
	events: SessionEventEnvelope[];
}
```

批次要求：

- 最长等待时间不得超过 16 ms；
- `RUN_FINISHED` 和 `RUN_ERROR` 必须立即 flush；
- 不得合并或重排同一 `messageId`、`toolCallId` 的内容 delta；
- 不得把多个 thread 放入同一批次。

### 7.3 原子 Attach

preload API 应提供：

```ts
attach(
	projectId: string,
	threadId: string,
	listener: (update: SessionPush) => void,
): Promise<SessionBootstrap>;

flush(): void;
detach(): void;
```

`SessionPush` 是 `control | tool | events` 联合类型。`control` 进入 Desktop reducer，`tool` 进入按 `toolCallId` 索引的 external store，只有 `events` 交给 `ElectronPiAgent`。

main 必须按 `webContents.id` 保存单一 attachment，只向该 attachment 发送事件。bootstrap cursor 与 attachment 注册必须在同一主进程执行片段内完成；窗口销毁时自动清理。

### 7.4 首次同步和恢复

`sessions.attach()` 返回：

```ts
interface SessionBootstrap {
	protocolVersion: 3;
	projectId: string;
	threadId: string;
	cursor: number;
	control: SessionControlState;
	messages: Message[];
	state: JsonValue;
	activeRun?: {
		runId: string;
		events: BaseEvent[];
	};
}
```

idle session 的 `messages` 必须等价于 AG-UI `MESSAGES_SNAPSHOT`。active session 使用 run 开始时的基线 messages，并通过 `activeRun.events` 重建正在流式更新的 assistant message。首期 `state` 固定为空对象；bootstrap 完成后只应用 `sequence` 大于 `cursor` 的实时事件。

## 8. Pi -> AG-UI 映射

### 8.1 Run 生命周期

| Pi | AG-UI | 约束 |
| --- | --- | --- |
| prompt/continue 开始 | `RUN_STARTED` | 必须包含 `threadId` 和 `runId` |
| `turn_start` | `STEP_STARTED` | `stepName` 使用稳定的 turn 标识 |
| `turn_end` | `STEP_FINISHED` | 必须与 start 成对 |
| `agent_settled` | `RUN_FINISHED` | 自动重试全部结束后才能发送 |
| 不可恢复错误 | `RUN_ERROR` | 发送后该 run 不再产生普通内容事件 |
| 用户取消 | 本地 Observable `AbortError` + Pi `abort()` | assistant-ui 标记 cancelled，随后 resync 权威历史 |

`agent_end` 可能进入自动重试，不能直接等价为 `RUN_FINISHED`。最终边界以 `agent_settled` 或不可恢复错误为准。

### 8.2 文本消息

| Pi | AG-UI |
| --- | --- |
| assistant `message_start` | `TEXT_MESSAGE_START` |
| `text_delta` | `TEXT_MESSAGE_CONTENT` |
| assistant `message_end` | `TEXT_MESSAGE_END` |

要求：

- `TEXT_MESSAGE_CONTENT.delta` 必须直接使用 Pi provider 流中的文本 delta；
- 不得在每个 delta 后重新发送累计全文；
- 同一条消息的所有事件必须使用相同 `messageId`；
- 用户输入由 `RunAgentInput.messages` 表达，不得因 Pi 的 user `message_start` 再插入重复用户消息。

### 8.3 Reasoning

Pi thinking 事件映射为：

- `REASONING_START`
- `REASONING_MESSAGE_START`
- `REASONING_MESSAGE_CONTENT`
- `REASONING_MESSAGE_END`
- `REASONING_END`

只允许发送 Pi 明确标记为可展示的 reasoning。redacted 或加密 reasoning 不得以明文进入 renderer；需要保持连续性时使用不透明 encrypted value，不得在 Desktop 解密。

不得使用已废弃的 `THINKING_*` AG-UI 事件。

### 8.4 Tool call

| Pi | AG-UI |
| --- | --- |
| `toolcall_start` | `TOOL_CALL_START` |
| `toolcall_delta` | `TOOL_CALL_ARGS` |
| `toolcall_end` | `TOOL_CALL_END` |
| `tool_execution_end` | `TOOL_CALL_RESULT` |

要求：

- backend tool 由 Pi 执行，renderer 不得重复执行；
- frontend tool 只有在显式注册且协议声明由 frontend 执行时才允许执行；
- `toolCallId` 必须直接复用 Pi ID；
- 长工具输出允许发送增量活动或自定义事件，但最终必须有标准 `TOOL_CALL_RESULT`。

### 8.5 Desktop 控制状态

`running`、compaction、retry、queue、context usage、HostUi、extension UI、模型与 thinking level 统一保留在 `SessionControlState`。该状态按 revision 低频推送，不携带消息数组，也不使用 AG-UI `STATE_DELTA`。

首期 AG-UI state 固定为空对象。等官方 runtime 暴露 state patch 失败恢复能力后，再单独评估可共享业务状态。

### 8.6 HostUi

首期不把阻塞式 HostUi 请求映射为 AG-UI interrupt。Pi HostUi 当前会阻塞同一个 backend tool/run，而 AG-UI interrupt 会结束当前 run；直接映射会造成重复执行或丢失续接语义。confirm、select、input、editor、notify 和 widget 继续通过 Desktop 控制面处理。

### 8.7 Custom 与 Raw

首期不发送 `CUSTOM`，因为 queue、compaction、HostUi 和 extension UI 已由 Desktop 控制面权威表达，重复发送会形成双写。后续只有同时满足以下条件时才允许新增：标准 AG-UI 事件无法表达、事件必须参与 run 时间线、renderer 存在明确消费者。

新增 `CUSTOM` 时名称必须使用 `pi.` 前缀，例如：

- `pi.compaction.started`
- `pi.extension.widget.updated`

只有显式 debug 模式下的兼容性诊断允许设置 `rawEvent` 或发送 `RAW`，默认生产链路不传输。生产 UI 不得依赖 `RAW` 中的 Pi 内部对象结构，诊断事件也不得包含凭据、完整 provider 请求或未脱敏 reasoning。

## 9. 消息与运行 ID

### 9.1 `runId`

- renderer 在发起 `RunAgentInput` 时生成；
- main 和 Pi adapter 必须沿用该 ID；
- retry 属于同一 run，不生成新的 `runId`；
- follow-up 在前一个 run settled 后开始时生成新 `runId`；
- steer 属于当前 run 的实时输入，不得错误创建并行 run。

### 9.2 `messageId`

- tool call 使用 Pi 原生 `toolCallId`；
- assistant 流式消息 ID 在 `message_start` 时确定，直到持久化后保持不变；
- 历史重载必须生成与原消息一致的 ID；
- 禁止仅使用数组下标作为长期消息身份；
- 在 Pi 没有公开持久化 entry ID 时，使用 session ID、消息 timestamp、role 和同 timestamp ordinal 生成确定性 ID。

## 10. Session catalog 与 runtime 性能

### 10.1 Catalog cache

`SessionSupervisor` 为每个 Project 缓存：

```ts
Map<threadId, SessionInfo>
```

cache 在以下时机刷新或定点更新：

- 首次列出 Project sessions；
- 创建、重命名或删除 session；
- session 完成持久化；
- 显式 refresh；
- 检测到 session 目录变更。

打开、重命名和删除已缓存 session 时必须直接使用缓存的 `path`，不得再次调用全量 `SessionManager.list()`。

### 10.2 Thread summary

运行中的 `SessionRuntime` 必须提供 O(1) 或与最新消息大小相关的 `threadSummary()`。列表页不得为了 title、updatedAt、messageCount 或 running 状态投影完整历史。

### 10.3 Runtime single-flight

除已创建 runtime map 外，还需要维护：

```ts
Map<runtimeKey, Promise<SessionRuntime>>
```

并发 open/run/enqueue/cancel 命中同一 session 时必须复用同一个创建 Promise。创建失败后必须删除 pending 项，允许后续重试。

## 11. 错误恢复

renderer 必须在以下情况请求 `SessionBootstrap`：

- 收到的 `fromSequence` 大于 `lastSequence + 1`；
- AG-UI event schema 校验失败；
- thread 切换期间收到无法归属的事件；
- renderer reload 后恢复活动 session。

恢复流程：

1. 暂停应用该 session 的后续 delta；
2. 通过原子 attach 请求 main 返回 bootstrap 并替换窗口 attachment；
3. 通过 assistant-ui `thread.import()` 原子替换 messages，并应用空 state 和控制状态；
4. 将 `lastSequence` 更新为 bootstrap cursor；
5. 丢弃 sequence 不大于该值的缓存事件；
6. 继续处理后续事件。

不得通过猜测缺失文本或重复执行用户 prompt 恢复。

## 12. 依赖

实现时计划引入以下直接依赖，必须锁定精确版本：

```json
{
	"@ag-ui/client": "0.0.57",
	"@ag-ui/core": "0.0.57",
	"@assistant-ui/react-ag-ui": "0.0.44",
	"rxjs": "7.8.1"
}
```

上述包仍为 `0.0.x`。升级前必须检查：

- `BaseEvent` 与 event schema 变更；
- `AbstractAgent.run()` 和 cancel 契约；
- assistant-ui interrupt API；
- thread-list experimental API；
- reasoning 事件的废弃与迁移说明。

## 13. 迁移策略

### 已实现：协议和适配器

- 增加精确锁定的 AG-UI 依赖；
- 定义 Electron IPC envelope、batch 和 bootstrap contracts；
- 实现并测试 `PiAgUiAdapter`；
- 实现 session sequence 与定向订阅。

### 已实现：renderer 切换

- 实现 `ElectronPiAgent`；
- 接入 `useAgUiRuntime`；
- 将消息、reasoning、tool 和 run UI 切到官方 runtime；
- 将 Composer、图片附件、发送、取消、run error 和消息复制切到 assistant-ui primitives；
- 保留 queue、model/thinking、HostUi、SessionStatus 和 Pi tool 内容为显式业务扩展；
- 在同一阶段删除旧 `usePiRuntime` 消息适配和 `SessionSnapshot.messages` 高频广播。

禁止让旧消息链路与 AG-UI 链路长期双写。迁移提交必须以完整测试保证原子切换。

### 已实现：Supervisor 收敛

- 增加 catalog cache；
- 增加 `threadSummary()`；
- 增加 runtime single-flight；
- 增加窗口订阅清理；
- 删除无用的全量 snapshot publish 路径。

### 已实现：官方 Thread Adapter 与原子 Attach

- 使用 `UseAgUiThreadListAdapter` 管理切换与 hydrate；
- 使用单一窗口级 assistant-ui runtime，不再按 session key remount；
- main/preload 使用 attachment token 建立原子 bootstrap/push 边界；
- 同 thread 失步通过 `thread.import()` 恢复；
- 删除 history hydration barrier 和 renderer 跨 session event buffer。

### 后续：高级能力

- 将 HostUi 阻塞请求迁移为 AG-UI interrupts；
- 评估 frontend tool；
- 只有在 AG-UI draft 稳定后再评估 branching/time-travel。

## 14. 测试要求

### 14.1 Adapter 单元测试

必须覆盖：

- text start/content/end 顺序；
- reasoning start/content/end；
- tool call args 增量与 result；
- retry 期间不提前 finish；
- cancel 后退出 running；
- user message 不重复；
- redacted reasoning 不泄露；
- queue 和 extension state delta；
- fatal error 后不继续发送普通事件。

测试必须使用 faux provider，不调用真实 provider API。

### 14.2 IPC 与恢复测试

必须覆盖：

- 只向订阅窗口发送事件；
- thread 切换后解除旧订阅；
- sequence 重复被丢弃；
- sequence 缺口触发 resync；
- reload 后 bootstrap 与后续 delta 正确衔接。
- idle Composer 文本与图片通过标准 user message 发起 run；
- running Composer 的 steer/follow-up 只进入 Desktop enqueue；
- assistant-ui 图片附件能够转换为 Pi IPC 图片输入。

### 14.3 性能回归测试

至少验证：

- 具有 1,000 条历史消息的 session 接收 1,000 个 text delta 时，不重复发送完整历史；
- 单个 text delta 的 IPC payload 大小不随历史消息数线性增长；
- `list()` 不调用运行中 runtime 的完整消息投影；
- 已缓存 session 的 open 不重新扫描全部 JSONL；
- 并发打开同一 session 只创建一个 runtime 和一个 Pi event subscription。

## 15. 验收标准

满足以下条件后视为重构完成：

1. 活动会话使用 `@assistant-ui/react-ag-ui`，旧自制 assistant-ui 消息适配已删除。
2. 普通流式事件不包含完整历史消息数组。
3. `MESSAGES_SNAPSHOT` 只在首次打开、resync 和 run settle 校正时使用。
4. renderer 能正确展示文本、reasoning、tool call、tool result、错误和取消状态。
5. prompt、steer、follow-up 和 queue 行为与 Pi 语义一致。
6. backend tool 不会在 renderer 重复执行。
7. 多窗口只接收各自订阅 session 的事件。
8. sequence 缺口能够自动请求 bootstrap 并恢复。
9. session list、open 和并发 runtime 创建通过性能回归测试。
10. `npm run check` 无 error、warning 或 info，所有新增定点测试通过。

## 16. 参考资料

- [AG-UI Overview](https://docs.ag-ui.com/introduction)
- [AG-UI Core architecture](https://docs.ag-ui.com/concepts/architecture)
- [AG-UI Events](https://docs.ag-ui.com/concepts/events)
- [AG-UI State Management](https://docs.ag-ui.com/concepts/state)
- [AG-UI TypeScript SDK](https://docs.ag-ui.com/sdk/js/core/overview)
- [AG-UI AbstractAgent](https://docs.ag-ui.com/sdk/js/client/abstract-agent)
- [assistant-ui AG-UI Runtime](https://www.assistant-ui.com/docs/runtimes/ag-ui)
