import type { Message, ToolCall } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'
import type { DesktopToolCall } from '@coding-agent-desktop-src/protocol/tool'
import type {
  MessageRenderState,
  WorkspaceRuntimeTimelineEvent
} from '@renderer/stores/workspace-session'
import {
  createDisplayTimelineItems,
  createProcessingCollapseResult,
  createTimelineItems,
  createTimelineProjectionCache,
  getTimelineChangedStartIndex,
  projectTimelineItems,
  stabilizeTimelineItems,
  type TimelineItem
} from '../chatTimelineDisplay'

describe('chatTimelineDisplay', () => {
  it('thinking 隐藏时，将连续纯工具 assistant 消息聚合为一个稳定工具组', () => {
    const tools = [
      toolCall('tool-read', 'read'),
      toolCall('tool-edit', 'edit'),
      toolCall('tool-bash', 'bash')
    ]
    const items = timeline(
      [
        assistantToolMessage('message-a', ['tool-read']),
        reasoningMessage('reasoning-a', 'thinking before edit'),
        assistantToolMessage('message-b', ['tool-edit']),
        assistantToolMessage('message-c', ['tool-bash'])
      ],
      tools,
      true
    )
    expect(items).toMatchObject([
      {
        type: 'tool-group',
        key: 'tool-group:tool-read',
        toolCallIds: ['tool-read', 'tool-edit', 'tool-bash'],
        summary: '已读取 1 文件，已编辑 1 文件，已运行 1 命令'
      }
    ])
  })

  it('thinking 展示时会打断纯工具 assistant 聚合', () => {
    const tools = [toolCall('tool-read', 'read'), toolCall('tool-edit', 'edit')]
    const items = timeline(
      [
        reasoningMessage('reasoning-a', 'thinking before read'),
        assistantToolMessage('message-a', ['tool-read']),
        reasoningMessage('reasoning-b', 'thinking before edit'),
        assistantToolMessage('message-b', ['tool-edit'])
      ],
      tools
    )
    expect(items.map((item) => item.type)).toEqual([
      'thinking',
      'tool-group',
      'thinking',
      'tool-group'
    ])
    expect(items[1]).toMatchObject({ key: 'tool-group:tool-read', toolCallIds: ['tool-read'] })
    expect(items[3]).toMatchObject({ key: 'tool-group:tool-edit', toolCallIds: ['tool-edit'] })
  })

  it('有文本且带工具的 assistant 会聚合后续无可见输出的工具轮次', () => {
    const tools = [
      toolCall('tool-bash-a', 'bash'),
      toolCall('tool-bash-b', 'bash'),
      toolCall('tool-memory', 'memory')
    ]
    const items = timeline(
      [
        assistantTextToolMessage('message-a', '格式化完成，继续复跑测试和 web typecheck。', [
          'tool-bash-a',
          'tool-bash-b'
        ]),
        assistantToolMessage('message-b', ['tool-memory'])
      ],
      tools,
      true
    )
    expect(items).toMatchObject([
      { type: 'message', key: 'message-a:text:0' },
      {
        type: 'tool-group',
        key: 'tool-group:tool-bash-a',
        toolCallIds: ['tool-bash-a', 'tool-bash-b', 'tool-memory'],
        summary: '已运行 2 命令，已执行 1 工具'
      }
    ])
  })

  it('工具完成时只替换变化的 timeline 投影', () => {
    const running = { ...toolCall('tool-read', 'read'), status: 'running' as const }
    const completed = { ...running, status: 'succeeded' as const, result: 'done' }
    const user = userMessage('user-a', 'hello')
    const assistant = assistantToolMessage('assistant-a', ['tool-read'])
    const create = (tool: DesktopToolCall): TimelineItem[] =>
      timeline([user, assistant], [tool], true)
    const initial = stabilizeTimelineItems(create(running), undefined)
    const updated = stabilizeTimelineItems(create(completed), initial)
    const unchanged = stabilizeTimelineItems(create(completed), updated)
    expect(updated[0]).toBe(initial[0])
    expect(updated[1]).not.toBe(initial[1])
    expect(unchanged).toBe(updated)
  })

  it('记录稳定 timeline 首个变化索引供下游复用前缀', () => {
    const project = (messages: Message[]): TimelineItem[] =>
      messages.map((message) => ({
        type: 'message',
        key: message.id,
        message,
        revision: 1,
        renderState: 'complete'
      }))
    const first = userMessage('user-a', 'first')
    const second = userMessage('user-b', 'second')
    const third = userMessage('user-c', 'third')
    const initial = stabilizeTimelineItems(project([first, second]), undefined)
    const appended = stabilizeTimelineItems(project([first, second, third]), initial)
    const changed = stabilizeTimelineItems(
      project([first, userMessage('user-b', 'updated'), third]),
      appended
    )
    expect(getTimelineChangedStartIndex(appended)).toBe(2)
    expect(getTimelineChangedStartIndex(changed)).toBe(1)
    expect(changed[0]).toBe(appended[0])
  })

  it('相同投影重新排序时保留新顺序', () => {
    const first = userMessage('user-a', 'first')
    const second = userMessage('user-b', 'second')
    const item = (message: Message): TimelineItem => ({
      type: 'message',
      key: message.id,
      message,
      revision: 1,
      renderState: 'complete'
    })
    const initial = stabilizeTimelineItems([item(first), item(second)], undefined)
    const reordered = stabilizeTimelineItems([item(second), item(first)], initial)
    expect(reordered.map((entry) => entry.key)).toEqual(['user-b', 'user-a'])
    expect(reordered[0]).toBe(initial[1])
    expect(reordered[1]).toBe(initial[0])
  })

  it('复用未变化消息的基础投影并按 revision 失效', () => {
    const first = userMessage('user-a', 'first')
    const reply = assistantTextMessage('assistant-a', 'reply')
    const revisions: Record<string, number> = { 'user-a': 1, 'assistant-a': 1 }
    const create = (messages: Message[]): TimelineItem[] =>
      createTimelineItems(
        input(messages, [], false, (message) => ({
          revision: revisions[message.id] ?? 1,
          renderState: 'complete'
        }))
      )
    const initial = create([first, reply])
    const appended = create([first, reply, userMessage('user-b', 'second')])
    revisions['assistant-a'] = 2
    const revised = create([first, reply])
    expect(appended[0]).toBe(initial[0])
    expect(appended[1]).toBe(initial[1])
    expect(revised[0]).toBe(initial[0])
    expect(revised[1]).not.toBe(initial[1])
    expect(revised[1]).toMatchObject({ revision: 2 })
  })

  it('纯消息 append 只投影新增后缀', () => {
    const cache = createTimelineProjectionCache()
    const first = userMessage('user-a', 'first')
    const second = assistantTextMessage('assistant-a', 'second')
    const initial = projectTimelineItems(input([first, second]), undefined, cache)
    const appended = projectTimelineItems(
      input([first, second, userMessage('user-b', 'third')]),
      initial,
      cache
    )
    expect(appended[0]).toBe(initial[0])
    expect(appended[1]).toBe(initial[1])
    expect(appended.at(-1)).toMatchObject({ key: 'user-b' })
    expect(getTimelineChangedStartIndex(appended)).toBe(initial.length)
  })

  it('历史 revision 或工具依赖变化时回退完整投影', () => {
    const cache = createTimelineProjectionCache()
    const first = userMessage('user-a', 'first')
    let revision = 1
    const state = (): MessageRenderState => ({ revision, renderState: 'complete' })
    const initial = projectTimelineItems(input([first], [], true, state), undefined, cache)
    revision = 2
    const revised = projectTimelineItems(
      input([first, userMessage('user-b', 'second')], [], true, state),
      initial,
      cache
    )
    const read = toolCall('tool-read', 'read')
    const withTool = projectTimelineItems(
      input(
        [
          first,
          userMessage('user-b', 'second'),
          assistantToolMessage('assistant-a', ['tool-read'])
        ],
        [read],
        true,
        state
      ),
      revised,
      cache
    )
    expect(revised[0]).not.toBe(initial[0])
    expect(revised[0]).toMatchObject({ revision: 2 })
    expect(withTool.at(-1)).toMatchObject({ type: 'tool-group', toolCallIds: ['tool-read'] })
  })

  it('同一 timeline 的计时更新只替换活动处理段', () => {
    const read = {
      ...toolCall('tool-read', 'read'),
      status: 'running' as const,
      startedAt: '2026-07-09T00:00:00.000Z'
    }
    const items = timeline(
      [userMessage('user-a', 'hello'), assistantToolMessage('assistant-a', ['tool-read'])],
      [read],
      true
    )
    const initial = createProcessingCollapseResult({
      items,
      isRunning: true,
      activeSessionId: 'thread-a',
      now: Date.parse('2026-07-09T00:00:05.000Z')
    })
    const updated = createProcessingCollapseResult(
      {
        items,
        isRunning: true,
        activeSessionId: 'thread-a',
        now: Date.parse('2026-07-09T00:00:06.000Z')
      },
      initial
    )
    expect(updated.contexts[0]?.durationLabel).toBe('6s')
    expect(updated.finalReplyKeys).toBe(initial.finalReplyKeys)
  })

  it('无活动处理段时复用计时结果', () => {
    const items = timeline([userMessage('user-a', 'hello')])
    const initial = createProcessingCollapseResult({
      items,
      isRunning: false,
      activeSessionId: 'thread-a',
      now: 1
    })
    expect(
      createProcessingCollapseResult(
        { items, isRunning: false, activeSessionId: 'thread-a', now: 2 },
        initial
      )
    ).toBe(initial)
  })

  it('处理段 key 不随 user 后面的 timeline item 数量变化', () => {
    const read = toolCall('tool-read', 'read')
    const edit = toolCall('tool-edit', 'edit')
    const base = timeline(
      [userMessage('user-a', 'hello'), assistantToolMessage('assistant-a', ['tool-read'])],
      [read],
      true
    )
    const appended = timeline(
      [
        userMessage('user-a', 'hello'),
        assistantToolMessage('assistant-a', ['tool-read']),
        assistantToolMessage('assistant-b', ['tool-edit'])
      ],
      [read, edit],
      true
    )
    expect(
      createProcessingCollapseResult({
        items: base,
        isRunning: true,
        activeSessionId: 'thread-a',
        now: 1
      }).contexts[0]?.key
    ).toBe('thread-a:user-a')
    expect(
      createProcessingCollapseResult({
        items: appended,
        isRunning: true,
        activeSessionId: 'thread-a',
        now: 1
      }).contexts[0]?.key
    ).toBe('thread-a:user-a')
  })

  it('压缩分割线不会让之前消息折叠为处理段', () => {
    const items = timeline(
      [
        userMessage('user-a', 'hello'),
        compactionMessage('compaction-a'),
        assistantTextMessage('assistant-a', '继续')
      ],
      [],
      true
    )
    const collapsed = createProcessingCollapseResult({
      items,
      isRunning: false,
      activeSessionId: 'thread-a',
      now: 1
    })
    expect(collapsed.contexts).toHaveLength(0)
    expect(
      createDisplayTimelineItems({
        timelineItems: items,
        contexts: collapsed.contexts,
        isCollapsedHistoryOpen: () => false
      }).map((item) => item.type)
    ).toEqual(['message', 'compaction-divider', 'message'])
  })

  it.each([
    {
      label: '压缩分割线',
      item: {
        type: 'compaction-divider',
        key: 'compaction-a:compaction',
        message: compactionMessage('compaction-a')
      } satisfies TimelineItem
    },
    { label: '运行时系统消息', item: runtimeItem() }
  ])('$label 不打断同一个折叠处理段', ({ item: systemItem }) => {
    const tools = [toolCall('tool-read', 'read'), toolCall('tool-edit', 'edit')]
    const items = timeline(
      [
        userMessage('user-a', 'hello'),
        assistantTextToolMessage('assistant-read', '先读取文件', ['tool-read']),
        assistantTextToolMessage('assistant-edit', '继续修改', ['tool-edit']),
        assistantTextMessage('assistant-final', '完成')
      ],
      tools,
      true
    )
    items.splice(3, 0, systemItem)
    const collapsed = createProcessingCollapseResult({
      items,
      isRunning: false,
      activeSessionId: 'thread-a',
      now: 1
    })
    const display = createDisplayTimelineItems({
      timelineItems: items,
      contexts: collapsed.contexts,
      isCollapsedHistoryOpen: () => false
    })
    expect(collapsed.contexts).toMatchObject([
      { boundaryIndex: 1, processEndIndex: 6, hiddenCount: 4, collapsible: true }
    ])
    expect(collapsed.finalReplyKeys.has('assistant-final:text:0')).toBe(true)
    expect(display.map((item) => item.key)).toEqual([
      'user-a',
      'collapsed-history:thread-a:user-a',
      systemItem.key,
      'assistant-final:text:0'
    ])
  })

  it('将压缩系统消息转换为分割线 timeline item', () => {
    expect(
      timeline(
        [
          userMessage('user-a', 'hello'),
          compactionMessage('compaction-a'),
          assistantTextMessage('assistant-a', '继续')
        ],
        [],
        true
      )
    ).toMatchObject([
      { type: 'message', key: 'user-a' },
      { type: 'compaction-divider', key: 'compaction-a:compaction' },
      { type: 'message', key: 'assistant-a:text:0' }
    ])
  })

  it('标准 assistant toolCalls 会被直接消费', () => {
    const tools = [toolCall('tool-read', 'read'), toolCall('tool-edit', 'edit')]
    const items = timeline(
      [
        assistantTextToolMessage('message-a', '读取', ['tool-read']),
        assistantTextToolMessage('message-b', '编辑', ['tool-edit'])
      ],
      tools,
      true
    )
    expect(items.map((item) => item.type)).toEqual([
      'message',
      'tool-group',
      'message',
      'tool-group'
    ])
    expect(items[1]).toMatchObject({ key: 'tool-group:tool-read', toolCallIds: ['tool-read'] })
    expect(items[3]).toMatchObject({ key: 'tool-group:tool-edit', toolCallIds: ['tool-edit'] })
  })

  it('同一 assistant 的可见文本先渲染，toolCalls 随后补为单个工具组', () => {
    const tools = [toolCall('tool-read', 'read'), toolCall('tool-edit', 'edit')]
    const items = timeline(
      [assistantTextToolMessage('message-a', '准备修改', ['tool-read', 'tool-edit'])],
      tools
    )
    expect(items.map((item) => item.type)).toEqual(['message', 'tool-group'])
    expect(items[0]).toMatchObject({ key: 'message-a:text:0', text: '准备修改' })
    expect(items[1]).toMatchObject({
      key: 'tool-group:tool-read',
      toolCallIds: ['tool-read', 'tool-edit']
    })
  })

  it('有文本的 assistant 会打断纯工具聚合', () => {
    const tools = [toolCall('tool-read', 'read'), toolCall('tool-edit', 'edit')]
    const items = timeline(
      [
        assistantToolMessage('message-a', ['tool-read']),
        assistantTextMessage('message-b', '准备修改'),
        assistantToolMessage('message-c', ['tool-edit'])
      ],
      tools
    )
    expect(items.map((item) => item.type)).toEqual(['tool-group', 'message', 'tool-group'])
    expect(items[0]).toMatchObject({ key: 'tool-group:tool-read' })
    expect(items[2]).toMatchObject({ key: 'tool-group:tool-edit' })
  })

  it('将 worker 异常作为标准 runtime system item 追加到 timeline', () => {
    const items = createTimelineItems({
      ...input([userMessage('user-a', 'hello')]),
      runtimeEvents: [runtimeEvent()]
    })
    expect(items).toMatchObject([
      { type: 'message', key: 'user-a' },
      {
        type: 'runtime-event',
        key: 'runtime-event:worker-crash:worker-a:1000',
        event: { title: 'Worker 已崩溃' },
        message: {
          id: 'runtime-event:worker-crash:worker-a:1000',
          role: 'system',
          content: 'worker exited unexpectedly',
          name: 'agentEvent'
        }
      }
    ])
    const runtimeItem = items[1]
    expect(runtimeItem?.type).toBe('runtime-event')
    if (runtimeItem?.type !== 'runtime-event') throw new Error('expected runtime event')
    expect(runtimeItem.message).not.toHaveProperty('createdAt')
    expect(runtimeItem.message).not.toHaveProperty('systemEvent')
  })

  it('无标准消息时间戳时 worker 异常保持 runtime event 输入顺序追加', () => {
    const items = createTimelineItems({
      ...input([
        userMessage('user-before-crash', 'start'),
        userMessage('user-after-resume', 'continue'),
        assistantTextMessage('assistant-after-resume', 'done')
      ]),
      runtimeEvents: [runtimeEvent()]
    })
    expect(items.map((item) => item.key)).toEqual([
      'user-before-crash',
      'user-after-resume',
      'assistant-after-resume:text:0',
      'runtime-event:worker-crash:worker-a:1000'
    ])
  })

  it('直接投影 user、独立 reasoning、assistant toolCalls 与 tool content，并保持标准 id', () => {
    const read = toolCall('call-read', 'read')
    const messages: Message[] = [
      userMessage('entry-user', 'hello'),
      reasoningMessage('entry-assistant-reasoning', 'inspect files'),
      assistantTextToolMessage('entry-assistant', 'working', ['call-read']),
      { id: 'entry-tool', role: 'tool', toolCallId: 'call-read', content: 'file text' },
      assistantTextMessage('entry-final', 'done')
    ]
    const items = timeline(messages, [read])
    expect(items.map((item) => item.key)).toEqual([
      'entry-user',
      'entry-assistant-reasoning',
      'entry-assistant:text:0',
      'tool-group:call-read',
      'entry-tool',
      'entry-final:text:0'
    ])
    expect(items[1]).toMatchObject({ type: 'thinking', text: 'inspect files' })
    expect(items[4]).toMatchObject({ type: 'message', toolCall: read })
  })

  it('隐藏独立 reasoning 时不转换 Message 数组', () => {
    const messages: Message[] = [
      reasoningMessage('reasoning-1', 'private'),
      assistantTextMessage('assistant-1', 'public')
    ]
    expect(timeline(messages, [], true).map((item) => item.key)).toEqual(['assistant-1:text:0'])
  })

  it('AG-UI append 时保留未变化 timeline item identity', () => {
    const cache = createTimelineProjectionCache()
    const first = userMessage('entry-user', 'hello')
    const initial = projectTimelineItems(input([first]), undefined, cache)
    const appended = projectTimelineItems(
      input([first, assistantTextMessage('entry-assistant', 'done')]),
      initial,
      cache
    )
    expect(appended[0]).toBe(initial[0])
    expect(appended.map((item) => item.key)).toEqual(['entry-user', 'entry-assistant:text:0'])
  })
})

function input(
  messages: Message[],
  tools: DesktopToolCall[] = [],
  hideThinkingBlock = false,
  state: (message: Message) => MessageRenderState = getMessageRenderState
): Parameters<typeof createTimelineItems>[0] {
  return {
    messages,
    toolCallStructures: tools,
    getMessageRenderState: state,
    resolveTimelineToolCall: (id: string) => tools.find((tool) => tool.toolCallId === id),
    getToolResultMessageToolCall: (message: Message) =>
      message.role === 'tool'
        ? tools.find((tool) => tool.toolCallId === message.toolCallId)
        : undefined,
    hideThinkingBlock
  }
}

function timeline(
  messages: Message[],
  tools: DesktopToolCall[] = [],
  hideThinkingBlock = false
): TimelineItem[] {
  return createTimelineItems(input(messages, tools, hideThinkingBlock))
}

function userMessage(id: string, content: string): Message {
  return { id, role: 'user', content }
}
function reasoningMessage(id: string, content: string): Message {
  return { id, role: 'reasoning', content }
}
function compactionMessage(id: string): Message {
  return { id, role: 'system', content: 'summary', name: 'compaction' }
}
function assistantTextMessage(id: string, content: string): Message {
  return { id, role: 'assistant', content }
}
function assistantToolMessage(id: string, ids: string[]): Message {
  return assistantTextToolMessage(id, '', ids)
}
function assistantTextToolMessage(id: string, content: string, ids: string[]): Message {
  const toolCalls: ToolCall[] = ids.map((toolCallId) => ({
    id: toolCallId,
    type: 'function',
    function: { name: 'tool', arguments: '{}' }
  }))
  return { id, role: 'assistant', ...(content ? { content } : {}), toolCalls }
}
function toolCall(toolCallId: string, toolName: string): DesktopToolCall {
  return { threadId: 'thread-a', toolCallId, toolName, status: 'succeeded', args: {} }
}
function getMessageRenderState(): MessageRenderState {
  return { revision: 1, renderState: 'complete' }
}
function runtimeEvent(): WorkspaceRuntimeTimelineEvent {
  return {
    id: 'worker-crash:worker-a:1000',
    type: 'worker-error' as const,
    title: 'Worker 已崩溃',
    message: 'worker exited unexpectedly',
    createdAt: '2026-07-09T00:00:01.000Z',
    meta: ['worker', 'crash']
  }
}
function runtimeItem(): TimelineItem {
  const event = runtimeEvent()
  return {
    type: 'runtime-event',
    key: `runtime-event:${event.id}`,
    event,
    message: {
      id: `runtime-event:${event.id}`,
      role: 'system',
      content: event.message,
      name: 'agentEvent'
    }
  }
}
