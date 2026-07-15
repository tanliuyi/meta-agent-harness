import { describe, expect, it } from 'vitest'
import type { ChatUIMessage } from '../types'
import { projectChatDisplay } from '../chat-display'

describe('AG-UI chat display projection', () => {
  it('聚合跨 message 的连续工具并保持稳定 key', () => {
    const messages = [
      assistant('assistant-a', [tool('read-1', 'read', '{"path":"a.ts"}')]),
      assistant('assistant-b', [tool('edit-1', 'edit', '{"path":"a.ts"}')])
    ]
    const projection = project(messages)

    expect(projection.issues).toEqual([])
    expect(projection.items).toMatchObject([
      {
        type: 'tool-group',
        key: 'read-1',
        toolCallIds: ['read-1', 'edit-1'],
        summary: '已读取 1 文件，已编辑 1 文件'
      }
    ])
  })

  it('text 和 thinking 会打断工具聚合', () => {
    const projection = project([
      assistant('assistant-a', [tool('read-1', 'read')]),
      assistant('assistant-b', [{ type: 'text', content: '继续' }]),
      assistant('assistant-c', [tool('edit-1', 'edit')]),
      assistant('assistant-d', [{ type: 'thinking', content: '检查' }]),
      assistant('assistant-e', [tool('write-1', 'write')])
    ])

    expect(projection.items.map((item) => item.type)).toEqual([
      'tool-group',
      'message',
      'tool-group',
      'message',
      'tool-group'
    ])
  })

  it('通过 toolCallId 合并结果且不修改源消息', () => {
    const source = assistant('assistant-a', [
      tool('read-1', 'read'),
      { type: 'tool-result', toolCallId: 'read-1', content: 'content', state: 'complete' }
    ])
    const original = structuredClone(source)
    const projection = project([source])
    const group = projection.items[0]

    expect(group?.type).toBe('tool-group')
    if (group?.type !== 'tool-group') throw new Error('expected tool group')
    expect(group.toolCalls[0]?.output).toBe('content')
    expect(source).toEqual(original)
  })

  it('孤立结果生成显式协议错误', () => {
    const projection = project([
      assistant('assistant-a', [
        { type: 'tool-result', toolCallId: 'missing', content: 'nope', state: 'error' }
      ])
    ])

    expect(projection.issues).toMatchObject([
      { code: 'orphan-tool-result', messageId: 'assistant-a', toolCallId: 'missing' }
    ])
    expect(projection.items).toMatchObject([
      { type: 'protocol-error', issue: { code: 'orphan-tool-result' } }
    ])
  })

  it('重复 toolCallId 和非法终态参数会返回准确 issue', () => {
    const projection = project([
      assistant('assistant-a', [tool('read-1', 'read', '{broken'), tool('read-1', 'read', '{}')])
    ])

    expect(projection.issues.map((issue) => issue.code)).toEqual([
      'invalid-tool-arguments',
      'duplicate-tool-call-id'
    ])
    const group = projection.items.find((item) => item.type === 'tool-group')
    expect(group?.type === 'tool-group' && group.toolCalls[0]?.rawArguments).toBe('{broken')
  })

  it('重复工具结果生成可见协议错误项', () => {
    const projection = project([
      assistant('assistant-a', [
        tool('read-1', 'read'),
        { type: 'tool-result', toolCallId: 'read-1', content: 'first', state: 'complete' },
        { type: 'tool-result', toolCallId: 'read-1', content: 'second', state: 'complete' }
      ])
    ])

    expect(projection.issues).toMatchObject([{ code: 'duplicate-tool-result' }])
    expect(projection.items.some((item) => item.type === 'protocol-error')).toBe(true)
  })

  it('工具结果状态使用穷尽映射且非法状态显式报错', () => {
    const streaming = project([
      assistant('assistant-a', [
        tool('read-1', 'read'),
        { type: 'tool-result', toolCallId: 'read-1', content: 'partial', state: 'streaming' }
      ])
    ])
    expect(streaming.items[0]).toMatchObject({ type: 'tool-group', status: 'running' })

    const invalidResult = {
      type: 'tool-result',
      toolCallId: 'read-1',
      content: 'invalid',
      state: 'mystery-state'
    } as unknown as ChatUIMessage['parts'][number]
    const invalid = project([assistant('assistant-a', [tool('read-1', 'read'), invalidResult])])
    expect(invalid.issues).toMatchObject([
      { code: 'invalid-tool-result-state', messageId: 'assistant-a', toolCallId: 'read-1' }
    ])
    expect(invalid.items.some((item) => item.type === 'protocol-error')).toBe(true)
  })

  it('流式参数未完成时不误报 JSON 错误', () => {
    const projection = project([
      assistant('assistant-a', [{ ...tool('read-1', 'read', '{"pa'), state: 'input-streaming' }])
    ])
    expect(projection.issues).toEqual([])
    expect(projection.items[0]).toMatchObject({ type: 'tool-group', status: 'running' })
  })

  it('非法工具状态和缺失消息 ID 不使用默认值兜底', () => {
    const invalidState = {
      ...tool('read-1', 'read'),
      state: 'mystery-state'
    } as unknown as ChatUIMessage['parts'][number]
    const missingId = {
      id: '',
      role: 'assistant',
      parts: [{ type: 'text', content: 'missing id' }]
    } satisfies ChatUIMessage
    const projection = project([assistant('assistant-a', [invalidState]), missingId])

    expect(projection.issues.map((issue) => issue.code)).toEqual([
      'invalid-tool-state',
      'missing-message-id'
    ])
    expect(projection.items.map((item) => item.type)).toEqual(['protocol-error', 'protocol-error'])
  })

  it('运行中展示完整处理过程，完成后折叠并保留最终回复', () => {
    const messages = [
      user('user-a', '开始', 0),
      assistant('thinking-a', [{ type: 'thinking', content: '分析' }]),
      assistant('tool-a', [tool('read-1', 'read')]),
      assistant('final-a', [{ type: 'text', content: '完成' }], 5_000)
    ]

    const running = projectChatDisplay(messages, {
      stateKey: 'thread-a',
      isRunning: true,
      isHistoryOpen: () => false
    })
    expect(running.items.map((item) => item.type)).toEqual([
      'message',
      'collapsed-history',
      'message',
      'tool-group',
      'message'
    ])
    expect(running.items[1]).toMatchObject({ collapsible: false })

    const complete = projectChatDisplay(messages, {
      stateKey: 'thread-a',
      isRunning: false,
      isHistoryOpen: () => false
    })
    expect(complete.items.map((item) => item.type)).toEqual([
      'message',
      'collapsed-history',
      'message'
    ])
    expect(complete.items[1]).toMatchObject({
      key: 'thread-a:user-a',
      hiddenCount: 2,
      durationLabel: '5s',
      collapsible: true
    })
  })

  it('展开历史后恢复处理项，system 在折叠时始终可见', () => {
    const messages = [
      user('user-a', '开始'),
      assistant('thinking-a', [{ type: 'thinking', content: '分析' }]),
      { id: 'system-a', role: 'system', parts: [{ type: 'text', content: '通知' }] },
      assistant('final-a', [{ type: 'text', content: '完成' }])
    ] satisfies ChatUIMessage[]

    const collapsed = project(messages)
    expect(collapsed.items.map((item) => item.type)).toEqual([
      'message',
      'collapsed-history',
      'message',
      'message'
    ])

    const expanded = projectChatDisplay(messages, {
      stateKey: 'thread-a',
      isRunning: false,
      isHistoryOpen: () => true
    })
    expect(expanded.items.map((item) => item.type)).toEqual([
      'message',
      'collapsed-history',
      'message',
      'message',
      'message'
    ])
  })

  it('多个 user turn 不会重复展示边界消息', () => {
    const projection = project([
      user('user-a', '第一轮'),
      assistant('thinking-a', [{ type: 'thinking', content: '分析一' }]),
      assistant('final-a', [{ type: 'text', content: '完成一' }]),
      user('user-b', '第二轮'),
      assistant('thinking-b', [{ type: 'thinking', content: '分析二' }]),
      assistant('final-b', [{ type: 'text', content: '完成二' }])
    ])

    expect(projection.items.map((item) => item.key)).toEqual([
      'user-a',
      'thread-a:user-a',
      'final-a:part:0:text',
      'user-b',
      'thread-a:user-b',
      'final-b:part:0:text'
    ])
  })

  it('协议错误在折叠处理段中仍保持可见', () => {
    const projection = project([
      user('user-a', '开始'),
      assistant('thinking-a', [{ type: 'thinking', content: '分析' }]),
      assistant('broken-result', [
        { type: 'tool-result', toolCallId: 'missing', content: 'bad', state: 'error' }
      ]),
      assistant('final-a', [{ type: 'text', content: '完成' }])
    ])

    expect(projection.items.map((item) => item.type)).toEqual([
      'message',
      'collapsed-history',
      'protocol-error',
      'message'
    ])
  })
})

function project(messages: ChatUIMessage[]) {
  return projectChatDisplay(messages, {
    stateKey: 'thread-a',
    isRunning: false,
    isHistoryOpen: () => false
  })
}

function user(id: string, content: string, timestamp?: number): ChatUIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', content }],
    ...(timestamp !== undefined && { createdAt: new Date(timestamp) })
  }
}

function assistant(id: string, parts: ChatUIMessage['parts'], timestamp?: number): ChatUIMessage {
  return {
    id,
    role: 'assistant',
    parts,
    ...(timestamp !== undefined && { createdAt: new Date(timestamp) })
  }
}

function tool(id: string, name: string, args = '{}') {
  return {
    type: 'tool-call' as const,
    id,
    name,
    arguments: args,
    state: 'complete' as const
  }
}
