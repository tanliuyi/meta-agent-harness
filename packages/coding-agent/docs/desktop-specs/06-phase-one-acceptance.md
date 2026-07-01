# 06. 第一期验收规格

## 目标

第一期交付所有后端能力与 IPC，不包含 renderer 前端。验收以当前 worktree、命令输出、测试和可运行脚本为准。

## 必须产物

`packages/coding-agent`：

- worker protocol types
- worker entrypoint
- typed worker client
- transport abstraction
- Pi-compatible canonical event forwarding
- desktop projection event generation
- snapshot builder
- extension UI bridge
- approval bridge

`apps/desktop`：

- Electron main ThreadManager
- WorkerPool
- worker lifecycle handling
- IPC handlers
- preload typed API
- event subscription API
- app shutdown cleanup

状态层：

- thread registry
- session metadata index
- worker run diagnostics
- snapshot persistence/cache
- JSONL session compatibility

## 功能验收

Thread lifecycle：

- create thread
- stop thread
- restart/resume thread
- list threads
- get snapshot
- archive thread

Prompt lifecycle：

- prompt
- steer
- followUp
- abort
- streaming message events
- queue change events

Session lifecycle：

- new session
- switch session
- import session
- export session
- fork
- clone
- rename

Model lifecycle：

- list models
- set model
- cycle model
- set thinking level
- cycle thinking level

Tools：

- read
- bash
- edit
- write
- grep
- find
- ls
- custom tool registration point

Runtime controls：

- manual compaction
- auto compaction toggle
- auto retry toggle
- abort retry
- bash command and abort bash

Resources：

- context files
- skills
- prompt templates
- commands
- extensions
- custom models

Bridges：

- extension UI request/response
- approval request/response
- file change projection from tool results

Worker pool：

- max concurrency
- queued thread state
- worker lease
- idle release
- crash cleanup
- shutdown all

IPC：

- typed preload API
- structured errors
- event subscribe/unsubscribe
- no raw worker/process/credential exposure

## 兼容验收

- Pi session can be opened by desktop backend.
- Desktop canonical session can be read by Pi-compatible session parser.
- Canonical event semantics are preserved.
- Desktop projection events can be traced to canonical events or host lifecycle events.
- Settings/config/resource discovery keeps Pi semantics.
- Extension hooks fire at Pi-compatible points.

## 非目标验收

确认第一期没有交付：

- Vue renderer 页面。
- 聊天 timeline 视觉组件。
- diff viewer 视觉组件。
- 设置页、模型选择页、session browser 前端。
- 内置 IDE/code editor。

## 建议测试分层

Unit tests：

- protocol validation
- event projection
- snapshot builder
- storage index mapper

Integration tests：

- worker start/stop
- prompt accepted + streaming events
- abort
- session resume/fork/clone
- extension UI round trip
- worker crash cleanup
- worker pool concurrency queue

Electron main tests 或 smoke script：

- preload API shape
- IPC handler registration
- create thread through main
- shutdown cleanup

Compatibility tests：

- open Pi JSONL fixture
- export desktop JSONL and parse with existing SessionManager
- compare resource loading behavior for same cwd/agentDir

## 完成定义

第一期完成必须同时满足：

- 所有必须产物存在。
- 功能验收有测试、smoke script 或明确运行证据。
- 兼容验收有 fixture 或 parser 证据。
- renderer 前端未实现不影响 typed API 使用。
- worker pool 可观测、可关闭、崩溃可清理。
- 没有引入 desktop-only canonical session/event/config 分支。
