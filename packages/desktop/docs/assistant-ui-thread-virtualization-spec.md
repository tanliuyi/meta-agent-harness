# Desktop assistant-ui Thread 虚拟滚动规范

状态：Implemented

最后更新：2026-07-16

> 本规范建立在 [Desktop AG-UI 集成规范](./ag-ui-integration-spec.md) 与 [Desktop assistant-ui Thread Adapter 与原子 Attach 规范](./assistant-ui-thread-attach-spec.md) 之上。前两份规范继续定义 main 权威数据源、AG-UI 事件映射、原子 attach、active run 恢复和 sequence resync；本规范只接管 renderer 中消息列表的渲染与滚动行为。

## 1. 背景

Desktop 当前使用 assistant-ui 官方 primitives 渲染 thread：

```text
ThreadPrimitive.Root
  -> ThreadPrimitive.Viewport
       -> ThreadPrimitive.Messages
       -> ThreadPrimitive.ViewportFooter
            -> SessionStatus
            -> Composer
```

`ThreadPrimitive.Messages` 会遍历并挂载当前 thread 的全部消息。消息根使用：

```css
content-visibility: auto;
contain-intrinsic-size: auto 200px;
```

该优化可以跳过离屏内容的部分 layout/paint 工作，但不会减少 React 组件、DOM 节点、订阅和 effect 的数量。长 session 中的 Streamdown、代码高亮、Mermaid、图片、Reasoning、Tool Group 和 Pi 工具详情仍会全部挂载。

本项目的性能验收包含 1,000 条历史消息和持续流式更新。此规模下，完整 DOM 挂载成本、content update 传播成本和 session 切换后的首次渲染成本可能成为瓶颈，因此需要评估并接入真正的窗口化渲染。

## 2. 调研结论

### 2.1 assistant-ui 官方支持边界

assistant-ui 不提供开箱即用的虚拟 Thread 组件，但官方提供以下组合能力：

- `unstable_useThreadMessageIds()`：返回当前 thread 的稳定 message ID 数组；纯内容更新时保持数组引用稳定。
- `ThreadPrimitive.Unstable_MessageById`：按稳定 ID 渲染单条消息，适用于重排、删除和窗口化场景。
- `ThreadPrimitive.MessageByIndex`：按 index 渲染单条消息；列表插入、删除或重排时比 ID 方案脆弱。

上述 ID API 在当前 `@assistant-ui/react@0.14.26` 中存在，但仍标记为 experimental。实现必须把它们隔离在单一虚拟列表组件内。

官方 Thread Virtualization 指南明确要求：

1. 按 user turn 虚拟化，而不是按单条 message 虚拟化。
2. 使用 normal-flow item 与上下 padding spacer，不使用 absolute positioning。
3. 使用 `measureElement` 测量动态高度。
4. 虚拟滚动容器自行拥有 auto-follow，不继续使用 `ThreadPrimitive.Viewport`。
5. pinned 状态下阻止 virtualizer 的测量修正与底部跟随互相争抢。

### 2.2 网络案例

#### assistant-ui 官方示例

官方仓库包含 `examples/with-virtualized-thread`。该示例：

- 使用 `@tanstack/react-virtual`；
- 从生产消费者中提取；
- 按 user turn 建立稳定虚拟项；
- 使用 `Unstable_MessageById` 渲染 turn 内消息；
- 用 `ResizeObserver` 维持流式输出的底部跟随；
- 用自定义 `scrollToFn` 避免底部跟随与测量修正产生 rubber-band；
- 把 Composer 放在滚动容器之外。

本项目安装的 `@tanstack/react-virtual@3.14.5` 使用 `@tanstack/virtual-core@3.17.3`。该版本已提供
`anchorTo: "end"`、`followOnAppend` 和 `scrollEndThreshold`，最终实现使用这些官方 API 统一处理
item remeasure 与 append 跟随，不保留 content `ResizeObserver` 或自定义 `scrollToFn` 的外层
`scrollTop` 补偿。

#### ADE coding-agent 案例

开源 coding-agent 桌面项目 ADE 使用 `@tanstack/react-virtual` 渲染聊天记录。其文档明确记录：

- 动态高度行必须使用稳定 row key；
- plan、工具和展开内容改变高度时可能产生 offset drift；
- 流式输出期间需要在测量后继续恢复 sticky-bottom；
- 虚拟项重挂载不得重复触发一次性 focus 或 entrance animation。

该案例不使用 assistant-ui，但其 coding-agent 消息形态与本项目接近，可用于验证风险模型。

### 2.3 结论

接入在技术上可行，且 assistant-ui 已提供官方支持路径；但它不是对 `ThreadPrimitive.Messages` 的局部优化，而是 renderer 滚动所有权的替换。实现风险集中在滚动状态机，不涉及 main、preload、AG-UI 协议或 Pi runtime。

## 3. 目标

本次实现必须满足：

1. 历史消息的 React/DOM 挂载数量不再随完整 session 历史线性增长。
2. Pi 的一轮 user turn 作为一个虚拟项，turn 内 assistant、reasoning 和 tool 分片保持连续视觉语义。
3. session 首次打开、切换、resync 和 active-run attach 后定位正确。
4. pinned 到底部时，流式文本、Reasoning、Tool、图片和 Streamdown 异步渲染继续跟随底部。
5. 用户主动向上滚动后，新的流式内容不得强制拉回底部。
6. 用户返回底部或点击 ScrollToBottom 后重新进入 pinned 状态。
7. Composer、SessionStatus 和 queue 控制面始终固定在消息滚动区之外。
8. 保留现有 assistant-ui message primitives、AG-UI runtime 和 Pi 富工具组件。
9. 不把虚拟滚动状态写入 Desktop reducer，也不通过 IPC 传输。

## 4. 非目标

本规范不包括：

- 不修改 Pi -> AG-UI 事件映射。
- 不修改 main/preload 的 attach、sequence、resync 或 active-run replay。
- 不实现历史消息分页或按需读取 JSONL。
- 不持久化每个 session 的滚动位置。
- 不保留普通列表与虚拟列表的长期双路径。
- 不使用 absolute-positioned virtual rows。
- 不为虚拟化改变 Tool Group、Reasoning 或 Streamdown 的产品能力。
- 不在同一变更中升级 assistant-ui 或 AG-UI 依赖。

## 5. 设计原则

### 5.1 assistant-ui 保持消息语义所有权

虚拟列表只决定哪些 turn 被挂载。单条消息仍由：

```tsx
<ThreadPrimitive.Unstable_MessageById
  messageId={messageId}
  components={MESSAGE_COMPONENTS}
/>
```

渲染。不得从 assistant-ui store 读取 parts 后在虚拟列表内重新实现 message projection。

### 5.2 turn 是虚拟化最小单位

Pi 的一次 agent 执行通常产生多个连续 assistant message：文本、工具调用、reasoning、后续文本。按 message 虚拟化会使同一执行过程被拆成大量高度很小且持续变化的 row，也会扩大相邻分片的间距问题。

虚拟项必须按以下规则分组：

- 每个 user message 开始一个新 turn；
- 后续 assistant/system message 归入最近的 turn；
- thread 开头没有 user message 时，以第一条消息创建 bootstrap turn；
- turn 初始 ID 使用该 turn 第一条消息的 ID；
- snapshot 替换部分 message ID 时，只要新旧 turn 仍共享稳定 message ID，就复用旧 turn ID；
- turn 内 message ID 保持 assistant-ui 原始顺序。

### 5.3 滚动容器只有一个所有者

接入后，TanStack Virtual 与本地 scroll controller 是滚动位置的唯一所有者。不得同时保留 `ThreadPrimitive.Viewport` 的 auto-scroll。

### 5.4 动态高度只走测量路径

所有虚拟 turn 使用 `virtualizer.measureElement`。不得对同一个 turn 再调用 `resizeItem()`；不得通过查询最后一条消息的 `offsetHeight` 手工补偿。

### 5.5 session identity 必须清理测量缓存

assistant-ui runtime 跨 session 保持稳定，但 virtualizer 的尺寸缓存、pinned 状态和首次定位状态必须按 `projectId + threadId` 隔离。

## 6. 目标架构

```text
AssistantRuntimeProvider
  -> ThreadPrimitive.Root
       -> VirtualizedThreadScroller（唯一滚动容器）
            -> useThreadMessageRows()
            -> buildTurns()
            -> useVirtualizer()
            -> top spacer
            -> visible turn rows
                 -> Unstable_MessageById
            -> bottom spacer
       -> ThreadFooter（滚动容器之外）
            -> ScrollToBottomButton
            -> SessionStatus
            -> Composer
```

数据流：

```text
assistant-ui thread state
  -> stable { id, role } rows
  -> turn membership
  -> TanStack visible item range
  -> MessageById providers
  -> existing UserMessage / AssistantMessage
```

## 7. 依赖

增加精确依赖：

```json
{
  "@tanstack/react-virtual": "3.14.5"
}
```

安装命令：

```sh
npm install --ignore-scripts
```

要求：

- 直接依赖必须精确锁定版本；
- 审查 `package.json` 与 `package-lock.json`；
- 不执行 lifecycle scripts；
- 不在本次变更中升级 `@assistant-ui/react@0.14.26`。

## 8. 数据模型

### 8.1 稳定消息行

```ts
interface ThreadMessageRow {
  id: string;
  role: "user" | "assistant" | "system";
}
```

`useThreadMessageRows()` 必须：

- 从 assistant-ui state 读取 `thread.messages`；
- 只投影 `id` 与 `role`；
- 当消息成员和 role 未变化时返回前一次数组引用；
- 文本 delta、tool partial update 和 reasoning delta 不得重建 rows 数组。

### 8.2 Turn

```ts
interface ThreadTurn {
  id: string;
  messageIds: readonly string[];
}
```

`buildThreadTurns(rows)` 必须是纯函数，并覆盖：

- 空数组；
- 首条 user；
- 首条 assistant/system；
- 连续 assistant；
- 连续 user；
- user/assistant/system 混合序列。

`stabilizeThreadTurnIds(previous, current)` 必须在 run-finish snapshot 将 optimistic user ID
替换为权威 ID 时，通过同 turn 内仍稳定的 assistant message ID 复用原 turn ID，避免整个 turn
卸载重挂载。若新旧 turn 没有共享 message ID，则使用当前 turn 第一条消息的 ID。

turn 数组只在 message membership 或 role 变化时重建。流式内容更新只触发当前已挂载 message 和对应 turn 的动态测量。

## 9. 组件边界

### 9.1 `ChatThread`

`ChatThread` 继续负责：

- Project/thread 空状态；
- `ThreadPrimitive.Root`；
- HostRequests；
- 向虚拟 surface 传入 `snapshot` 与 session key。

`ChatThread` 不再直接组合 `ThreadPrimitive.Viewport`、消息列表和 sticky Footer。

### 9.2 `VirtualizedThreadSurface`

新增单一组件，例如：

```text
src/renderer/src/components/chat/virtualized-thread.tsx
```

它负责：

- scroll element ref；
- content wrapper ref；
- turn 构造；
- TanStack Virtual 配置；
- pinned/at-bottom 状态机；
- 初始定位、run-start 定位和 TanStack end anchor 跟随；
- normal-flow spacer；
- 自定义 ScrollToBottom；
- 固定 Footer、SessionStatus 和 Composer。

该组件是 experimental assistant-ui API 的唯一调用方。

### 9.3 `messages.tsx`

现有 `UserMessage` 与 `AssistantMessage` 保持唯一实现，但需要导出稳定的：

```ts
const THREAD_MESSAGE_COMPONENTS = {
  UserMessage,
  AssistantMessage,
};
```

普通 `ThreadPrimitive.Messages` 路径在虚拟化完成后删除，不保留双写。

### 9.4 纯逻辑 helper

新增纯逻辑模块，例如：

```text
src/renderer/src/components/chat/thread-virtualization.ts
```

仅包含：

- `buildThreadTurns()`；
- `isScrollerAtBottom()`；
- 必要的稳定数据类型。

滚动副作用和 React refs 不放入该 helper。

## 10. Virtualizer 配置

基线配置：

```ts
const virtualizer = useVirtualizer({
  count: turns.length,
  estimateSize: () => 200,
  getItemKey: (index) => turns[index].id,
  getScrollElement: () => scrollerRef.current,
  anchorTo: "end",
  followOnAppend: true,
  scrollEndThreshold: 8,
  overscan: 4,
});
```

约束：

- `getItemKey` 必须使用 turn ID，不得使用 index；
- `overscan` 初始值为 4，以真实 Electron 性能测试为准；
- 不使用 smooth scroll；动态高度下 smooth scroll 无法可靠到达目标位置；
- Electron renderer 不需要 SSR `initialRect`；
- 每个可见 turn wrapper 必须设置 `data-index={virtualItem.index}`；
- 每个 wrapper 必须绑定 `ref={virtualizer.measureElement}`；
- 默认不启用 `useAnimationFrameWithResizeObserver`，TanStack 官方说明其通常会增加一帧延迟且不提供默认收益；
- 如出现 ResizeObserver loop，先修复循环根因，不以该选项掩盖问题。

### 10.1 Normal-flow spacer

虚拟项必须保持普通文档流：

```ts
const paddingTop = items[0]?.start ?? 0;
const paddingBottom = Math.max(
  0,
  virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0),
);
```

```tsx
<div style={{ paddingTop, paddingBottom }}>
  {items.map((item) => (
    <div ref={virtualizer.measureElement} data-index={item.index}>
      {/* turn messages */}
    </div>
  ))}
</div>
```

禁止使用 `position: absolute` 和 `transform: translateY(...)` 布置消息 row。normal flow 可保留现有 message margin、Collapsible 和 sticky 语义，并降低动态内容测量复杂度。

## 11. 滚动状态机

### 11.1 状态

renderer 本地维护：

```ts
interface ThreadScrollState {
  pinned: boolean;
  atBottom: boolean;
}
```

实现可使用 refs 避免高频 scroll 触发 React render：

- `stickyRef`：高频滚动与用户意图识别使用；
- `isAtBottom` state：只驱动 ScrollToBottom 按钮显隐。

底部阈值最终为 `8px`。Electron 多高度测试中，Collapsible 收起后的布局取整余量最大为 `7px`；
`8px` 可保持 TanStack end anchor 连续生效，同时 wheel up、touchmove 和稳定高度下的 scrollTop 下降仍会立即解除 pinned。

### 11.2 状态转换

| 事件 | 前置状态 | 行为 | 新状态 |
| --- | --- | --- | --- |
| session 首次 hydrate | 任意 | layout effect 跳到最后一个 turn | pinned |
| thread run 从 false -> true | 任意 | paint 前跳到底部 | pinned |
| pinned 时 item 高度变化或 append | pinned | TanStack end anchor 调整 | pinned |
| 用户 wheel up | pinned | 不移动 scrollTop | detached |
| 用户 touchmove | pinned | 不移动 scrollTop | detached |
| scrollTop 明确减少且内容高度稳定 | pinned | 识别为用户向上滚动 | detached |
| 用户滚回阈值内 | detached | 标记 at-bottom | pinned |
| 点击 ScrollToBottom | 任意 | `scrollToIndex(last, end)`，下一帧校正 scrollHeight | pinned |
| session key 变化 | 任意 | 销毁旧虚拟 surface 与测量缓存 | 新 session 初始态 |

### 11.3 TanStack end anchor

外层 thread scroller 不直接写 `scrollTop`，也不实现自定义 `scrollToFn`。动态高度和消息追加统一交给：

- `anchorTo: "end"`：位于底部时按 item 总高度变化维持 end anchor；
- `followOnAppend: true`：仅在 end threshold 内跟随新 turn；
- `scrollEndThreshold: 8`：吸收 Electron 布局取整余量；
- `virtualizer.scrollToIndex(last, { align: "end" })`：处理首次 hydrate、run start 和按钮回底。

这保证 pinned 时只有 TanStack 一个滚动写入器；detached 时仍使用 TanStack 的 viewport anchor correction。

### 11.4 用户意图识别

仅以 `atBottom === false` 不能判断用户是否主动离开底部，因为内容增长也会暂时改变底部距离。

必须综合：

- `wheel.deltaY < 0`；
- `touchmove`；
- `scrollTop` 下降；
- 同一时刻 `scrollHeight` 不变；
- `clientHeight` 变化不超过 `1px`。

这样可以区分用户向上滚动与 Streamdown/Tool/图片导致的内容高度增长。

## 12. 动态高度处理

以下内容都会改变 turn 高度：

- assistant text delta；
- reasoning streaming preview；
- Reasoning 展开/收起动画；
- Tool Group 展开/收起动画；
- Pi ToolView details 展开；
- Streamdown code highlight；
- Mermaid 渲染；
- KaTeX 渲染；
- 图片加载或上传失败；
- tool partial/error update；
- viewport 宽度变化导致文本重新换行；
- Workbench Panel 或 sidebar resize。

处理规则：

1. turn wrapper 由 `measureElement` 持续测量。
2. 不给 Markdown、Reasoning 或 Tool 组件增加手工 `virtualizer.resizeItem()`。
3. pinned 时由 TanStack end anchor 负责底部贴合。
4. detached 时允许 TanStack 默认保持 viewport anchor。
5. 不在流式 delta effect 中直接调用 `measure()`；`measureElement` 内部的 TanStack ResizeObserver 是唯一高度变更入口。
6. Collapsible 动画期间允许连续测量，但不得让一次性 entrance animation 因虚拟项重挂载反复播放。

### 12.1 Entrance animation

当前 message root 带有 `animate-in`。虚拟项滚出再滚回会重新挂载并重播动画，造成闪烁。

实现时必须选择以下一种方案，并以视觉测试决定：

- 推荐：只对当前 active run 的新 message 应用 entrance animation；历史 message 不应用。
- 备选：用 module/session scoped `Set<messageId>` 记录已展示消息，重挂载后关闭 entrance animation。

不得因为虚拟项重挂载重新抢占输入焦点、自动展开已关闭内容或重放一次性提示。

## 13. Footer 与 Composer

接入后 DOM 必须调整为：

```tsx
<ThreadPrimitive.Root className="flex h-full flex-col">
  <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto">
    <VirtualizedTurns />
  </div>
  <div className="relative shrink-0">
    <ScrollToBottomButton />
    <SessionStatus />
    <Composer />
  </div>
</ThreadPrimitive.Root>
```

要求：

- Footer 不放在 scroller 内；
- 删除 `ThreadPrimitive.ViewportFooter`；
- 删除 Footer 的 `position: sticky`；
- Composer 不参与 virtualizer 高度计算；
- ScrollToBottom 使用本地 `isAtBottom`，不使用 `ThreadPrimitive.ScrollToBottom`；
- SessionStatus 高度变化不改变消息 scroller 的内部 item measurement；
- Footer 宽度继续使用 `--thread-max-width`。

这同时消除 Composer 与消息滚动内容互相覆盖的结构性可能。

## 14. Session 切换与恢复

### 14.1 Runtime 生命周期

保持现有规范：

- `AssistantRuntimeProvider` 与 `useAgUiRuntime()` 跨 thread 稳定；
- thread 切换通过 `UseAgUiThreadListAdapter`；
- 不用 session key 重建 runtime。

### 14.2 Virtualizer 生命周期

虚拟 surface 必须使用：

```ts
const sessionKey = `${projectId}:${threadId}`;
```

作为局部 React key。key 只作用于 scroller/virtualizer 子树，不作用于：

- `AssistantRuntimeProvider`；
- `ElectronPiAgent`；
- Desktop controller；
- Composer；
- HostRequests。

这样可以：

- 清理旧 session 的尺寸缓存；
- 重置 pinned 与首次 jump refs；
- 避免 A session 的估算高度污染 B session；
- 保留官方 thread adapter 与 active-run attach 生命周期。

### 14.3 Active run attach

切回 live session 时顺序保持：

1. thread adapter hydrate bootstrap history；
2. `ElectronPiAgent` join active run；
3. rows/turns 建立；
4. virtual surface layout effect 定位最后一个 turn；
5. active replay 与实时 delta 更新最后一个 turn；
6. pinned TanStack end anchor 继续跟随。

不得为了虚拟化重新引入 history-head polling 或 runtime key remount。

### 14.4 Resync

`runtime.thread.import()` 可能整体替换 messages：

- message ID 序列不变时，rows 引用保持稳定，virtualizer 只重新测量受影响 turn；
- ID membership 变化时，turns 重建；
- `getItemKey(turn.id)` 通过共享 message ID 对账，保留逻辑未变化 turn 的测量缓存与组件状态；
- active session key 不变，不重建整个 virtual surface；
- resync 完成后若仍 pinned，校正到底部；若 detached，保持用户历史位置。

## 15. 样式与消息分组

现有消息间距规则区分：

- user -> assistant：24px；
- 连续 assistant 分片：8px；
- ghost Reasoning：无额外底部 margin。

虚拟化后，该规则必须移动到 turn wrapper 内，不能依赖所有消息共同位于全局 `ThreadPrimitive.Messages` 容器。

推荐结构：

```tsx
<div data-slot="aui-turn" className="flex flex-col py-3">
  {turn.messageIds.map((messageId) => (
    <ThreadPrimitive.Unstable_MessageById ... />
  ))}
</div>
```

要求：

- turn 之间的间距由 turn wrapper 统一承担；
- 同 turn 内连续 assistant 保持 8px；
- user 与其 assistant response 保持 24px；
- 不使用相邻虚拟 row 的 margin collapse 计算高度；
- top/bottom spacer 必须包含 turn 的完整 padding。

## 16. 错误处理与兼容边界

### 16.1 Experimental API 隔离

`Unstable_MessageById` 与 message ID hook 只允许出现在 `virtualized-thread.tsx` 或其单一 adapter 中。若 assistant-ui 后续重命名 API，只修改这一边界。

### 16.2 缺失消息

`Unstable_MessageById` 对已删除或未知 ID 返回 `null`。虚拟 row 不得因此 throw；下一次 rows membership 更新后自然删除该 ID。

### 16.3 空 thread

turns 为空时：

- virtualizer count 为 0；
- 不执行 `scrollToIndex(-1)`；
- Footer 与 Composer 正常显示；
- 不生成 spacer。

### 16.4 不保留双路径

实现和验收完成后删除普通 `ThreadPrimitive.Messages` 列表入口。失败回滚通过 Git revert 完成，不在产品代码中长期保留 feature flag 或两套滚动实现。

## 17. 文件变更计划

已修改：

```text
packages/desktop/package.json
package-lock.json
packages/desktop/src/renderer/src/components/chat/chat-thread.tsx
packages/desktop/src/renderer/src/components/chat/messages.tsx
packages/desktop/src/renderer/src/components/assistant-ui/reasoning.tsx
packages/desktop/src/renderer/src/components/assistant-ui/tool-group.tsx
packages/desktop/src/renderer/src/styles/chat.css
packages/coding-agent/npm-shrinkwrap.json
packages/coding-agent/install-lock/package-lock.json
```

已新增：

```text
packages/desktop/src/renderer/src/components/chat/virtualized-thread.tsx
packages/desktop/src/renderer/src/components/chat/thread-virtualization.ts
packages/desktop/test/thread-virtualization.test.ts
```

不得修改：

```text
packages/desktop/src/main/**
packages/desktop/src/preload/**
packages/desktop/src/renderer/src/runtime/electron-pi-agent.ts
packages/desktop/src/renderer/src/runtime/session-event-bus.ts
packages/desktop/src/shared/contracts.ts
```

除非实现过程中发现现有协议违反本规范的前置条件；此时应先更新规范并单独说明扩展范围。

## 18. 实现步骤

### 阶段 1：依赖与纯数据模型

1. 精确安装 `@tanstack/react-virtual@3.14.5`。
2. 新增 `ThreadMessageRow`、`ThreadTurn` 与 `buildThreadTurns()`。
3. 添加纯函数测试，确认 turn membership 与稳定 ID。

### 阶段 2：虚拟消息渲染

1. 从 `messages.tsx` 导出稳定 `THREAD_MESSAGE_COMPONENTS`。
2. 新增 `VirtualizedThreadSurface`。
3. 使用 stable rows 与 `Unstable_MessageById` 渲染可见 turn。
4. 使用 normal-flow spacer 与 `measureElement`。
5. 保留当前消息、Reasoning、Tool、Streamdown 组件。

### 阶段 3：滚动所有权替换

1. 移除 `ThreadPrimitive.Viewport`。
2. 移除 `ThreadPrimitive.ViewportFooter` 和 `ThreadPrimitive.ScrollToBottom`。
3. 新增唯一 scroller 与固定 Footer。
4. 实现 pinned/at-bottom 状态机。
5. 使用 `anchorTo: "end"`、`followOnAppend`、`scrollEndThreshold` 和 `scrollToIndex` 实现跟随与 run-start jump。

### 阶段 4：session 边界

1. 以 session key 重建 virtualizer 子树。
2. 验证 idle/live session 切换。
3. 验证 active-run replay 与 resync。
4. 验证 A -> B -> A 快速切换不会复用尺寸缓存。

### 阶段 5：样式与动画

1. 把消息间距迁移到 turn wrapper。
2. 防止历史消息重挂载时重播 entrance animation。
3. 验证 Tool/Reasoning 展开、Mermaid、图片和宽度 resize。
4. 删除旧普通消息列表和无效 sticky CSS，并移除 Reasoning/Tool Group 与外层 scroller 冲突的 `useScrollLock`。

### 阶段 6：性能与完整验收

1. 使用 1,000 条历史消息 fixture。
2. 追加 1,000 个文本 delta。
3. 记录 DOM message/turn 数量、首次渲染时间和滚动稳定性。
4. 完成 Electron 窗口手动与 CDP 验证。
5. 运行定点测试和根级 check。

## 19. 测试要求

### 19.1 纯逻辑测试

- 空消息数组；
- assistant 开头；
- system 开头；
- 单个 user turn；
- 多个 user turn；
- 连续 assistant/tool/reasoning 分片；
- 连续 user；
- message membership 不变时 rows identity 稳定；
- 末尾 message 增删时 turn ID 稳定。

### 19.2 Renderer 组件测试

- 只渲染 virtualizer 返回的 turn；
- turn 使用稳定 ID key；
- 未知 message ID 返回 null 不崩溃；
- 空 thread 不调用负 index；
- ScrollToBottom 按钮状态正确；
- Footer 位于 scroller 外；
- session key 变化清理 virtualizer 状态；
- run start 在 layout effect 中定位底部；
- detached 状态不被 TanStack end anchor 拉回底部。

### 19.3 Electron 交互测试

- idle session 首次打开定位底部；
- live session 切回时历史与 streaming message 同时可见；
- 用户向上滚动后 stream 不抢位置；
- 点击 ScrollToBottom 后恢复跟随；
- Reasoning streaming 高度增长不跳动；
- Tool Group 和 ToolView 展开/收起不跳动；
- 图片加载、代码高亮、Mermaid/KaTeX 完成后不跳动；
- Workbench Panel resize 导致换行时位置稳定；
- Composer、queue、SessionStatus 和 HostUi 行为不变；
- A -> B -> A 快速切换无旧尺寸缓存污染；
- resync 后 detached/pinned 语义正确。

### 19.4 性能验收

使用包含 1,000 条消息、Reasoning、工具调用、代码块和图片占位的固定 fixture：

1. DOM 中挂载的 turn 数量只与 viewport 和 overscan 相关，不与 1,000 条历史线性增长。
2. 常规 900px 高 viewport 下，挂载 turn 数量目标不超过 50；超出时必须解释短 turn 密度并重新评估 overscan。
3. 在顶部、中部和底部滚动时不得出现空白窗口。
4. 追加 1,000 个 delta 时，不挂载离屏历史 message。
5. pinned stream 不出现可感知 rubber-band。
6. detached stream 不改变用户当前阅读位置。
7. session 切换后的首帧不得闪现前一个 session 的消息或高度。

### 19.5 实现验收结果

2026-07-16 使用 Electron dev CDP 对真实 renderer target 验收：

- 1,000 messages / 500 turns 首次窗口化完成约 `362ms`；总 DOM 元素为 476。
- 顶部挂载 6 turns / 12 messages，中部 12 / 24，底部 7 / 14；三处均无空白，absolute turn 为 0。
- 对末尾稳定 message ID 执行 1,000 次完整 repository 内容更新：pinned 距底部 `1px`，仅挂载 6 / 12。
- detached 状态执行 1,000 次同类更新：`scrollTop` 在更新前后均为 `49365`，仅挂载 12 / 24。
- `680px`、`760px`、`900px`、`1080px` viewport 下反复展开/收起 Reasoning、Tool Group 和 ToolView，
  scrollTop 方向反转均为 0，结束位置保持在 `0-7px` end threshold 内。
- A -> B -> A 切换中 scroller 两次重建，Composer DOM 保持同一实例，session 权威历史恢复。

## 20. 验收命令

新增或修改测试文件后，从 `packages/desktop` 运行定点 Vitest：

```sh
node ../../node_modules/vitest/dist/cli.js --run test/thread-virtualization.test.ts
```

必要时运行现有 Desktop 定点测试：

```sh
node ../../node_modules/vitest/dist/cli.js --run test/*.test.ts
```

最后在仓库根运行：

```sh
npm run check
```

不运行 `npm test` 或 build。

## 21. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| experimental assistant-ui API 变更 | 升级后类型或行为破坏 | 精确锁定依赖；API 仅存在于单一组件 |
| 动态高度估算错误 | 滚动跳动或空白 | stable turn key、`measureElement`、normal-flow spacer |
| 两个滚动所有者 | rubber-band、自动回底 | 删除 `ThreadPrimitive.Viewport`，只保留本地 controller |
| streaming 持续 remeasure | 高频 scroll writes | `anchorTo: "end"` 与 `followOnAppend` 统一交给 TanStack |
| session 复用尺寸缓存 | A/B session 位置污染 | session-keyed virtualizer 子树 |
| 虚拟项重挂载动画 | 闪烁、重复 focus | 仅新消息动画或按 message ID 记录已展示状态 |
| Tool/Reasoning 展开 | above-viewport offset drift | TanStack 默认 anchor correction，不混用 `resizeItem` |
| 过度虚拟化短 thread | 增加复杂度无收益 | 仍使用单一路径；短 thread 的 virtualizer 开销纳入性能对比 |

## 22. 完成标准

实现只有在以下条件全部满足时才可将状态改为 `Implemented`：

1. `@tanstack/react-virtual` 精确依赖和 lockfile 已审查。
2. 所有消息通过 turn virtualizer 与 `Unstable_MessageById` 渲染。
3. 普通 `ThreadPrimitive.Messages` 列表路径已删除。
4. `ThreadPrimitive.Viewport` 不再拥有消息滚动。
5. Composer 和 SessionStatus 位于 scroller 外。
6. active-run attach、resync 和 session 切换语义未改变。
7. 1,000 条历史性能 fixture 达到 DOM 和滚动稳定性目标。
8. 流式、动态高度、detached/pinned、快速 session 切换完成 Electron 验证。
9. 新增定点测试通过。
10. 根级 `npm run check` 通过。
11. 文档实现状态、文件清单和最终参数已按实际代码更新。

## 23. 参考资料

- [assistant-ui Thread Virtualization](https://www.assistant-ui.com/docs/guides/virtualization)
- [assistant-ui with-virtualized-thread 示例](https://github.com/assistant-ui/assistant-ui/tree/main/examples/with-virtualized-thread)
- [assistant-ui Thread primitives](https://www.assistant-ui.com/docs/primitives/thread)
- [TanStack Virtual Virtualizer API](https://tanstack.com/virtual/latest/docs/api/virtualizer)
- [ADE AgentChatMessageList](https://github.com/arul28/ADE/blob/main/apps/desktop/src/renderer/components/chat/AgentChatMessageList.tsx)
- [ADE Composer and Chat UI](https://github.com/arul28/ADE/blob/main/docs/features/chat/composer-and-ui.md)
