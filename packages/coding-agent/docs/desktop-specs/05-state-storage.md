# 05. 状态存储 Spec

## 目标

定义 Desktop 后端状态层。Desktop 不引入 SQLite 或其他本地数据库；live、
持久化和恢复必须与 Pi 的 `AgentSession` / `SessionManager` 架构保持一致。

## Canonical Persistence

Pi-compatible JSONL session 是唯一 canonical persistence。

必须保持：

- session entry 兼容。
- branching 兼容。
- import/export 兼容。
- compaction/fork/clone 兼容。
- `message_end` 后才写入 finalized message。

不得把 `message_update`、streaming token、tool output chunk 持久化为 canonical
message。它们只属于 live event stream。

## 状态来源

Desktop 状态分三类：

- live state：worker 内的 `AgentSession.agent.state.messages` 和 runtime 状态。
- canonical storage：Pi-compatible JSONL session。
- desktop metadata：thread/project 列表、归档、展示名称等轻量宿主信息。

desktop metadata 可以用 JSON 文件或从 sessions 目录派生。它不保存 messages、
provider payload、tool result 正文或 streaming delta，也不参与 agent context 恢复。

## Live 路径

实时路径：

```text
Worker AgentSession
  |
  | canonical/projection transport event
  v
Electron main
  |
  | preload IPC event
  v
Renderer
```

要求：

- 实时事件和命令必须走 transport。
- Electron main 是 renderer-facing session messages 的唯一业务状态源；内存投影丢失时从 worker state 或 Pi JSONL 重建。
- Renderer 只保存当前页面 session 的一份可丢弃 messages 投影，通过 main message snapshot + streaming events 更新 UI；不得将其挂回 `ThreadSnapshot.messages`。
- Thread/session 列表只保存摘要；非 active thread 不缓存 message snapshot 或 message render state。
- `ThreadSnapshot` IPC 继续承载 tree、changes、approval、queue 等非 chat 状态，其 renderer-facing `messages` 始终为空。自动或 overflow compaction 完成后，main 失效 message 投影并从 worker/JSONL 重建。
- 任何实时 UI 状态丢失后，都应能从 worker snapshot 或 JSONL session 重建。

## 持久化路径

持久化路径：

```text
AgentSession message_end/session operation
  |
  | SessionManager.append*
  v
Pi-compatible JSONL session
```

要求：

- 普通 user/assistant/toolResult/custom message 使用 Pi 相同写入时机。
- bash、compaction、branch summary、model/thinking/session info 使用 Pi 已有 entry 类型。
- JSONL 写入失败是 session 级错误，必须进入 thread/runtime error。
- metadata 写入失败不得破坏 canonical session；最多影响 thread list 的宿主展示。

## Snapshot 恢复

恢复优先级：

1. 如果 worker running，向 worker 请求 snapshot；messages 来自 live `agent.state.messages`。
2. 如果没有 worker，直接使用 Pi `SessionManager.open()` / `buildSessionContext()` 从 JSONL
   session 离线重建最小 snapshot；conversation 不从 metadata 或 projection cache 读取。
3. 当用户继续执行命令需要 live runtime 时，再启动 worker 并打开同一个 JSONL session。
4. worker 启动前需要解析 cwd 时，复用与 `SessionManager.open()` 同源的 JSONL header 解析；
   `cwdOverride` 优先，其次 session header cwd，最后才是宿主 fallback。
5. 从 live runtime state 或离线 JSONL 重建结果派生 desktop snapshot。

不得从独立数据库、event log 或 message index 恢复 conversation。Main message repository 只保留当前进程的标准 AG-UI `Message[]` 投影和首次读取期间的短暂事件缓冲，不保存 revision 或事件 journal。

## Storage Paths

Desktop 默认使用 Pi 的 agentDir、sessionDir、settings/auth/models/resource 位置和
文件格式。路径可以显式配置，但 Pi settings/resource/session/auth/model 语义不能分叉。

建议：

```text
Pi agentDir/
  settings.json
  auth.json
  models.json
  coding-agent/
    sessions/

Electron userData/
  coding-agent/
    metadata/
    logs/
```

Project 本地配置：

- `.pi` 是 Pi-compatible project resource source。
- Pi session import/export 应显式支持。
- 默认路径、文件名、merge 顺序和 trust 边界不能改变 Pi config 字段语义。
- Desktop metadata 不得保存 canonical settings、auth、models、resources 或 session messages。

## 验收

- 不启动 renderer UI，也可以通过 main/test 创建 thread 并得到 JSONL session。
- worker streaming 不依赖任何数据库。
- `message_update` 不产生 durable message。
- `message_end` 后 JSONL session 只写入 finalized message。
- 删除 metadata 后，可以从 sessions 目录和 JSONL session 重建 thread 列表和最小 snapshot。
- JSONL session 可以被 Pi-compatible session parser 读取。
- 同一 agentDir/cwd/sessionFile 下，Pi 和 Desktop 解析出的 settings、auth、models、
  resources 与 session context 一致。
- metadata 中不保存明文 credential。
