/**
 * 本文件测试 Pi AgentMessage 到 desktop message 的共享转换。
 */

import { describe, expect, it } from 'vitest'
import {
  toDesktopFileChanges,
  toDesktopMessageContent,
  toDesktopMessages,
  toDesktopToolCalls
} from '../protocol/message.ts'
import type { AgentMessage } from '@earendil-works/pi-agent-core'

describe('desktop message conversion', () => {
  it('复用同一套 Pi AgentMessage 文本、角色和时间戳转换', () => {
    const timestamp = Date.parse('2026-07-01T00:00:00.000Z')
    const messages: AgentMessage[] = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' }],
        api: 'responses',
        provider: 'openai',
        model: 'gpt-5',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: 'stop',
        timestamp
      },
      {
        role: 'toolResult',
        content: 'done',
        toolCallId: 'tool-a',
        toolName: 'read'
      }
    ]

    expect(toDesktopMessageContent(messages[0]!)).toEqual({
      role: 'assistant',
      text: 'hello',
      raw: messages[0],
      createdAt: '2026-07-01T00:00:00.000Z'
    })
    expect(toDesktopMessageContent(messages[1]!)).toBeUndefined()
    expect(toDesktopMessages(messages)).toEqual([
      {
        id: 'message-0',
        role: 'assistant',
        text: 'hello',
        raw: messages[0],
        createdAt: '2026-07-01T00:00:00.000Z'
      }
    ])
  })

  it('只给 user/assistant 消息附加 session entry ID', () => {
    const messages: AgentMessage[] = [
      {
        role: 'custom',
        content: 'compacted context',
        customType: 'compaction',
        timestamp: Date.parse('2026-07-01T00:00:00.000Z')
      },
      { role: 'user', content: 'hello', timestamp: 1 },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'world' }],
        api: 'responses',
        provider: 'openai',
        model: 'gpt-5',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: 'stop',
        timestamp: 2
      }
    ]

    expect(
      toDesktopMessages(messages, ['entry-user', 'entry-assistant']).map((message) => ({
        role: message.role,
        text: message.text,
        sessionEntryId: message.sessionEntryId
      }))
    ).toEqual([
      { role: 'system', text: 'compacted context', sessionEntryId: undefined },
      { role: 'user', text: 'hello', sessionEntryId: 'entry-user' },
      { role: 'assistant', text: 'world', sessionEntryId: 'entry-assistant' }
    ])
  })

  it('跳过没有文本内容的 assistant 消息', () => {
    const message: AgentMessage = {
      role: 'assistant',
      content: [],
      api: 'responses',
      provider: 'openai',
      model: 'gpt-5',
      usage: {
        input: 1,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 1,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: 'tool_use'
    }

    expect(toDesktopMessageContent(message)).toBeUndefined()
    expect(toDesktopMessages([message])).toEqual([])
  })

  it('将模型请求失败投影为系统消息', () => {
    const timestamp = Date.parse('2026-07-01T00:00:00.000Z')
    const message: AgentMessage = {
      role: 'assistant',
      content: [],
      api: 'responses',
      provider: 'openai',
      model: 'gpt-5',
      usage: {
        input: 1,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 1,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: 'error',
      errorMessage: '429: rate limit exceeded',
      timestamp
    }

    expect(toDesktopMessageContent(message)).toEqual({
      role: 'system',
      text: '模型请求失败：429: rate limit exceeded',
      raw: message,
      createdAt: '2026-07-01T00:00:00.000Z',
      systemEvent: {
        kind: 'agentEvent',
        title: '模型请求失败',
        description: '后端模型请求返回错误，当前响应已中止。',
        meta: ['provider openai', 'model gpt-5']
      }
    })
    expect(toDesktopMessages([message])).toEqual([
      {
        id: 'message-0',
        role: 'system',
        text: '模型请求失败：429: rate limit exceeded',
        raw: message,
        createdAt: '2026-07-01T00:00:00.000Z',
        systemEvent: {
          kind: 'agentEvent',
          title: '模型请求失败',
          description: '后端模型请求返回错误，当前响应已中止。',
          meta: ['provider openai', 'model gpt-5']
        }
      }
    ])
  })

  it('assistant raw 展示内容不重复暴露 toolCall block', () => {
    const message: AgentMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: '我先读文件' },
        { type: 'toolCall', id: 'tool-a', name: 'read', arguments: { path: 'README.md' } }
      ],
      api: 'responses',
      provider: 'openai',
      model: 'gpt-5',
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: 'toolUse'
    }

    expect(toDesktopMessageContent(message)).toMatchObject({
      role: 'assistant',
      text: '我先读文件',
      toolCallIds: ['tool-a'],
      raw: {
        role: 'assistant',
        content: [{ type: 'text', text: '我先读文件' }]
      }
    })
  })

  it('assistant error 不导出未执行 toolCall，避免错误消息渲染准备中的工具', () => {
    const message: AgentMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: '正在编辑文件' },
        { type: 'toolCall', id: 'tool-edit', name: 'edit', arguments: { path: 'src/app.ts' } }
      ],
      api: 'responses',
      provider: 'openai',
      model: 'gpt-5',
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: 'error',
      errorMessage: 'stream_read_error'
    }

    expect(toDesktopMessageContent(message)).toMatchObject({
      role: 'system',
      text: '模型请求失败：stream_read_error',
      systemEvent: { title: '模型请求失败' }
    })
    expect(toDesktopMessageContent(message)?.toolCallIds).toBeUndefined()
    expect(toDesktopToolCalls([message], 'thread-1')).toEqual([])
    expect(toDesktopFileChanges([message], 'thread-1')).toEqual([])
  })

  it('从 assistant toolCall 建立工具投影，toolResult 只更新结果', () => {
    const messages: AgentMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'tool-a', name: 'read', arguments: { path: 'README.md' } }
        ],
        api: 'responses',
        provider: 'openai',
        model: 'gpt-5',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: 'toolUse'
      },
      {
        role: 'toolResult',
        content: [{ type: 'text', text: 'file content' }],
        toolCallId: 'tool-a',
        isError: false,
        timestamp: Date.parse('2026-07-01T00:00:00.000Z')
      } as AgentMessage
    ]

    expect(toDesktopMessages(messages)).toEqual([
      {
        id: 'message-0',
        role: 'assistant',
        toolCallIds: ['tool-a'],
        raw: {
          ...messages[0],
          content: []
        },
        createdAt: undefined
      }
    ])
    expect(toDesktopToolCalls(messages, 'thread-1')).toMatchObject([
      {
        threadId: 'thread-1',
        toolCallId: 'tool-a',
        toolName: 'read',
        status: 'succeeded',
        args: { path: 'README.md' },
        result: { content: [{ type: 'text', text: 'file content' }] },
        resultSummary: 'file content',
        finishedAt: '2026-07-01T00:00:00.000Z'
      }
    ])
  })

  it('忽略没有 assistant toolCall 的孤儿 toolResult', () => {
    const messages: AgentMessage[] = [
      {
        role: 'toolResult',
        content: [{ type: 'text', text: 'orphan' }],
        toolCallId: 'tool-orphan',
        isError: false
      } as AgentMessage
    ]

    expect(toDesktopMessages(messages)).toEqual([])
    expect(toDesktopToolCalls(messages, 'thread-1')).toEqual([])
  })

  it('将 compaction summary 投影为 desktop system event', () => {
    const timestamp = Date.parse('2026-07-01T00:00:00.000Z')
    const message: AgentMessage = {
      role: 'compactionSummary',
      summary: '保留了最近的实现计划和文件修改。',
      tokensBefore: 128000,
      timestamp
    }

    expect(toDesktopMessageContent(message)).toEqual({
      role: 'system',
      text: '保留了最近的实现计划和文件修改。',
      raw: message,
      createdAt: '2026-07-01T00:00:00.000Z',
      systemEvent: {
        kind: 'compaction',
        title: '上下文已压缩',
        description: '之前的对话历史已压缩为摘要，并保留在当前 session 中。',
        meta: ['压缩前 128,000 tokens']
      }
    })
    expect(toDesktopMessages([message])).toEqual([
      {
        id: 'message-0',
        role: 'system',
        text: '保留了最近的实现计划和文件修改。',
        raw: message,
        createdAt: '2026-07-01T00:00:00.000Z',
        systemEvent: {
          kind: 'compaction',
          title: '上下文已压缩',
          description: '之前的对话历史已压缩为摘要，并保留在当前 session 中。',
          meta: ['压缩前 128,000 tokens']
        }
      }
    ])
  })

  it('从 edit tool result 派生文件 diff projection', () => {
    const messages: AgentMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'tool-edit', name: 'edit', arguments: { path: 'src/app.ts' } }
        ],
        api: 'responses',
        provider: 'openai',
        model: 'gpt-5',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: 'toolUse',
        timestamp: 1
      },
      {
        role: 'toolResult',
        content: [{ type: 'text', text: 'Successfully replaced 1 block(s) in src/app.ts.' }],
        toolCallId: 'tool-edit',
        isError: false,
        timestamp: Date.parse('2026-07-01T00:00:00.000Z'),
        details: {
          diff: '-1 old\n+1 new\n 2 context',
          patch: '--- src/app.ts\n+++ src/app.ts\n@@\n-old\n+new\n',
          firstChangedLine: 1
        }
      } as AgentMessage
    ]

    expect(toDesktopFileChanges(messages, 'thread-1')).toEqual([
      {
        threadId: 'thread-1',
        toolCallId: 'tool-edit',
        path: 'src/app.ts',
        changeType: 'updated',
        diff: '-1 old\n+1 new\n 2 context',
        patch: '--- src/app.ts\n+++ src/app.ts\n@@\n-old\n+new\n',
        additions: 1,
        deletions: 1,
        firstChangedLine: 1,
        createdAt: '2026-07-01T00:00:00.000Z'
      }
    ])
  })

  it('按文件合并多次 edit projection 并保持首次出现顺序', () => {
    const messages: AgentMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'tool-app-a', name: 'edit', arguments: { path: 'src/app.ts' } },
          {
            type: 'toolCall',
            id: 'tool-readme',
            name: 'edit',
            arguments: { path: 'README.md' }
          },
          {
            type: 'toolCall',
            id: 'tool-app-b',
            name: 'edit',
            arguments: { path: 'H:\\repo\\src\\app.ts' }
          }
        ],
        api: 'responses',
        provider: 'openai',
        model: 'gpt-5',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: 'toolUse',
        timestamp: 1
      },
      {
        role: 'toolResult',
        content: 'edited app once',
        toolCallId: 'tool-app-a',
        isError: false,
        timestamp: Date.parse('2026-07-01T00:00:01.000Z'),
        details: {
          diff: '-8 old\n+8 first',
          patch: '@@ app-a\n-old\n+first\n',
          firstChangedLine: 8
        }
      } as AgentMessage,
      {
        role: 'toolResult',
        content: 'edited readme',
        toolCallId: 'tool-readme',
        isError: false,
        timestamp: Date.parse('2026-07-01T00:00:02.000Z'),
        details: {
          diff: '-1 before\n+1 after',
          patch: '@@ readme\n-before\n+after\n',
          firstChangedLine: 1
        }
      } as AgentMessage,
      {
        role: 'toolResult',
        content: 'edited app twice',
        toolCallId: 'tool-app-b',
        isError: false,
        timestamp: Date.parse('2026-07-01T00:00:03.000Z'),
        details: {
          patch: '@@ app-b\n-first\n+second\n+extra\n',
          firstChangedLine: 3
        }
      } as AgentMessage
    ]

    expect(toDesktopFileChanges(messages, 'thread-1', 'H:\\repo')).toEqual([
      {
        threadId: 'thread-1',
        toolCallId: 'tool-app-a',
        path: 'src/app.ts',
        changeType: 'updated',
        diff: '-8 old\n+8 first\n@@ app-b\n-first\n+second\n+extra',
        patch: '@@ app-a\n-old\n+first\n@@ app-b\n-first\n+second\n+extra',
        additions: 3,
        deletions: 2,
        firstChangedLine: 3,
        createdAt: '2026-07-01T00:00:01.000Z'
      },
      {
        threadId: 'thread-1',
        toolCallId: 'tool-readme',
        path: 'README.md',
        changeType: 'updated',
        diff: '-1 before\n+1 after',
        patch: '@@ readme\n-before\n+after\n',
        additions: 1,
        deletions: 1,
        firstChangedLine: 1,
        createdAt: '2026-07-01T00:00:02.000Z'
      }
    ])
  })
})
