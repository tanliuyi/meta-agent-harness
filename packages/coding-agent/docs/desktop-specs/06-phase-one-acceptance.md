# 06. 第一期验收规格

## 目标

第一期交付所有后端能力、IPC、renderer 数据层联调和简单 UI。验收以当前 worktree、命令输出、测试和可运行脚本为准。

## 必须产物

`packages/coding-agent`：

- worker protocol types
- Electron utility worker entrypoint
- utility process worker server
- Pi-compatible canonical event forwarding
- desktop projection event generation
- snapshot builder
- extension UI bridge
- approval bridge

`apps/desktop`：

- Electron main ProjectStore
- Electron main ThreadManager
- ThreadWorkerRegistry
- utility process worker client/transport
- worker lifecycle handling
- IPC handlers
- preload typed API
- event subscription API
- renderer Pinia store
- renderer simple thread/chat/session UI
- app shutdown cleanup

状态层：

- project registry
- thread registry
- session metadata
- worker run diagnostics
- snapshot from worker live state or JSONL session
- JSONL session compatibility

## 功能验收

Thread lifecycle：

- create/open/list/archive project
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

Thread worker registry：

- worker starts through Electron `utilityProcess.fork()`
- commands and events use `postMessage` / `process.parentPort`
- parallel threads create independent utility workers immediately
- no `maxWorkers` option or global worker queue
- worker lease
- idle release
- crash cleanup
- shutdown all

IPC：

- typed preload API
- structured errors
- event subscribe/unsubscribe
- no raw worker/process/credential exposure

Renderer：

- create/open project
- create thread from active project
- switch active thread
- show active snapshot messages and basic runtime state
- send prompt through real preload API
- abort active run
- collect projection/canonical events
- show and respond to pending approvals

## 兼容验收

- Pi session can be opened by desktop backend.
- Desktop canonical session can be read by Pi-compatible session parser.
- Canonical event semantics are preserved.
- Desktop projection events can be traced to canonical events or host lifecycle events.
- Settings/config/resource discovery keeps Pi semantics.
- Extension hooks fire at Pi-compatible points.

## 非目标验收

确认第一期没有交付：

- 产品化聊天 timeline 视觉组件。
- 产品化 diff viewer 视觉组件。
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
- parallel thread worker creation

Electron main tests 或 smoke script：

- preload API shape
- IPC handler registration
- create thread through main
- shutdown cleanup
- renderer build and typecheck

Compatibility tests：

- open Pi JSONL fixture
- export desktop JSONL and parse with existing SessionManager
- compare resource loading behavior for same cwd/agentDir

## 完成定义

第一期完成必须同时满足：

- 所有必须产物存在。
- 功能验收有测试、smoke script 或明确运行证据。
- 兼容验收有 fixture 或 parser 证据。
- renderer 数据层通过 typed preload API 联调，不直接访问 worker/process/credential。
- thread worker registry 可观测、可关闭、崩溃可清理，并且不设置 agent 并行上限。
- 没有引入 desktop-only canonical session/event/config 分支。
- 没有保留 renderer `createThread({ cwd })` 入口。
