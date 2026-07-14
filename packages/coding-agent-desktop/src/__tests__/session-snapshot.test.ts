/**
 * 本文件测试从 Pi canonical JSONL session 重建 desktop snapshot。
 */

import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveSessionCwd, SessionManager } from '@earendil-works/pi-coding-agent'
import {
  buildSnapshotFromSession,
  readCanonicalSessionMessages,
  toDesktopSessionTreeChildren
} from '../storage/session-snapshot.ts'

const roots: string[] = []

/** 每个测试后清理临时目录。 */
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

/** buildSnapshotFromSession 测试套件。 */
describe('buildSnapshotFromSession', () => {
  it('为 AG-UI 直接读取包含工具 payload 的 Pi canonical messages', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-session-'))
    roots.push(root)
    const manager = SessionManager.create(join(root, 'repo'), join(root, 'sessions'))
    const assistantEntryId = manager.appendMessage({
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 'tool-read', name: 'read', arguments: { path: 'README.md' } }
      ],
      api: 'responses',
      provider: 'openai',
      model: 'gpt-test',
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
    })
    manager.appendMessage({
      role: 'toolResult',
      toolCallId: 'tool-read',
      toolName: 'read',
      content: [{ type: 'text', text: '# Project' }],
      isError: false,
      timestamp: 2
    })
    const sessionFile = manager.getSessionFile()
    if (!sessionFile) throw new Error('session file is required')

    const history = readCanonicalSessionMessages({ sessionFile })

    expect(history.messageEntryIds).toEqual([assistantEntryId])
    expect(history.messages).toMatchObject([
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'tool-read',
            name: 'read',
            arguments: { path: 'README.md' }
          }
        ]
      },
      {
        role: 'toolResult',
        toolCallId: 'tool-read',
        toolName: 'read',
        content: [{ type: 'text', text: '# Project' }]
      }
    ])
  })

  /** 验证使用 Pi SessionManager 读取 JSONL 并重建最小 snapshot。 */
  it('使用 Pi SessionManager 读取 JSONL 并重建最小 snapshot', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-session-'))
    roots.push(root)
    const cwd = join(root, 'repo')
    const sessionDir = join(root, 'sessions')
    const manager = SessionManager.create(cwd, sessionDir)
    const userEntryId = manager.appendMessage({ role: 'user', content: 'hello', timestamp: 1 })
    const assistantEntryId = manager.appendMessage({
      role: 'assistant',
      content: 'world',
      timestamp: 2
    })
    manager.appendModelChange('openai', 'gpt-test')
    manager.appendThinkingLevelChange('high')
    manager.appendSessionInfo('测试会话')
    const leafId = manager.getLeafId()
    const sessionFile = manager.getSessionFile()
    if (!sessionFile) {
      throw new Error('session file is required')
    }

    const snapshot = buildSnapshotFromSession({
      thread: {
        threadId: 'thread-1',
        cwd,
        status: 'stopped',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z'
      },
      sessionFile
    })

    expect(snapshot).toMatchObject({
      threadId: 'thread-1',
      cwd,
      sessionFile,
      title: '测试会话',
      status: 'stopped',
      model: { provider: 'openai', id: 'gpt-test' },
      thinkingLevel: 'high'
    })
    expect(
      snapshot.messages.map((message) => ({
        role: message.role,
        text: message.text,
        sessionEntryId: message.sessionEntryId
      }))
    ).toEqual([
      { role: 'user', text: 'hello', sessionEntryId: userEntryId },
      { role: 'assistant', text: 'world', sessionEntryId: assistantEntryId }
    ])
    expect(snapshot.currentEntryId).toBe(leafId)
    expect(snapshot.sessionTree).toMatchObject([
      {
        type: 'message',
        title: 'user: hello',
        children: [
          {
            type: 'message',
            title: 'assistant: world'
          }
        ]
      }
    ])
    expect(resolveSessionCwd(sessionFile, join(root, 'fallback'))).toBe(cwd)
    expect(resolveSessionCwd(sessionFile, join(root, 'fallback'), join(root, 'override'))).toBe(
      join(root, 'override')
    )
  })

  it('持久化 snapshot 的 sessionEntryId 跳过不可操作的 message entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-session-'))
    roots.push(root)
    const cwd = join(root, 'repo')
    const sessionDir = join(root, 'sessions')
    const manager = SessionManager.create(cwd, sessionDir)
    manager.appendCustomMessageEntry('note', 'system note', true)
    const userEntryId = manager.appendMessage({ role: 'user', content: 'hello', timestamp: 1 })
    manager.appendMessage({
      role: 'assistant',
      content: [],
      api: 'responses',
      provider: 'openai',
      model: 'gpt-test',
      usage: {
        input: 1,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 1,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: 'toolUse',
      timestamp: 2
    })
    const assistantEntryId = manager.appendMessage({
      role: 'assistant',
      content: 'world',
      timestamp: 3
    })
    const sessionFile = manager.getSessionFile()
    if (!sessionFile) {
      throw new Error('session file is required')
    }

    const snapshot = buildSnapshotFromSession({
      thread: {
        threadId: 'thread-1',
        cwd,
        status: 'stopped',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z'
      },
      sessionFile
    })

    expect(
      snapshot.messages.map((message) => ({
        role: message.role,
        text: message.text,
        sessionEntryId: message.sessionEntryId
      }))
    ).toEqual([
      { role: 'system', text: 'system note', sessionEntryId: undefined },
      { role: 'user', text: 'hello', sessionEntryId: userEntryId },
      { role: 'assistant', text: 'world', sessionEntryId: assistantEntryId }
    ])
  })

  it('可用 currentEntryId override 从指定 leaf 重建 timeline', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-session-'))
    roots.push(root)
    const cwd = join(root, 'repo')
    const sessionDir = join(root, 'sessions')
    const manager = SessionManager.create(cwd, sessionDir)
    manager.appendMessage({ role: 'user', content: 'first', timestamp: 1 })
    const targetEntryId = manager.appendMessage({
      role: 'assistant',
      content: 'target',
      timestamp: 2
    })
    manager.appendMessage({ role: 'user', content: 'after target', timestamp: 3 })
    const sessionFile = manager.getSessionFile()
    if (!sessionFile) {
      throw new Error('session file is required')
    }

    const snapshot = buildSnapshotFromSession({
      thread: {
        threadId: 'thread-1',
        cwd,
        status: 'stopped',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z'
      },
      sessionFile,
      currentEntryId: targetEntryId
    })

    expect(snapshot.currentEntryId).toBe(targetEntryId)
    expect(
      snapshot.messages.map((message) => ({ role: message.role, text: message.text }))
    ).toEqual([
      { role: 'user', text: 'first' },
      { role: 'assistant', text: 'target' }
    ])
  })

  it('currentEntryId override 同步约束 timeline 与 context usage', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-session-'))
    roots.push(root)
    const cwd = join(root, 'repo')
    const sessionDir = join(root, 'sessions')
    const manager = SessionManager.create(cwd, sessionDir)
    manager.appendMessage({ role: 'user', content: 'first', timestamp: 1 })
    const targetEntryId = manager.appendMessage({
      role: 'assistant',
      content: 'target',
      api: 'responses',
      provider: 'openai',
      model: 'gpt-test',
      usage: {
        input: 100,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 100,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: 'stop',
      timestamp: 2
    })
    manager.appendMessage({ role: 'user', content: 'after target', timestamp: 3 })
    manager.appendMessage({
      role: 'assistant',
      content: 'latest leaf',
      api: 'responses',
      provider: 'openai',
      model: 'gpt-test',
      usage: {
        input: 900,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 900,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: 'stop',
      timestamp: 4
    })
    const sessionFile = manager.getSessionFile()
    if (!sessionFile) {
      throw new Error('session file is required')
    }

    const snapshot = buildSnapshotFromSession({
      thread: {
        threadId: 'thread-1',
        cwd,
        status: 'stopped',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z'
      },
      sessionFile,
      currentEntryId: targetEntryId,
      modelContextWindows: { 'openai/gpt-test': 1000 }
    })

    expect(snapshot.currentEntryId).toBe(targetEntryId)
    expect(snapshot.context).toEqual({ tokens: 100, contextWindow: 1000, percent: 10 })
    expect(
      snapshot.messages.map((message) => ({ role: message.role, text: message.text }))
    ).toEqual([
      { role: 'user', text: 'first' },
      { role: 'assistant', text: 'target' }
    ])
  })

  it('label 变更不推进当前 leaf，且 reload 后保持原 leaf', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-session-'))
    roots.push(root)
    const cwd = join(root, 'repo')
    const sessionDir = join(root, 'sessions')
    const manager = SessionManager.create(cwd, sessionDir)
    manager.appendMessage({ role: 'user', content: 'hello', timestamp: 1 })
    const assistantEntryId = manager.appendMessage({
      role: 'assistant',
      content: 'world',
      timestamp: 2
    })
    const sessionFile = manager.getSessionFile()
    if (!sessionFile) {
      throw new Error('session file is required')
    }

    manager.appendLabelChange(assistantEntryId, 'Important')

    expect(manager.getLeafId()).toBe(assistantEntryId)
    expect(SessionManager.open(sessionFile, sessionDir).getLeafId()).toBe(assistantEntryId)
  })

  it('从 assistant toolCall block 派生工具调用参数', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-session-'))
    roots.push(root)
    const cwd = join(root, 'repo')
    const sessionDir = join(root, 'sessions')
    const manager = SessionManager.create(cwd, sessionDir)
    manager.appendMessage({
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 'tool-a', name: 'bash', arguments: { command: 'pnpm test' } }
      ],
      api: 'responses',
      provider: 'openai',
      model: 'gpt-test',
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
    })
    manager.appendMessage({
      role: 'toolResult',
      toolCallId: 'tool-a',
      toolName: 'bash',
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
      timestamp: 2
    })
    const sessionFile = manager.getSessionFile()
    if (!sessionFile) {
      throw new Error('session file is required')
    }

    const snapshot = buildSnapshotFromSession({
      thread: {
        threadId: 'thread-1',
        cwd,
        status: 'stopped',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z'
      },
      sessionFile
    })

    expect(snapshot.toolCalls).toMatchObject([
      {
        threadId: 'thread-1',
        toolCallId: 'tool-a',
        toolName: 'bash',
        status: 'succeeded',
        args: { command: 'pnpm test' },
        resultSummary: 'ok'
      }
    ])
    expect(snapshot.messages).toMatchObject([
      {
        role: 'assistant',
        toolCallIds: ['tool-a'],
        raw: {
          role: 'assistant',
          content: []
        }
      }
    ])
    expect(snapshot.messages.some((message) => message.role === 'tool')).toBe(false)
    expect(snapshot.toolCalls.some((toolCall) => toolCall.toolName === 'tool')).toBe(false)
  })

  it('重建 snapshot 时忽略 assistant error 中未执行的 toolCall', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-session-'))
    roots.push(root)
    const cwd = join(root, 'repo')
    const sessionDir = join(root, 'sessions')
    const manager = SessionManager.create(cwd, sessionDir)
    manager.appendMessage({
      role: 'assistant',
      content: [
        { type: 'text', text: '正在编辑文件' },
        { type: 'toolCall', id: 'tool-edit', name: 'edit', arguments: { path: 'src/app.ts' } }
      ],
      api: 'responses',
      provider: 'openai',
      model: 'gpt-test',
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: 'error',
      errorMessage: 'stream_read_error',
      timestamp: 1
    })
    const sessionFile = manager.getSessionFile()
    if (!sessionFile) {
      throw new Error('session file is required')
    }

    const snapshot = buildSnapshotFromSession({
      thread: {
        threadId: 'thread-1',
        cwd,
        status: 'idle',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z'
      },
      sessionFile
    })

    expect(snapshot.toolCalls).toEqual([])
    expect(snapshot.messages).toMatchObject([
      {
        role: 'system',
        text: '模型请求失败：stream_read_error',
        raw: { role: 'assistant', stopReason: 'error' }
      }
    ])
    expect(snapshot.messages[0]?.toolCallIds).toBeUndefined()
  })

  it('从 edit tool result 重建文件 diff/patch 变更', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-session-'))
    roots.push(root)
    const cwd = join(root, 'repo')
    const sessionDir = join(root, 'sessions')
    const manager = SessionManager.create(cwd, sessionDir)
    manager.appendMessage({
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 'tool-edit', name: 'edit', arguments: { path: 'src/app.ts' } }
      ],
      api: 'responses',
      provider: 'openai',
      model: 'gpt-test',
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
    })
    manager.appendMessage({
      role: 'toolResult',
      toolCallId: 'tool-edit',
      toolName: 'edit',
      content: [{ type: 'text', text: 'Successfully replaced 1 block(s) in src/app.ts.' }],
      isError: false,
      timestamp: Date.parse('2026-07-01T00:00:00.000Z'),
      details: {
        diff: '-1 old\n+1 new',
        patch: '--- src/app.ts\n+++ src/app.ts\n@@\n-old\n+new\n',
        firstChangedLine: 1
      }
    } as Parameters<typeof manager.appendMessage>[0])
    const sessionFile = manager.getSessionFile()
    if (!sessionFile) {
      throw new Error('session file is required')
    }

    const snapshot = buildSnapshotFromSession({
      thread: {
        threadId: 'thread-1',
        cwd,
        status: 'stopped',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z'
      },
      sessionFile
    })

    expect(snapshot.fileChanges).toMatchObject([
      {
        threadId: 'thread-1',
        toolCallId: 'tool-edit',
        path: 'src/app.ts',
        changeType: 'updated',
        diff: '-1 old\n+1 new',
        patch: '--- src/app.ts\n+++ src/app.ts\n@@\n-old\n+new\n',
        additions: 1,
        deletions: 1,
        firstChangedLine: 1,
        createdAt: '2026-07-01T00:00:00.000Z'
      }
    ])
    expect(snapshot.toolCalls).toMatchObject([
      {
        toolCallId: 'tool-edit',
        result: {
          details: {
            diff: '-1 old\n+1 new',
            patch: '--- src/app.ts\n+++ src/app.ts\n@@\n-old\n+new\n',
            firstChangedLine: 1
          }
        }
      }
    ])
  })

  it('从 Pi compaction entry 重建 desktop system message', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-session-'))
    roots.push(root)
    const cwd = join(root, 'repo')
    const sessionDir = join(root, 'sessions')
    const manager = SessionManager.create(cwd, sessionDir)
    const firstMessageId = manager.appendMessage({ role: 'user', content: 'first', timestamp: 1 })
    manager.appendMessage({ role: 'assistant', content: 'answer', timestamp: 2 })
    manager.appendCompaction('压缩后的上下文摘要', firstMessageId, 128000)
    const sessionFile = manager.getSessionFile()
    if (!sessionFile) {
      throw new Error('session file is required')
    }

    const snapshot = buildSnapshotFromSession({
      thread: {
        threadId: 'thread-1',
        cwd,
        status: 'stopped',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z'
      },
      sessionFile
    })

    expect(
      snapshot.messages.map((message) => ({ role: message.role, text: message.text }))
    ).toEqual([
      { role: 'user', text: 'first' },
      { role: 'assistant', text: 'answer' },
      { role: 'system', text: '压缩后的上下文摘要' }
    ])
    expect(snapshot.messages[2]).toMatchObject({
      role: 'system',
      text: '压缩后的上下文摘要',
      systemEvent: {
        kind: 'compaction',
        title: '上下文已压缩',
        meta: ['压缩前 128,000 tokens']
      }
    })
    expect(snapshot.sessionTree?.[0]).toMatchObject({
      type: 'message',
      children: [
        {
          type: 'message',
          children: [
            {
              type: 'compaction',
              title: 'compaction'
            }
          ]
        }
      ]
    })
  })

  it('session tree 默认浅层返回并标记可继续加载的子节点', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-session-'))
    roots.push(root)
    const cwd = join(root, 'repo')
    const sessionDir = join(root, 'sessions')
    const manager = SessionManager.create(cwd, sessionDir)
    const ids = [
      manager.appendMessage({ role: 'user', content: 'one', timestamp: 1 }),
      manager.appendMessage({ role: 'assistant', content: 'two', timestamp: 2 }),
      manager.appendMessage({ role: 'user', content: 'three', timestamp: 3 }),
      manager.appendMessage({ role: 'assistant', content: 'four', timestamp: 4 }),
      manager.appendMessage({ role: 'user', content: 'five', timestamp: 5 })
    ]

    const shallow = toDesktopSessionTreeChildren(manager.getTree(), null, 1)
    expect(shallow).toMatchObject([
      {
        id: ids[0],
        children: [
          {
            id: ids[1],
            hasMoreChildren: true,
            children: []
          }
        ]
      }
    ])

    const children = toDesktopSessionTreeChildren(manager.getTree(), ids[1], 1)
    expect(children).toMatchObject([
      {
        id: ids[2],
        children: [
          {
            id: ids[3],
            hasMoreChildren: true,
            children: []
          }
        ]
      }
    ])
  })

  /** 验证 cwd 解析复用完整 JSONL parser，不依赖短读 header。 */
  it('resolveSessionCwd 使用完整 JSONL header 解析', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-session-'))
    roots.push(root)
    const cwd = join(root, 'repo')
    const sessionFile = join(root, 'long-header.jsonl')
    const header = {
      type: 'session',
      version: 3,
      id: 'session-long-header',
      timestamp: '2026-07-01T00:00:00.000Z',
      cwd,
      parentSession: 'x'.repeat(1024)
    }
    appendFileSync(sessionFile, `${JSON.stringify(header)}\n`)

    expect(resolveSessionCwd(sessionFile, join(root, 'fallback'))).toBe(cwd)
  })
})
