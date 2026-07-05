# Desktop Session Tree / Fork / Leaf Navigation PRD

## 背景

Meta Agent Desktop 现在有两层会话概念：

```text
Desktop thread
  -> Pi-compatible session.jsonl
    -> session tree entry / leaf
```

Desktop sidebar 展示的是 `ThreadSummary`，用户看到的是“对话项”。每个 thread 通过
`sessionFile` 指向一个 Pi-compatible `session.jsonl`。`session.jsonl` 内部通过
`id / parentId` 表达一棵可分叉的 session tree，当前继续位置由 leaf 决定。

当前产品里存在两类容易混淆的操作：

- `从这里继续`：在同一个 `session.jsonl` 内切换当前 leaf。
- `创建分支对话`：从某个 entry fork 出一个新的 `session.jsonl`，并在 desktop sidebar
  中新增一个 thread/对话项。

如果 UI 不能明确表达 thread、session file、leaf 三者的层级关系，用户会误以为
“从这里继续”丢失了原来的位置，或误以为“创建分支对话”只是同一对话内的 leaf 切换。

## 产品目标

- 明确区分“同一 session 内继续”和“创建新的分支对话”。
- 在 sidebar 中表达 fork lineage：某个对话由哪个父对话 fork 而来。
- 在不改变 Pi SDK / JSONL entry 格式的前提下，利用 `session.jsonl` header 中的
  `parentSession` 展示来源关系并支持跳转。
- 为同一 session 内的 leaf navigation 提供可发现、可回退的 UI。
- 保持 desktop thread registry 是 UI 和 runtime 承载层，Pi session JSONL 仍是对话历史、
  tree 和上下文的 canonical persistence。

## 非目标

- 不新增 `session_fork`、`leaf_change` 等 JSONL entry 类型。
- 不改变 Pi SDK 对 session 格式、fork、tree navigation 的语义。
- 不把 leaf 写入 `threads.json` 作为一等会话实体。
- 不把 sidebar 改成无限完整 session tree 浏览器。
- 不在第一阶段实现跨 project 的复杂 session lineage 合并。
- 不在第一阶段实现完整浏览器式前进/后退多栈持久化；可以先做当前运行期的轻量历史。

## 核心概念

### Thread

Desktop 一等对话项，存在于 `threads.json` / thread registry 中。

```ts
interface ThreadSummary {
  threadId: string
  projectId: string
  sessionFile?: string
  title?: string
  status: ThreadStatus
  archivedAt?: string
  createdAt: string
  updatedAt: string
}
```

Thread 负责：

- sidebar 展示和选择。
- project 归属。
- worker lease / runtime 状态。
- 标题、归档、恢复。
- 绑定当前 `sessionFile`。

### Session File

Pi-compatible JSONL 文件，是 agent 对话历史、session tree 和上下文的真相源。

第一行 header 示例：

```json
{
  "type": "session",
  "version": 1,
  "id": "019...",
  "timestamp": "2026-07-05T...",
  "cwd": "/path/to/project",
  "parentSession": "/path/to/parent/session.jsonl"
}
```

`parentSession` 只表达 session file lineage，不是 desktop thread 外键。

### Leaf

同一 `session.jsonl` 内当前继续的位置。leaf 可以是任意 entry，后续 append 的 entry 会成为
该 leaf 的子节点。底层 session tree 可以无限层级增长。

Leaf 不应成为 sidebar 的一级对话项。它可以作为某个 thread 下的快捷入口或状态展示。

## 用户故事

### US-1：创建分支对话后看见新对话项

作为用户，我在某条消息上点击 `创建分支对话` 后，希望 sidebar 里新增一个对话项，并自动切到
这个新对话。原对话仍保留在 sidebar 中，我可以直接点回去。

验收：

- 原 thread 的 `sessionFile` 不变。
- 新 thread 的 `sessionFile` 指向新 fork 出来的 JSONL。
- 新 session header 的 `parentSession` 指向原 session 文件。
- sidebar 中出现新 thread。
- 新 thread 默认选中。

### US-2：识别某个对话从哪里 fork 来

作为用户，我希望在 sidebar 或详情面板中看到当前对话是否由另一个对话 fork 而来，以及来源对话的标题。

验收：

- 如果当前 session header 有 `parentSession`，UI 显示 `Forked from <父对话标题或文件名>`。
- 如果父 session 已存在对应 thread，显示父 thread 标题。
- 如果父 session 没有对应 thread，但文件仍存在，显示文件名或路径摘要。
- 如果父文件不存在，显示不可跳转状态。

### US-3：跳转到 fork 来源对话

作为用户，我希望点击 `打开来源对话` 后回到 fork 来源。

验收：

- 如果 `parentSession` 匹配现有 thread 的 `sessionFile`，直接选中该 thread。
- 如果没有匹配 thread，但文件存在，desktop 调用 `createThread({ projectId, sessionFile: parentSession })`
  恢复为一个 sidebar 对话项，并选中。
- 如果文件不存在，显示错误并允许复制路径或 reveal 失败原因。

### US-4：从这里继续后能回到移动前的 leaf

作为用户，我点击 `从这里继续` 后，希望可以一键回到移动前的位置。

验收：

- 执行 `navigateTree(entryId)` 前记录当前 `currentEntryId`。
- 成功移动后显示 `返回之前位置`。
- 点击后调用 `navigateTree(previousEntryId)`。
- 该历史是 desktop UI 状态，不写入 JSONL。

### US-5：在 sidebar 中保留轻量 leaf 快捷入口

作为用户，我希望 sidebar 能保留少量我主动标记过的 leaf 快捷入口，但不希望看到 entry ID
或每个 thread 的当前 leaf 内部状态。

验收：

- thread item 不常驻显示 current leaf 或 entry ID。
- 可展开 active thread item 查看少量 labeled leaf 快捷入口。
- 完整 tree 仍在 Session Panel 中浏览。

## 信息架构

推荐保持 sidebar 的主层级为：

```text
Project
  Thread / 对话项
    Leaf shortcuts / 当前 session 内快捷入口
```

不推荐把完整 session tree 直接铺到 sidebar。完整树在右侧 Session Panel 中展示和搜索。

第一阶段 sidebar 可以采用轻量展示：

```text
Project A
  实现 Tree 功能

  实现 Tree 功能 · 分支  Fork
    Forked from 实现 Tree 功能
```

第二阶段可以支持 thread item 展开后的 leaf shortcuts：

```text
实现 Tree 功能
  Labeled
    重构前
    方案 A
```

## 交互设计

### 消息操作

用户消息：

- `从这里编辑`：同 session 内 tree navigation，把用户消息文本回填到 composer。
- `在 Tree 中定位`：打开 Session Panel 的 Tree 并定位 entry。
- `创建分支对话`：fork 新 session file，并新增 sidebar thread。

Assistant 最终回复：

- `从这里继续`：同 session 内 tree navigation 到该 assistant entry。
- `在 Tree 中定位`：打开 Session Panel 的 Tree 并定位 entry。
- `创建分支对话`：fork 新 session file，并新增 sidebar thread。

### 文案规范

避免混用“分支”指代 leaf 和 session file。

推荐文案：

```text
从这里继续
从这里编辑
创建分支对话
打开来源对话
返回之前位置
Forked from
```

不推荐：

```text
Fork
从这里分支
切换分支
回到原 session
```

### Fork 来源展示

显示位置优先级：

1. Sidebar thread item 次级信息。
2. Session Panel 的 Session tab。
3. Chat 顶部轻量状态条，可选。

示例：

```text
Forked from 实现 Tree 功能
```

如果父 thread 不在 registry 中：

```text
Forked from 2026-07-05_019....jsonl
```

如果父文件丢失：

```text
Fork source missing
```

### 跳转到来源对话

入口：

- sidebar item hover action 或右键菜单：`打开来源对话`
- Session Panel：`打开来源对话`

行为：

```text
click open parent
  -> find thread by sessionFile === parentSession
    -> found: setActiveSessionId(parentThreadId)
    -> not found:
      -> file exists: createThread({ projectId, sessionFile: parentSession })
      -> file missing: show error / copy path
```

### Leaf 快捷入口

第一阶段只做轻量状态，不做完整 leaf tree：

- 不常驻展示 current leaf 或 entry ID。
- `返回之前位置` 临时按钮。
- Session Panel Tree 仍是完整入口。

第二阶段做 sidebar leaf shortcuts：

- 有 label 的 leaf：从 session tree label 派生。
- 用户 pin 的 leaf：desktop-only UI preference，可存在 renderer local storage 或 desktop metadata。

## 数据模型

### Desktop-only 派生字段

建议扩展 shared desktop 类型，但不写入 Pi JSONL：

```ts
interface ThreadLineage {
  parentSessionFile?: string
  parentThreadId?: string
  parentThreadTitle?: string
  parentSessionMissing?: boolean
}

type ThreadSummary = ExistingThreadSummary & {
  lineage?: ThreadLineage
}

type ThreadSnapshot = ExistingThreadSnapshot & {
  lineage?: ThreadLineage
}
```

`parentSessionFile` 的真相源永远来自 session JSONL header `parentSession`。

### 不建议双写

不要在 `threads.json` 里维护独立的 `parentThreadId` 作为真相。因为：

- `parentSession` 可能来自 Pi CLI 或其它工具生成。
- parent thread 可能尚未被 desktop registry 收录。
- 同一个 session file 可以被多个 desktop thread 引用。

可以在 `threads.json` 中缓存 UI 展示字段，但每次 list/snapshot 应能从 JSONL header 重新派生。

## Main 进程设计

### Header 读取

新增 helper：

```ts
function readSessionHeader(sessionFile: string): SessionHeader | undefined
```

要求：

- 只读取第一条有效 JSONL entry。
- 文件不存在、格式不合法时返回 undefined，并记录 recoverable diagnostic。
- 不触发 session migration。
- 不启动 worker。

### Lineage 派生

新增 helper：

```ts
function buildThreadLineage(thread: ThreadSummary, allThreads: ThreadSummary[]): ThreadLineage | undefined
```

逻辑：

1. 如果 `thread.sessionFile` 为空，返回 undefined。
2. 读取 header.parentSession。
3. canonicalize path 后匹配 `allThreads.sessionFile`。
4. 匹配成功则填充 `parentThreadId / parentThreadTitle`。
5. 匹配失败但文件存在，填充 `parentSessionFile`。
6. 文件不存在，填充 `parentSessionMissing: true`。

### API 设计

第一阶段可以不新增 IPC，直接把 lineage 放入 `ThreadSummary` / `ThreadSnapshot`：

```ts
listThreads(): Promise<ThreadSummary[]>
getSnapshot(threadId): Promise<ThreadSnapshot>
```

打开来源对话可新增：

```ts
openParentThread(input: {
  threadId: string
}): Promise<ThreadSnapshot>
```

也可以先在 renderer 根据 `lineage.parentThreadId` 直接跳转；当没有 parent thread 时再调用：

```ts
createThread({
  projectId,
  sessionFile: lineage.parentSessionFile
})
```

推荐第二种，复用现有 `createThread`。

## Renderer Store 设计

### 来源跳转

新增 action：

```ts
async function openParentSession(threadId = activeSessionId.value): Promise<void>
```

逻辑：

```text
thread = sessions[threadId]
lineage = thread.snapshot?.lineage ?? thread.lineage

if lineage.parentThreadId:
  setActiveSessionId(lineage.parentThreadId)
else if lineage.parentSessionFile:
  createThread(thread.projectId, { sessionFile: lineage.parentSessionFile })
else:
  show error
```

如果现有 `createThread` store action 只接收 `projectId`，需要扩展为支持：

```ts
createThread(projectId, contextId, options?: { sessionFile?: string; title?: string })
```

### Leaf navigation history

在 runtime state 中增加 desktop-only 状态：

```ts
interface WorkspaceSessionRuntime {
  previousLeafEntryId?: string
  nextLeafEntryId?: string
}
```

`navigateActiveSessionTree(entryId)` 成功前后：

```text
previous = activeSnapshot.currentEntryId
result = navigateTree(entryId)
if previous && previous !== entryId:
  runtime.previousLeafEntryId = previous
```

新增：

```ts
async function navigateBackToPreviousLeaf(): Promise<void>
```

第一阶段只做单步返回；后续可扩展为栈。

## Sidebar UI 设计

### Thread Item

每个 thread item 增加两类辅助信息：

```text
title
status / updatedAt
lineage
```

展示规则：

- 如果 `lineage.parentThreadTitle` 存在：显示 `Forked from <title>`。
- 如果只有 `parentSessionFile`：显示 `Forked from <basename>`.
- 如果 `parentSessionMissing`：显示 `Fork source missing`.
- 如果没有 lineage：不显示 fork 来源行。

### 操作入口

Thread item 右键菜单增加：

- `打开来源对话`：仅 forked thread 可用。
- `在 Tree 中定位当前 leaf`：有 currentEntryId 时可用。

如果未来加入展开区：

- `Labeled`

### 视觉层级

第一阶段不改变 sidebar 主排序，仍按 updatedAt / 当前既有逻辑排序。Fork 来源只作为辅助信息。

第二阶段可以评估 threaded sort：

```text
Parent thread
  Fork child thread
```

但 threaded sort 会影响用户对“最近对话”的预期，需单独开关或模式。

## Session Panel UI 设计

Session tab 增加 `Lineage` 区域：

```text
Forked from
实现 Tree 功能
[打开来源对话]
```

Tree tab 保持完整 tree 浏览能力，并补充：

- 当前 leaf 标记。
- 选中节点操作：
  - `从这里继续`
  - `创建分支对话`
  - `复制 ID`

当 `previousLeafEntryId` 存在时，Session tab 或 chat 状态区显示：

```text
已移动到选中节点
[返回之前位置]
```

## 技术约束

- 不修改 Pi SDK JSONL 格式。
- 不新增 Pi session entry 类型。
- 不把 leaf 当作 desktop thread。
- `parentSession` path 需要 canonicalize 后比较，避免相对路径、符号链接或大小写差异导致匹配失败。
- 读取 session header 必须轻量，不应为了 list sidebar 启动 worker。
- 对不存在的 parent file 只做 recoverable UI 状态，不阻塞当前 thread。
- 归档 thread 也可以作为 parent 命中；跳转时应恢复还是打开 archive view 需产品确认。第一阶段建议命中归档 thread 时提示 `来源对话已归档` 并提供 `恢复并打开`。

## 兼容性

### 与 Pi SDK 的兼容

本设计只读取现有 header 字段：

```json
{"type":"session","parentSession":"..."}
```

不新增 entry，不改变 `fork()` 和 `navigateTree()` 的底层语义。

### 与 Pi CLI / RPC 的兼容

Pi CLI 生成的 fork session 如果带 `parentSession`，desktop 可展示 lineage。
Desktop 生成的 fork session 仍可被 Pi CLI / SDK 正常读取。

### 与当前 desktop thread registry 的兼容

如果历史 thread 没有 lineage 字段，不影响列表展示。
如果历史 fork session 有 `parentSession`，升级后可自动派生显示。

## 边界场景

### parentSession 文件不存在

显示：

```text
Fork source missing
```

操作：

- `复制来源路径`
- 可选 `在 Finder 中显示`，但文件不存在时应展示错误。

### parentSession 指向当前 session

视为异常 lineage，避免跳转死循环。显示：

```text
Fork source unavailable
```

并记录 diagnostic。

### 多个 thread 指向同一个 parentSession

选择最近 updatedAt 的 thread 作为默认跳转目标，或者显示选择菜单。
第一阶段可直接选择第一个匹配项，并在后续优化。

### parent thread 已归档

显示：

```text
Forked from <title> (archived)
```

点击时提示恢复并打开。

### 跨 project fork

如果 parent session header cwd 与当前 project 不同：

- 第一阶段仍在当前 project 下创建/打开 parent thread，除非该 cwd 已对应另一个 Project。
- 后续可通过 cwd 匹配 ProjectStore，把 parent thread 放回源 project。

### 深层 leaf

Sidebar 不展示无限层级。深层 leaf 只通过摘要和 `Session Panel -> Tree` 完整访问。

## 分期计划

### Phase 1：Fork lineage 展示和跳转

范围：

- main 层派生 `lineage`。
- shared type 增加 desktop-only lineage 字段。
- sidebar 显示 `Forked from ...`。
- Session Panel 显示来源和 `打开来源对话`。
- 点击来源时命中已有 thread 直接跳转，未命中但文件存在则 createThread 恢复。

验收：

- Fork 后新 thread 能显示来源。
- 原 thread 能从新 thread 一键打开。
- 不写 JSONL 新 entry。
- Pi session 仍能被 SDK 读取。

### Phase 2：Leaf navigation history

范围：

- renderer runtime 增加 `previousLeafEntryId`。
- `从这里继续` 后显示 `返回之前位置`。
- Session Panel 增加 leaf history 状态。

验收：

- 同 session 内移动 leaf 后可单步返回。
- 不新增 thread。
- 不写 JSONL。

### Phase 3：Sidebar leaf shortcuts

范围：

- thread item 可展开显示 labeled leaves。
- leaf 点击调用 `navigateTree`。
- 完整 tree 仍保留在 Session Panel。

验收：

- Sidebar 不展示 current leaf ID 或无限完整 tree。
- Leaf shortcuts 不污染 `threads.json` 的核心 thread 模型。
- 大 session tree 下仍保持 sidebar 响应流畅。

### Phase 4：Threaded sidebar sort 可选模式

范围：

- 基于 `parentSession` 把 forked threads 组织到 parent 下。
- 提供 `Recent` / `Threaded` 两种排序模式。

验收：

- Recent 模式保持现有行为。
- Threaded 模式能展示 parent-child fork 关系。
- archived/missing/cross-project lineage 行为清晰。

## 验收清单

- `创建分支对话` 后 sidebar 新增 thread，原 thread 不被替换。
- 新 session JSONL header 有 `parentSession`。
- Forked thread 显示来源。
- 来源 thread 存在时可一键跳转。
- 来源 thread 不存在但文件存在时可恢复为 sidebar thread。
- 来源文件不存在时显示不可跳转状态。
- `从这里继续` 不新增 thread、不新建 session 文件。
- `从这里继续` 后可以返回之前 leaf。
- Sidebar 不展示无限 session tree。
- 不新增 Pi JSONL entry 类型。
- 不改变 Pi SDK / CLI / RPC 现有 session 语义。

## Open Questions

- parent thread 已归档时，点击来源应直接恢复，还是先弹确认？
- 多个 thread 指向同一 parent session file 时，默认跳转最近一个还是显示选择菜单？
- Sidebar 是否默认展示 fork 来源，还是仅 hover/选中时展示？
- Leaf shortcuts 的“recent branches”是否需要持久化，还是仅当前运行期缓存？
- Cross-project parent session 是否要自动切换 Project？
