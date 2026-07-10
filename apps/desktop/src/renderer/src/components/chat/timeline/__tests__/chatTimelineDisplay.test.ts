import { describe, expect, it } from 'vitest'
import type { DesktopToolCall } from '@coding-agent-desktop-src/protocol/tool'
import type { MessageRenderState } from '@renderer/stores/workspace-session'
import type { ThreadMessage } from '@shared/coding-agent/types'
import {
  createDisplayTimelineItems,
  createProcessingCollapseResult,
  createTimelineItems,
  stabilizeTimelineItems
} from '../chatTimelineDisplay'

describe('chatTimelineDisplay', () => {
  it('thinking 隐藏时，将连续纯工具 assistant 消息聚合为一个稳定工具组', () => {
    const toolCalls = [
      toolCall('tool-read', 'read', { path: 'src/a.ts' }),
      toolCall('tool-edit', 'edit', { path: 'src/a.ts' }),
      toolCall('tool-bash', 'bash', { command: 'pnpm test' })
    ]
    const items = createTimelineItems({
      messages: [
        assistantToolMessage('message-a', ['tool-read'], 'thinking before read'),
        assistantToolMessage('message-b', ['tool-edit'], 'thinking before edit'),
        assistantToolMessage('message-c', ['tool-bash'])
      ],
      toolCallStructures: [],
      getMessageRenderState,
      resolveTimelineToolCall: (toolCallId) =>
        toolCalls.find((toolCall) => toolCall.toolCallId === toolCallId),
      getToolResultMessageToolCall: () => undefined,
      hideThinkingBlock: true
    })

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
    const toolCalls = [
      toolCall('tool-read', 'read', { path: 'src/a.ts' }),
      toolCall('tool-edit', 'edit', { path: 'src/a.ts' })
    ]
    const items = createTimelineItems({
      messages: [
        assistantToolMessage('message-a', ['tool-read'], 'thinking before read'),
        assistantToolMessage('message-b', ['tool-edit'], 'thinking before edit')
      ],
      toolCallStructures: [],
      getMessageRenderState,
      resolveTimelineToolCall: (toolCallId) =>
        toolCalls.find((toolCall) => toolCall.toolCallId === toolCallId),
      getToolResultMessageToolCall: () => undefined,
      hideThinkingBlock: false
    })

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
    const toolCalls = [
      toolCall('tool-bash-a', 'bash', { command: 'pnpm test' }),
      toolCall('tool-bash-b', 'bash', { command: 'pnpm run typecheck:web' }),
      toolCall('tool-memory', 'memory', {})
    ]
    const items = createTimelineItems({
      messages: [
        assistantTextToolMessage('message-a', '格式化完成，继续复跑测试和 web typecheck。', [
          'tool-bash-a',
          'tool-bash-b'
        ]),
        assistantToolMessage('message-b', ['tool-memory'])
      ],
      toolCallStructures: [],
      getMessageRenderState,
      resolveTimelineToolCall: (toolCallId) =>
        toolCalls.find((toolCall) => toolCall.toolCallId === toolCallId),
      getToolResultMessageToolCall: () => undefined,
      hideThinkingBlock: true
    })

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
    const message = userMessage('user-a', 'hello')
    const runningTool = toolCall('tool-read', 'read', { path: 'src/a.ts' })
    runningTool.status = 'running'
    const completedTool = { ...runningTool, status: 'succeeded' as const, result: 'done' }

    const createItems = (tool: DesktopToolCall): ReturnType<typeof createTimelineItems> =>
      createTimelineItems({
        messages: [message, assistantToolMessage('assistant-a', [tool.toolCallId])],
        toolCallStructures: [tool],
        getMessageRenderState,
        resolveTimelineToolCall: () => ({ ...tool }),
        getToolResultMessageToolCall: () => undefined,
        hideThinkingBlock: true
      })

    const initial = stabilizeTimelineItems(createItems(runningTool), undefined)
    const completed = stabilizeTimelineItems(createItems(completedTool), initial)
    const unchanged = stabilizeTimelineItems(createItems(completedTool), completed)

    expect(completed).not.toBe(initial)
    expect(completed[0]).toBe(initial[0])
    expect(completed[1]).not.toBe(initial[1])
    expect(completed[1]?.type).toBe('tool-group')
    expect(unchanged).toBe(completed)
  })

  it('相同投影重新排序时保留新顺序', () => {
    const first = userMessage('user-a', 'first')
    const second = userMessage('user-b', 'second')
    const initial = stabilizeTimelineItems(
      [first, second].map((message) => ({
        type: 'message' as const,
        key: message.id,
        message,
        revision: 1,
        renderState: 'complete' as const
      })),
      undefined
    )
    const reordered = stabilizeTimelineItems(
      [second, first].map((message) => ({
        type: 'message' as const,
        key: message.id,
        message,
        revision: 1,
        renderState: 'complete' as const
      })),
      initial
    )

    expect(reordered.map((item) => item.key)).toEqual(['user-b', 'user-a'])
    expect(reordered[0]).toBe(initial[1])
    expect(reordered[1]).toBe(initial[0])
  })

  it('处理段 key 不随 user 后面的 timeline item 数量变化', () => {
    const baseItems = createTimelineItems({
      messages: [
        userMessage('user-a', 'hello'),
        assistantToolMessage('assistant-a', ['tool-read'])
      ],
      toolCallStructures: [toolCall('tool-read', 'read', { path: 'src/a.ts' })],
      getMessageRenderState,
      resolveTimelineToolCall: (toolCallId) =>
        toolCallId === 'tool-read'
          ? toolCall('tool-read', 'read', { path: 'src/a.ts' })
          : undefined,
      getToolResultMessageToolCall: () => undefined,
      hideThinkingBlock: true
    })
    const appendedItems = createTimelineItems({
      messages: [
        userMessage('user-a', 'hello'),
        assistantToolMessage('assistant-a', ['tool-read']),
        assistantToolMessage('assistant-b', ['tool-edit'])
      ],
      toolCallStructures: [
        toolCall('tool-read', 'read', { path: 'src/a.ts' }),
        toolCall('tool-edit', 'edit', { path: 'src/a.ts' })
      ],
      getMessageRenderState,
      resolveTimelineToolCall: (toolCallId) =>
        toolCallId === 'tool-read'
          ? toolCall('tool-read', 'read', { path: 'src/a.ts' })
          : toolCallId === 'tool-edit'
            ? toolCall('tool-edit', 'edit', { path: 'src/a.ts' })
            : undefined,
      getToolResultMessageToolCall: () => undefined,
      hideThinkingBlock: true
    })

    const baseResult = createProcessingCollapseResult({
      items: baseItems,
      isRunning: true,
      activeSessionId: 'thread-a',
      now: Date.now()
    })
    const appendedResult = createProcessingCollapseResult({
      items: appendedItems,
      isRunning: true,
      activeSessionId: 'thread-a',
      now: Date.now()
    })

    expect(baseResult.contexts[0]?.key).toBe('thread-a:user-a')
    expect(appendedResult.contexts[0]?.key).toBe('thread-a:user-a')
  })

  it('压缩分割线不会让之前消息折叠为处理段', () => {
    const timelineItems = createTimelineItems({
      messages: [
        userMessage('user-a', 'hello'),
        compactionMessage('compaction-a'),
        assistantTextMessage('assistant-a', '继续')
      ],
      toolCallStructures: [],
      getMessageRenderState,
      resolveTimelineToolCall: () => undefined,
      getToolResultMessageToolCall: () => undefined,
      hideThinkingBlock: true
    })
    const collapseResult = createProcessingCollapseResult({
      items: timelineItems,
      isRunning: false,
      activeSessionId: 'thread-a',
      now: Date.now()
    })

    const displayItems = createDisplayTimelineItems({
      timelineItems,
      contexts: collapseResult.contexts,
      isCollapsedHistoryOpen: () => false
    })

    expect(collapseResult.contexts).toHaveLength(0)
    expect(displayItems.map((item) => item.type)).toEqual([
      'message',
      'compaction-divider',
      'message'
    ])
  })

  it('将压缩系统消息转换为分割线 timeline item', () => {
    const items = createTimelineItems({
      messages: [
        userMessage('user-a', 'hello'),
        compactionMessage('compaction-a'),
        assistantTextMessage('assistant-a', '继续')
      ],
      toolCallStructures: [],
      getMessageRenderState,
      resolveTimelineToolCall: () => undefined,
      getToolResultMessageToolCall: () => undefined,
      hideThinkingBlock: true
    })

    expect(items).toMatchObject([
      { type: 'message', key: 'user-a' },
      { type: 'compaction-divider', key: 'compaction-a:compaction' },
      { type: 'message', key: 'assistant-a:text:0' }
    ])
  })

  it('raw content 缺少 toolCall block 时仍按 message.toolCallIds 消费工具', () => {
    const toolCalls = [
      toolCall('tool-read', 'read', { path: 'src/a.ts' }),
      toolCall('tool-edit', 'edit', { path: 'src/a.ts' })
    ]
    const items = createTimelineItems({
      messages: [
        assistantTextWithExternalToolIds('message-a', '读取', ['tool-read']),
        assistantTextWithExternalToolIds('message-b', '编辑', ['tool-edit'])
      ],
      toolCallStructures: toolCalls,
      getMessageRenderState,
      resolveTimelineToolCall: (toolCallId) =>
        toolCalls.find((toolCall) => toolCall.toolCallId === toolCallId),
      getToolResultMessageToolCall: () => undefined,
      hideThinkingBlock: true
    })

    expect(items.map((item) => item.type)).toEqual([
      'message',
      'tool-group',
      'message',
      'tool-group'
    ])
    expect(items[1]).toMatchObject({ key: 'tool-group:tool-read', toolCallIds: ['tool-read'] })
    expect(items[3]).toMatchObject({ key: 'tool-group:tool-edit', toolCallIds: ['tool-edit'] })
  })

  it('同一 assistant 的可见文本先渲染，toolCallIds 随后补为单个工具组', () => {
    const toolCalls = [
      toolCall('tool-read', 'read', { path: 'src/a.ts' }),
      toolCall('tool-edit', 'edit', { path: 'src/a.ts' })
    ]
    const items = createTimelineItems({
      messages: [
        assistantTextWithExternalToolIds('message-a', '准备修改', ['tool-read', 'tool-edit'])
      ],
      toolCallStructures: [],
      getMessageRenderState,
      resolveTimelineToolCall: (toolCallId) =>
        toolCalls.find((toolCall) => toolCall.toolCallId === toolCallId),
      getToolResultMessageToolCall: () => undefined,
      hideThinkingBlock: false
    })

    expect(items.map((item) => item.type)).toEqual(['message', 'tool-group'])
    expect(items[0]).toMatchObject({ key: 'message-a:text:0', text: '准备修改' })
    expect(items[1]).toMatchObject({
      key: 'tool-group:tool-read',
      toolCallIds: ['tool-read', 'tool-edit']
    })
  })

  it('有文本的 assistant 会打断纯工具聚合', () => {
    const toolCalls = [
      toolCall('tool-read', 'read', { path: 'src/a.ts' }),
      toolCall('tool-edit', 'edit', { path: 'src/a.ts' })
    ]
    const items = createTimelineItems({
      messages: [
        assistantToolMessage('message-a', ['tool-read']),
        assistantTextMessage('message-b', '准备修改'),
        assistantToolMessage('message-c', ['tool-edit'])
      ],
      toolCallStructures: [],
      getMessageRenderState,
      resolveTimelineToolCall: (toolCallId) =>
        toolCalls.find((toolCall) => toolCall.toolCallId === toolCallId),
      getToolResultMessageToolCall: () => undefined,
      hideThinkingBlock: false
    })

    expect(items.map((item) => item.type)).toEqual(['tool-group', 'message', 'tool-group'])
    expect(items[0]).toMatchObject({ key: 'tool-group:tool-read', toolCallIds: ['tool-read'] })
    expect(items[2]).toMatchObject({ key: 'tool-group:tool-edit', toolCallIds: ['tool-edit'] })
  })

  it('将 worker 异常作为 runtime system item 追加到 timeline', () => {
    const items = createTimelineItems({
      messages: [userMessage('user-a', 'hello')],
      toolCallStructures: [],
      runtimeEvents: [
        {
          id: 'worker-crash:worker-a:1000',
          type: 'worker-error',
          title: 'Worker 已崩溃',
          message: 'worker exited unexpectedly',
          createdAt: '2026-07-09T00:00:01.000Z',
          meta: ['worker', 'crash']
        }
      ],
      getMessageRenderState,
      resolveTimelineToolCall: () => undefined,
      getToolResultMessageToolCall: () => undefined,
      hideThinkingBlock: false
    })

    expect(items).toMatchObject([
      { type: 'message', key: 'user-a' },
      {
        type: 'runtime-event',
        key: 'runtime-event:worker-crash:worker-a:1000',
        message: {
          role: 'system',
          text: 'worker exited unexpectedly',
          systemEvent: {
            kind: 'agentEvent',
            title: 'Worker 已崩溃',
            description: 'worker exited unexpectedly',
            meta: ['worker', 'crash']
          }
        }
      }
    ])
  })

  it('worker 异常按发生时间停留在恢复后的新消息之前', () => {
    const beforeCrash = userMessage('user-before-crash', 'start')
    beforeCrash.createdAt = '2026-07-09T00:00:00.000Z'
    const resumed = userMessage('user-after-resume', 'continue')
    resumed.createdAt = '2026-07-09T00:00:02.000Z'
    const reply = assistantTextMessage('assistant-after-resume', 'done')
    reply.createdAt = '2026-07-09T00:00:03.000Z'

    const items = createTimelineItems({
      messages: [beforeCrash, resumed, reply],
      toolCallStructures: [],
      runtimeEvents: [
        {
          id: 'worker-crash:worker-a:1000',
          type: 'worker-error',
          title: 'Worker 已崩溃',
          message: 'worker exited unexpectedly',
          createdAt: '2026-07-09T00:00:01.000Z',
          meta: ['worker', 'crash']
        }
      ],
      getMessageRenderState,
      resolveTimelineToolCall: () => undefined,
      getToolResultMessageToolCall: () => undefined,
      hideThinkingBlock: false
    })

    expect(items.map((item) => item.key)).toEqual([
      'user-before-crash',
      'runtime-event:worker-crash:worker-a:1000',
      'user-after-resume',
      'assistant-after-resume:text:0'
    ])
  })
})

function userMessage(id: string, text: string): ThreadMessage {
  return {
    id,
    role: 'user',
    text,
    raw: {
      role: 'user',
      content: [{ type: 'text', text }]
    } as ThreadMessage['raw']
  }
}

function compactionMessage(id: string): ThreadMessage {
  return {
    id,
    role: 'system',
    text: 'summary',
    systemEvent: {
      kind: 'compaction',
      title: '上下文已压缩'
    },
    raw: {
      role: 'compactionSummary',
      summary: 'summary',
      tokensBefore: 120000,
      timestamp: Date.now()
    } as ThreadMessage['raw']
  }
}

function assistantToolMessage(id: string, toolCallIds: string[], thinking?: string): ThreadMessage {
  return {
    id,
    role: 'assistant',
    raw: {
      role: 'assistant',
      content: thinking ? [{ type: 'thinking', thinking }] : []
    } as ThreadMessage['raw'],
    toolCallIds
  }
}

function assistantTextWithExternalToolIds(
  id: string,
  text: string,
  toolCallIds: string[]
): ThreadMessage {
  return {
    id,
    role: 'assistant',
    text,
    raw: {
      role: 'assistant',
      content: [{ type: 'text', text }]
    } as ThreadMessage['raw'],
    toolCallIds
  }
}

function assistantTextMessage(id: string, text: string): ThreadMessage {
  return assistantTextToolMessage(id, text, [])
}

function assistantTextToolMessage(id: string, text: string, toolCallIds: string[]): ThreadMessage {
  return {
    id,
    role: 'assistant',
    text,
    raw: {
      role: 'assistant',
      content: [{ type: 'text', text }]
    } as ThreadMessage['raw'],
    ...(toolCallIds.length > 0 ? { toolCallIds } : {})
  }
}

function toolCall(toolCallId: string, toolName: string, args: unknown): DesktopToolCall {
  return {
    threadId: 'thread-a',
    toolCallId,
    toolName,
    status: 'succeeded',
    args
  }
}

function getMessageRenderState(): MessageRenderState {
  return { revision: 1, renderState: 'complete' }
}
