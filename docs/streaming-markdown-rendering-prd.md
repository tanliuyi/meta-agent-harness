# Streaming Markdown Rendering PRD

## 背景

Meta Agent Desktop 的 chat timeline 需要承载 AI coding agent 的流式输出。Agent 消息通常包含
Markdown 段落、列表、表格、代码块、diff、命令片段和链接，并且在生成过程中处于持续变化状态。

当前 renderer 的 assistant/user 消息仍以纯文本方式展示，依赖 `white-space: pre-wrap` 保留换行。
这种方式实现简单，但无法满足 coding agent 场景对结构化阅读、代码可读性和长消息扫描效率的要求。

本期需要引入实时流式 Markdown 渲染，并重点解决两类性能问题：

- Markdown token 流应尽快反映到 UI，不能因为渲染、代码高亮或响应式更新造成明显卡顿。
- Vue 3 renderer 不应因每个 token 更新触发整条消息、整段 timeline 或滚动逻辑的高频重算。

## 目标

- 在 chat timeline 中实时渲染 assistant/user 消息的 Markdown。
- 使用市面上专门针对 AI streaming Markdown 场景的库，不自研流式 Markdown parser。
- 保证 Markdown 实时体验：token 到达后应在下一帧或短时间内显示为结构化内容。
- 优化 Vue 3 响应式更新路径，避免 watch 全文、深层响应式追踪和高频 smooth scroll。
- 代码块使用 Shiki 做异步非阻塞高亮。
- Shiki 高亮不进入实时 Markdown 主路径；高亮结果作为渐进增强异步替换。
- 流式期间代码块必须先以 plain escaped code 实时显示。
- 支持完成态消息缓存，避免历史消息重复 Markdown 渲染。

## 非目标

- 本期不引入虚拟列表。
- 本期不引入 DOMPurify。
- 本期不实现自研 Markdown parser、增量 parser 或 AST diff 引擎。
- 本期不把工具结果的大输出全部 Markdown 化；工具结果仍优先使用专门的折叠、摘要和纯文本展示。
- 本期不支持 Mermaid、KaTeX、图表等重型 Markdown 扩展。
- 本期不实现完整的代码编辑器级别能力，例如代码块内搜索、行号选择和 diff 交互编辑。

## 用户体验要求

### 实时性

- 流式 token 到达后，文本内容应在 16-32ms 合并窗口内进入 Vue 状态。
- Markdown 结构化显示应保持实时，不允许等 message 完成后才渲染。
- 长代码块输出时，用户应立即看到 plain code 增长。
- Shiki 初始化、语言加载、主题加载和高亮计算不得阻塞 token 显示、输入框输入和滚动。

### 稳定性

- 不完整 Markdown 必须可展示，尤其是未闭合 code fence、未闭合列表和半截链接。
- 流式中布局允许轻微变化，但不应频繁大幅跳动。
- 用户滚离底部时，不应被新的 token 强制拉回底部。
- 用户接近底部时，timeline 应跟随最新内容。

### 可读性

- 支持常见 GFM 结构：段落、标题、列表、引用、表格、链接、inline code、fenced code block。
- HTML-like 内容默认按文本显示，例如 `<file>...</file>`、`<thinking>...</thinking>`。
- 代码块应显示语言标记；Shiki 高亮完成后视觉上替换 plain code。

## 技术约束

- 前端框架为 Vue 3。
- 渲染运行在 Electron renderer 中。
- 不引入 DOMPurify，因此 Markdown 渲染必须采用安全白名单策略。
- 不允许 raw HTML 进入 `v-html`。
- 链接和图片必须通过 renderer 层策略控制。
- 代码高亮使用 Shiki，并通过异步非阻塞方式运行。
- Shiki worker 返回结果必须支持过期丢弃。

## 推荐依赖

### 流式 Markdown

优先调研并接入 `markstream-vue`：

- 面向 Vue 3 的 streaming Markdown 渲染。
- 目标场景包含 AI chat、LLM token stream、不完整 Markdown 和 streaming code block。
- 可通过封装组件隔离库 API，降低后续替换成本。

封装层命名建议：

```text
apps/desktop/src/renderer/src/components/markdown/StreamingMarkdown.vue
```

外部消息组件不直接依赖第三方库 API，只依赖本项目封装组件。

### 代码高亮

使用 `shiki`，通过 renderer web worker 或等价后台任务封装为异步服务：

```text
apps/desktop/src/renderer/src/components/markdown/shiki-highlight.worker.ts
apps/desktop/src/renderer/src/components/markdown/shiki-highlight-service.ts
```

Shiki highlighter 实例必须缓存。语言和主题列表应按 coding agent 场景收敛，避免一次加载过多资源。

建议首批语言：

```text
typescript, javascript, tsx, jsx, json, bash, shell, diff, vue, css, scss, html, markdown, yaml, python, go, rust
```

## 渲染架构

```text
IPC message_update
  -> renderer store pending buffer
  -> requestAnimationFrame / 16-32ms flush
  -> update current message text and revision
  -> StreamingMarkdown receives source + revision
  -> streaming markdown library renders real-time Markdown
  -> code block first renders escaped plain code
  -> Shiki highlight service receives stable code block jobs
  -> worker returns highlighted HTML
  -> stale result check
  -> replace corresponding code block highlight
```

## Vue 响应式策略

### Message Revision

每条 message 需要维护轻量版本号：

```ts
interface RenderableThreadMessage {
  id: string
  role: string
  text?: string
  revision: number
  isStreaming?: boolean
  renderState?: 'streaming' | 'complete'
}
```

流式更新只递增当前 message 的 `revision`。组件 watch 和滚动逻辑不得依赖整条 message text。

### Store Flush

IPC 中的 `message_update` 不应逐条同步写入 Vue 响应式对象。应先进入 pending buffer，再以帧级提交：

```text
pending update map by message id
  -> raf scheduled
  -> apply latest update only
  -> revision++
```

同一帧内同一 message 的多次 token update 只提交最后一次。

### Timeline Watch

`ChatView` 当前不应继续 watch `getLastMessageText()`。应改为依赖：

```text
activeSessionId
messages.length
lastMessage.id
lastMessage.revision
isRunning
```

滚动跟随也应合并到 raf 中，每帧最多执行一次。

### Message Memo

消息列表不引入虚拟列表，但可以使用 Vue 的稳定 key 和 memo 思路减少历史消息重算：

```vue
<component
  :is="getMessageComponent(message.role)"
  :message="message"
  v-memo="[message.id, message.revision]"
/>
```

具体是否使用 `v-memo` 以实现验证为准。核心要求是历史消息不因当前流式 token 反复重新渲染。

## Markdown 安全策略

由于本期不使用 DOMPurify，安全策略必须在 Markdown renderer 和封装层完成。

要求：

- 禁用 raw HTML，HTML-like 输入按文本显示。
- 不允许用户内容直接拼接为 HTML attribute。
- link href 必须做 scheme allow-list。
- 默认允许链接 scheme：

```text
http:
https:
mailto:
```

- `javascript:`, `data:`, `file:`, control-char 混淆 scheme 均不得渲染为可点击链接。
- 图片本期默认不渲染远程 Markdown image，或仅在后续显式产品决策后允许 `https:` image。
- inline code 和 fenced code 原文必须 escape。
- Shiki 返回的 HTML 只能放入代码块内部，不允许混入外层用户可控 attribute。

## Shiki 异步高亮策略

### 主路径

实时 Markdown 主路径不等待 Shiki。

流式期间：

- code fence 先显示 escaped plain code。
- 当前仍在增长的 code block 默认不高亮。
- 如果某个 code block 在流式中稳定超过阈值，可以低优先级提交高亮任务。

完成时：

- 对 message 中所有 code block 发起最终高亮任务。
- 高亮结果写入缓存。
- UI 接收结果后替换对应 code block。

### 任务 Key

高亮任务必须带可校验 key：

```ts
interface HighlightJobKey {
  messageId: string
  messageRevision: number
  blockIndex: number
  lang: string
  codeHash: string
  theme: string
}
```

返回结果写入前必须检查：

- message 仍存在。
- message revision 未过期，或 block code hash 仍匹配。
- 当前主题仍匹配。

不匹配则丢弃结果。

### Worker

Worker 负责：

- lazy init Shiki highlighter。
- 缓存 highlighter。
- 限制并发，避免多个高亮任务同时抢占 CPU。
- 返回 highlighted HTML 或 plain escaped fallback。

主线程 service 负责：

- 去重相同 job。
- 取消或忽略过期 job。
- 暴露 code block highlight 状态。

## 缓存策略

### Markdown 完成态缓存

完成态消息应缓存 Markdown 渲染结果：

```text
messageId + revision + theme + markdownOptions -> rendered result
```

流式态不要求长期缓存，但需要避免同一帧重复 parse。

### Shiki 缓存

代码块高亮缓存 key：

```text
lang + theme + codeHash -> highlightedHtml
```

同一 code block 在不同 message 中重复出现时可复用。

## 状态与降级

- 流式 Markdown 库异常时，应降级为 escaped plain text，不影响消息显示。
- Shiki worker 初始化失败时，应保留 plain code，并记录 renderer diagnostic。
- 单个 code block 高亮失败时，只影响该 block。
- 超长 code block 可跳过 Shiki 高亮，显示 plain code 并保留语言标签。

建议初始阈值：

```text
单个 code block 超过 200 KB 跳过高亮
单条 message 超过 1 MB 时降低 Markdown parse 频率
Shiki worker 单任务超时 3s 后 fallback
```

## 验收标准

### 功能

- Assistant message 支持实时 Markdown 渲染。
- User message 支持 Markdown 渲染，或至少与 assistant 使用同一安全渲染策略。
- HTML-like 文本按文本显示。
- 不安全链接不渲染为可点击链接。
- 代码块流式期间实时显示 plain code。
- message 完成后代码块异步变为 Shiki 高亮。

### 性能

- 流式输出时输入框可持续输入，无明显卡顿。
- 长代码块流式输出时 timeline 可滚动。
- 单条 10k tokens 消息流式渲染过程中无长时间主线程冻结。
- Shiki 首次初始化不阻塞 Markdown 文本显示。
- 当前 streaming message 更新不触发历史消息重复 Markdown parse。

### 稳定性

- 未闭合 code fence 能正常显示。
- 快速切换 thread 时，旧 Shiki job 不会写入新 thread。
- 切换主题时，高亮缓存按 theme 失效或重新计算。
- 用户滚离底部后，新 token 不强制跳到底部。

## 实施计划

### Phase 1：响应式与流式提交优化

- 为 message 增加 `revision` 和 streaming/complete 状态。
- 将 IPC message update 合并为 raf/16-32ms flush。
- 改造 `ChatView` watcher，移除全文 text 依赖。
- 合并滚动更新，每帧最多执行一次。

### Phase 2：接入流式 Markdown 组件

- 新增 `StreamingMarkdown.vue` 封装第三方 streaming Markdown 库。
- 在 `AssistantMessage.vue` 接入 Markdown。
- 复用到 `UserMessage.vue`，或明确 user message 的阶段性策略。
- 实现 raw HTML 禁用、链接策略和 fallback。

### Phase 3：Shiki 异步高亮

- 引入 `shiki`。
- 新增 highlighter worker 和 service。
- code block 默认 plain render。
- message 完成后提交高亮任务。
- 实现过期结果丢弃和缓存。

### Phase 4：压测与调优

- 增加长 Markdown、长代码块、未闭合 fence、快速 thread 切换用例。
- 使用 devtools performance profile 验证主线程长任务。
- 调整 flush interval、parse throttle、Shiki queue concurrency 和超长 block 阈值。

## 待确认问题

- 本期是否允许 Markdown image。如果允许，允许哪些 URL scheme 和尺寸限制。
- `markstream-vue` 的 raw HTML 禁用能力是否满足本项目安全策略；若不满足，需要通过封装层补齐或更换同类库。
- Shiki theme 应跟随当前 Desktop theme，还是先固定 dark/light 两套主题。
- User message 是否默认启用 Markdown，还是只对 assistant message 启用。
