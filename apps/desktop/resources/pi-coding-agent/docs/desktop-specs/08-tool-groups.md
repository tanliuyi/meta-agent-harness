# 08. Desktop Tool Groups PRD / Spec

## 背景

Desktop 当前按工具调用逐行展示。连续的只读探索工具和文件写入工具会产生大量相邻条目，用户需要逐个扫过才能理解 agent 刚刚完成了什么。

Pi canonical session 仍然以 assistant `toolCall` 和 `toolResult` 为事实来源。Desktop Tool Groups 只是在 renderer timeline 上做 projection/UI 聚合，不能改变 session JSONL、tool input/output、tool result、file change projection 或 Pi export HTML 语义。

## 目标

- 将连续无可见输出的 assistant tool segments 聚合为一行摘要。
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

### Tool Group

连续无可见输出的 assistant tool segments 合并为 `ToolGroup.vue`。

摘要示例：

- `读取 4 文件`
- `搜索 3 次`
- `编辑 3 文件，写入 2 文件`
- `读取 4 文件，编辑 3 文件，运行 1 命令`
- `执行 2 个工具`

交互：

- 默认收起。
- 点击 group header 展开具体工具列表。
- 组内每个工具继续使用现有 `ToolMessage.vue` 渲染。
- 点击组内具体工具时，继续展开原有 tool result，例如 bash output、edit diff 或 write result。

## Pi 语义对齐

Pi builtin tool 集合来自 `packages/coding-agent/src/core/tools/index.ts`：

- coding tools: `read`, `bash`, `edit`, `write`
- readonly tools: `read`, `grep`, `find`, `ls`
- all builtin tools: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`

Desktop 摘要按已知 builtin tool 语义统计：

- `read`：读取文件数量，按路径去重。
- `grep` / `find`：搜索次数。
- `ls`：列目录次数。
- `edit`：编辑文件数量，按路径去重。
- `write`：写入文件数量，按路径去重。
- `bash`：运行命令次数。
- 其他未知或扩展工具：执行工具数量。

`write` 的 Pi 描述是 create or overwrite，因此 Desktop 摘要使用“写入”，不使用“创建”。

## 数据模型

在 renderer timeline 层新增 projection item：

```ts
type ToolGroupTimelineItem = {
  type: 'tool-group'
  key: string
  toolCallIds: string[]
  toolCalls: DesktopToolCall[]
  summary: string
}
```

该 item 只存在于 `ChatView.vue` 的渲染计算结果中，不进入 snapshot、IPC、worker protocol 或 session JSONL。

## 分组规则

分组输入是 Desktop 当前 timeline item 列表，而不是全局 `toolCalls` 列表。

规则：

- assistant message 中连续无可见输出的 tool segments 作为一个 group 渲染，即使只有一个工具也包在 group 中。
- group key 基于首个 tool call，保证流式追加 tool call 时 Vue 复用同一 group subtree。
- 组内具体工具使用 `toolCallId` 作为 key，保证每个工具子组件稳定更新。
- 未绑定到 assistant message 的投影工具项仍可按 timeline 相邻连续工具兜底分组。
- `message` item 如果携带 `toolCall` 且 role 是 `tool`，在兜底分组前应被视为工具展示项。
- 已被 assistant `toolCall` block 消费的 tool result 仍沿用现有去重逻辑，不能重复展示。

示例：

```text
assistant(toolCalls: read, grep), assistant(toolCalls: edit, write, bash)
=> ToolGroup(read, grep, edit, write, bash)

orphan timeline tools: read, grep
=> ToolGroup(read, grep)
```

## 组件设计

新增组件：

- `BaseToolGroup.vue`
- `ToolGroup.vue`

`BaseToolGroup.vue` 负责：

- group header 折叠交互。
- summary、status、error tone 聚合展示。
- 展开区域布局。

`ToolGroup.vue` 负责：

- 接收 `toolCalls: DesktopToolCall[]`。
- 展开后循环渲染 `ToolMessage.vue`。
- 使用 `toolCallId` 作为组内工具 key，保持 Vue 子组件稳定。

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
