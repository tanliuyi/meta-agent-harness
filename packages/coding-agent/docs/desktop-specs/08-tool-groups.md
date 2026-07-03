# 08. Desktop Tool Groups PRD / Spec

## 背景

Desktop 当前按工具调用逐行展示。连续的只读探索工具和文件写入工具会产生大量相邻条目，用户需要逐个扫过才能理解 agent 刚刚完成了什么。

Pi canonical session 仍然以 assistant `toolCall` 和 `toolResult` 为事实来源。Desktop Tool Groups 只是在 renderer timeline 上做 projection/UI 聚合，不能改变 session JSONL、tool input/output、tool result、file change projection 或 Pi export HTML 语义。

## 目标

- 将同类且连续的工具调用聚合为一行摘要。
- 用户点击摘要后展开具体工具列表。
- 用户再次点击具体工具后展开原有 tool result、diff 或输出。
- 分类规则对齐 Pi builtin tool 语义，避免 Desktop 与 Pi 对工具能力的理解分叉。
- 保持 streaming 期间的实时更新、滚动贴底和输入响应体验。

## 非目标

- 不改变 Pi canonical message/session/event 格式。
- 不改变 `packages/coding-agent` tool implementation。
- 不改变 HTML export 的逐工具渲染行为。
- 不引入虚拟列表。
- 不把 `bash` 自动归入探索或修改分组。
- 不从 `write` 推断创建或覆盖；`write` 在 UI 中统一称为“写入”。

## 用户体验

### Mutation Tool Group

连续的 `edit` / `write` 工具调用合并为 `MutationToolGroup.vue`。

摘要示例：

- `编辑 3 文件`
- `写入 2 文件`
- `编辑 3 文件，写入 2 文件`

交互：

- 默认收起。
- 点击 group header 展开具体工具列表。
- 组内每个工具继续使用现有 `ToolMessage.vue` 渲染。
- 点击组内具体工具时，继续展开原有 tool result，例如 edit diff 或 write result。

### Explore Tool Group

连续的 `read` / `grep` / `find` / `ls` 工具调用合并为 `ExploreToolGroup.vue`。

摘要示例：

- `查看 4 文件`
- `搜索 3 次`
- `探索 7 项`
- `查看 4 文件，搜索 3 次`

交互与 Mutation Tool Group 一致。

## Pi 语义对齐

Pi builtin tool 集合来自 `packages/coding-agent/src/core/tools/index.ts`：

- coding tools: `read`, `bash`, `edit`, `write`
- readonly tools: `read`, `grep`, `find`, `ls`
- all builtin tools: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`

Desktop group 分类：

```ts
const MUTATION_TOOL_NAMES = new Set(['edit', 'write'])
const EXPLORE_TOOL_NAMES = new Set(['read', 'grep', 'find', 'ls'])
```

`bash` 不参与第一版分组，因为仅凭 tool name 不能判断命令是否只读或会修改文件。

`write` 的 Pi 描述是 create or overwrite，因此 Desktop 摘要使用“写入”，不使用“创建”。

## 数据模型

在 renderer timeline 层新增 projection item：

```ts
type ToolGroupKind = 'mutation' | 'explore'

type ToolGroupTimelineItem = {
  type: 'tool-group'
  key: string
  groupKind: ToolGroupKind
  toolCalls: DesktopToolCall[]
}
```

该 item 只存在于 `ChatView.vue` 的渲染计算结果中，不进入 snapshot、IPC、worker protocol 或 session JSONL。

## 分组规则

分组输入是 Desktop 当前 timeline item 列表，而不是全局 `toolCalls` 列表。

规则：

- 只合并 timeline 中相邻且连续的 tool item。
- 相邻 tool 必须拥有相同 `ToolGroupKind`。
- 中间出现 assistant text、thinking、user message、system message、collapsed history 或其他非同类工具时立即断组。
- 单个可分组工具不包 group，继续按现有单工具行展示。
- `message` item 如果携带 `toolCall` 且 role 是 `tool`，在分组前应被视为工具展示项。
- 已被 assistant `toolCall` block 消费的 tool result 仍沿用现有去重逻辑，不能重复展示。

示例：

```text
read, grep, edit, write, ls
=> ExploreGroup(read, grep), MutationGroup(edit, write), ls

read, bash, grep
=> read, bash, grep

edit
=> edit
```

## 组件设计

新增组件：

- `BaseToolGroup.vue`
- `MutationToolGroup.vue`
- `ExploreToolGroup.vue`

`BaseToolGroup.vue` 负责：

- group header 折叠交互。
- summary、status、error tone 聚合展示。
- 展开区域布局。

`MutationToolGroup.vue` 负责：

- 接收 `toolCalls: DesktopToolCall[]`。
- 统计唯一文件路径。
- 生成 `编辑 x 文件，写入 x 文件` 摘要。
- 展开后循环渲染 `ToolMessage.vue`。

`ExploreToolGroup.vue` 负责：

- 接收 `toolCalls: DesktopToolCall[]`。
- 统计 read 文件数量、grep/find 搜索次数、ls 列目录次数。
- 生成探索摘要。
- 展开后循环渲染 `ToolMessage.vue`。

## 状态聚合

Group status 从组内工具派生：

- 任一工具 `failed` => group error tone。
- 任一工具 `running` => group status `running`。
- 任一工具 `queued` => group status `queued`。
- 全部 `succeeded` => group status `succeeded`。
- 任一工具 `cancelled` 且无 running/queued/failed => group status `cancelled`。

Group 不吞掉具体工具状态。展开后每个工具仍显示自身状态与结果。

## 路径与摘要

文件路径读取规则：

```ts
args.path ?? args.file_path
```

统计规则：

- 文件数量按唯一非空路径统计。
- 没有路径时仍按工具调用计数兜底。
- 摘要中不展示完整路径列表，避免 header 过长。

## 性能要求

- 分组函数应为纯函数，线性扫描 timeline。
- 不解析大型 tool result 来计算摘要。
- 不在 streaming update 中做深拷贝大型结果。
- `v-memo` revision 需要包含组内 tool 的轻量依赖：`toolCallId`、`status`、`args`、`partialResult`、`result`。

## 验收

功能验收：

- 连续 `edit/write` 展示为 Mutation group。
- 连续 `read/grep/find/ls` 展示为 Explore group。
- 不同 group kind 相邻时分开。
- 非 tool item 或 `bash` 会打断分组。
- 单个工具不分组。
- 展开 group 后能看到具体工具列表。
- 点击具体工具能继续展开原 tool result。
- `write` 摘要显示“写入”，不显示“创建”。

兼容验收：

- session JSONL 不变化。
- desktop snapshot/toolCalls 不变化。
- Pi export HTML 不变化。
- `fileChanges` projection 不因 Tool Groups 改变。

测试建议：

- 为纯分组函数添加 unit tests。
- 覆盖连续、断组、单工具不分组、status 聚合、路径去重。
- 运行 desktop renderer typecheck。
