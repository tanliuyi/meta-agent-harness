# 01. Pi 同构兼容 Spec

## 目标

Desktop 后端必须完整兼容 Pi 的核心能力和数据模型。Desktop 可以增加 thread worker registry、transport、IPC、数据库索引和 UI projection，但不能创建与 Pi 不兼容的 session/event/config/resource/extension/tool 分支。

## Canonical 与 Projection

Canonical 层是事实层：

- session JSONL
- AgentSession / AgentSessionRuntime 行为
- tool input/output 核心语义
- settings/config merge 行为
- resource discovery 行为
- extension API 与 hooks
- model/auth/thinking/compaction/retry 行为

Projection 层是 desktop adapter：

- thread snapshot
- timeline item
- file change summary
- tool card metadata
- worker lifecycle state
- desktop IPC event
- database index/cache

Projection 必须能追溯到 canonical 数据或 canonical event。Projection 不得改变 canonical 语义。

## Session 兼容

必须保持：

- JSONL session entry 类型兼容。
- `parentId`、branch、current leaf 语义兼容。
- resume、switch、fork、clone、import、export 行为兼容。
- compaction entry、branch summary entry 语义兼容。
- model/thinking/session info entries 语义兼容。

Desktop metadata 规则：

- desktop metadata 不得破坏 Pi 读取 session。
- 如需新增 metadata，优先存在数据库索引表。
- 如必须进入 JSONL，应放在 Pi 可忽略的 custom/metadata entry 中，并有版本字段。

## Event 兼容

必须保留 Pi canonical event：

- agent lifecycle
- turn lifecycle
- message start/update/end
- tool execution start/update/end
- queue update
- compaction start/end
- retry start/end
- extension error
- session info/model/thinking changes

Desktop projection event 可以增加：

- `thread.stateChanged`
- `file.changed`
- `approval.requested`
- `worker.crashed`
- `snapshot.updated`

但 projection event 不能替代 canonical event。Electron main 可以同时转发 canonical event 和 projection event。

## Config / Settings 兼容

必须保持：

- settings 字段语义。
- global/project merge 语义。
- runtime override 语义。
- settings persistence 和 `flush`/error drain 边界。
- provider retry、transport、thinking budget、block images 等设置行为。

Desktop 可以通过 host options 指定：

- `agentDir`
- `cwd`
- session root
- credential backend
- additional resource roots

路径可配置，语义不分叉。

## Resource 兼容

必须保持：

- AGENTS/context files 加载语义。
- skills 加载、排序、冲突处理、格式化进 prompt 的语义。
- prompt templates / slash commands 语义。
- extensions 加载和 hooks 语义。
- custom models 加载语义。

Desktop command palette 是资源呈现层，不是新的资源系统。

## Extension 兼容

必须保持：

- extension event hooks。
- custom tools。
- custom commands。
- context transform。
- before provider request / after provider response hooks。
- extension UI request 语义。

Desktop 负责把 extension UI request 映射到 IPC：

- select
- confirm
- input
- editor
- notify
- status/widget/title
- set editor text

不得拆出 Pi extension API 和 Desktop extension API 两套不兼容接口。

## Tool 兼容

必须保持工具本体语义：

- `read`
- `bash`
- `edit`
- `write`
- `grep`
- `find`
- `ls`
- custom tools

Desktop 可以从 tool result 派生：

- file change
- diff metadata
- command timeline
- truncation badge
- risk metadata

派生数据不替代 tool result。

## 验收

- Pi 生成的 session 可以被 desktop 后端打开并恢复。
- Desktop 生成的 canonical session 可以被 Pi 读取，除非显式使用了兼容文档中标记的 desktop-only metadata。
- 同一 workspace 下 resource discovery 不因 desktop 启动方式而改变核心语义。
- Extension hook 在 desktop worker 中与 Pi 中触发时机一致。
- Desktop projection event 均能关联到 canonical event 或明确的 host lifecycle event。
