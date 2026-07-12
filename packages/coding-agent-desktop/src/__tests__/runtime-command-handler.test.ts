/**
 * 本文件测试 desktop runtime command handler 与 Pi RPC 主干语义的一致性。
 */

import { describe, expect, it } from 'vitest'
import {
  handleRuntimeCommand,
  type RuntimeCommandHandlerHost
} from '../worker/runtime-command-handler.ts'
import type { WorkerCommandEnvelope } from '../protocol/envelope.ts'

/** Runtime command handler 测试套件。 */
describe('handleRuntimeCommand', () => {
  /** 验证返回 Pi 同构的 session state。 */
  it('返回 Pi 同构 session state', async () => {
    const host = createHost()
    host.getPendingApprovals = () => [
      {
        approvalId: 'approval-1',
        threadId: 'thread-1',
        action: 'edit',
        risk: 'high',
        scope: 'once',
        defaultAction: 'deny',
        createdAt: '2026-07-10T00:00:00.000Z'
      }
    ]
    host.getPendingExtensionDialogs = () => [
      { type: 'confirm', id: 'dialog-1', title: 'Confirm', message: 'Continue?' }
    ]

    const response = await handleRuntimeCommand(host, command('1', { type: 'get_state' }))

    expect(response?.success).toBe(true)
    expect(response?.data).toMatchObject({
      sessionId: 'session-1',
      sessionName: 'Desktop',
      messageCount: 0,
      pendingMessageCount: 2,
      queue: { steering: ['redirect'], followUp: ['verify'] },
      approvals: [expect.objectContaining({ approvalId: 'approval-1' })],
      extensionDialogs: [expect.objectContaining({ id: 'dialog-1', type: 'confirm' })],
      autoRetryEnabled: true
    })
  })

  /** 验证 get_messages 返回当前 branch 中可渲染消息对应的 entry ID。 */
  it('get_messages 返回可渲染消息对应的 entry ID', async () => {
    const customMessage = {
      role: 'custom',
      customType: 'note',
      content: 'system note'
    }
    const userMessage = { role: 'user', content: 'hello' }
    const emptyAssistantMessage = {
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
      stopReason: 'toolUse'
    }
    const assistantMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'world' }],
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
      stopReason: 'stop'
    }
    const host = createHost(
      createSession({
        messages: [customMessage, userMessage, emptyAssistantMessage, assistantMessage],
        sessionManager: {
          ...createSession().sessionManager,
          getBranch: () => [
            {
              type: 'message',
              id: 'entry-custom',
              parentId: null,
              timestamp: '1',
              message: customMessage
            },
            {
              type: 'message',
              id: 'entry-user',
              parentId: 'entry-custom',
              timestamp: '2',
              message: userMessage
            },
            {
              type: 'message',
              id: 'entry-empty-assistant',
              parentId: 'entry-user',
              timestamp: '3',
              message: emptyAssistantMessage
            },
            {
              type: 'message',
              id: 'entry-assistant',
              parentId: 'entry-empty-assistant',
              timestamp: '4',
              message: assistantMessage
            }
          ]
        }
      })
    )

    const response = await handleRuntimeCommand(host, command('1', { type: 'get_messages' }))

    expect(response?.success).toBe(true)
    expect(response?.data).toMatchObject({
      messages: [customMessage, userMessage, emptyAssistantMessage, assistantMessage],
      messageEntryIds: ['entry-user', 'entry-assistant']
    })
  })

  /** 验证 set_session_name 拒绝空名称。 */
  it('set_session_name 拒绝空名称', async () => {
    const host = createHost()

    const response = await handleRuntimeCommand(
      host,
      command('1', { type: 'set_session_name', name: '   ' })
    )

    expect(response?.success).toBe(false)
    expect(response?.error?.code).toBe('invalid_command')
  })

  /** 验证 set_session_entry_label 写入 label 变更。 */
  it('set_session_entry_label 写入 label 变更', async () => {
    let received: { entryId: string; label?: string } | undefined
    const host = createHost(
      createSession({
        sessionManager: {
          ...createSession().sessionManager,
          appendLabelChange: (entryId: string, label?: string) => {
            received = { entryId, label }
            return 'label-entry'
          }
        }
      })
    )

    const response = await handleRuntimeCommand(
      host,
      command('1', { type: 'set_session_entry_label', entryId: 'entry-a', label: '  Important  ' })
    )

    expect(response?.success).toBe(true)
    expect(received).toEqual({ entryId: 'entry-a', label: 'Important' })
  })

  /** 验证 clone 在无 leaf entry 时 fail-first。 */
  it('clone 在没有 leaf entry 时 fail-first', async () => {
    const host = createHost()

    const response = await handleRuntimeCommand(host, command('1', { type: 'clone' }))

    expect(response?.success).toBe(false)
    expect(response?.error?.code).toBe('invalid_state')
  })

  /** 验证 create_fork_session 只返回新 session 文件，不替换当前 runtime。 */
  it('create_fork_session 返回新 session 文件', async () => {
    const host = createHost()

    const response = await handleRuntimeCommand(
      host,
      command('1', { type: 'create_fork_session', entryId: 'entry-a', position: 'at' })
    )

    expect(response?.success).toBe(true)
    expect(response?.data).toEqual({
      sessionFile: 'fork.jsonl',
      text: undefined,
      cancelled: false
    })
  })

  /** 验证模型 registry 刷新会同时重读跨进程写入的凭据。 */
  it('refresh_model_registry 重载 auth 和 models registry', async () => {
    const calls: string[] = []
    const host = createHost(
      createSession({
        modelRegistry: {
          authStorage: { reload: () => calls.push('auth') },
          refresh: () => calls.push('models'),
          getAvailable: async () => []
        }
      })
    )

    const response = await handleRuntimeCommand(
      host,
      command('1', { type: 'refresh_model_registry' })
    )

    expect(response?.success).toBe(true)
    expect(calls).toEqual(['auth', 'models'])
  })

  /** 验证 Composer 获取模型列表时按 Pi /model 语义刷新 registry。 */
  it('get_available_models 刷新 registry 后返回模型', async () => {
    const calls: string[] = []
    const host = createHost(
      createSession({
        modelRegistry: {
          authStorage: { reload: () => calls.push('auth') },
          refresh: () => calls.push('models'),
          getAvailable: async () => [{ provider: 'custom', id: 'new-model' }]
        }
      })
    )

    const response = await handleRuntimeCommand(
      host,
      command('1', { type: 'get_available_models' })
    )

    expect(response?.success).toBe(true)
    expect(response?.data).toEqual({ models: [{ provider: 'custom', id: 'new-model' }] })
    expect(calls).toEqual(['auth', 'models'])
  })

  /** 验证 set_model 找不到模型时返回结构化错误。 */
  it('set_model 找不到模型时返回结构化错误', async () => {
    const host = createHost()

    const response = await handleRuntimeCommand(
      host,
      command('1', { type: 'set_model', provider: 'missing', modelId: 'none' })
    )

    expect(response?.success).toBe(false)
    expect(response?.error?.message).toContain('Model not found')
  })

  /** 验证 abort 同时取消正在进行的压缩，保持 Desktop 与 Pi 交互语义一致。 */
  it('abort 会取消正在进行的 compaction', async () => {
    const calls: string[] = []
    const host = createHost(
      createSession({
        abortCompaction: () => {
          calls.push('abortCompaction')
        },
        abort: async () => {
          calls.push('abort')
        }
      })
    )

    const response = await handleRuntimeCommand(host, command('1', { type: 'abort' }))

    expect(response?.success).toBe(true)
    expect(calls).toEqual(['abortCompaction', 'abort'])
  })

  /** 验证手动压缩结束后继续交付压缩期间排队的消息。 */
  it('manual compact 完成后继续执行已排队消息', async () => {
    const calls: string[] = []
    const host = createHost(
      createSession({
        compact: async () => {
          calls.push('compact')
          return { summary: 'done', firstKeptEntryId: 'entry-a', tokensBefore: 100 }
        },
        agent: {
          hasQueuedMessages: () => true,
          continue: async () => {
            calls.push('continue')
          }
        }
      })
    )

    const response = await handleRuntimeCommand(host, command('1', { type: 'compact' }))

    expect(response?.success).toBe(true)
    expect(response?.data).toMatchObject({ summary: 'done' })
    expect(calls).toEqual(['compact', 'continue'])
  })

  /** 验证没有排队消息时手动压缩不会额外触发 agent continue。 */
  it('manual compact 无排队消息时不继续 agent', async () => {
    const calls: string[] = []
    const host = createHost(
      createSession({
        compact: async () => {
          calls.push('compact')
          return { summary: 'done', firstKeptEntryId: 'entry-a', tokensBefore: 100 }
        },
        agent: {
          hasQueuedMessages: () => false,
          continue: async () => {
            calls.push('continue')
          }
        }
      })
    )

    const response = await handleRuntimeCommand(host, command('1', { type: 'compact' }))

    expect(response?.success).toBe(true)
    expect(calls).toEqual(['compact'])
  })

  /** 验证 reload 调用 session.reload，而不是走 prompt。 */
  it('reload 重载当前 session 资源', async () => {
    let reloaded = false
    const host = createHost(
      createSession({
        reload: async () => {
          reloaded = true
        }
      })
    )

    const response = await handleRuntimeCommand(host, command('1', { type: 'reload' }))

    expect(response?.success).toBe(true)
    expect(reloaded).toBe(true)
  })

  /** 验证 get_commands 汇总 extension、prompt template 和 skill 命令。 */
  it('get_commands 汇总 extension、prompt template 和 skill 命令', async () => {
    const host = createHost()

    const response = await handleRuntimeCommand(host, command('1', { type: 'get_commands' }))
    expect(response?.success).toBe(true)
    expect(response?.data).toEqual({
      commands: [
        {
          name: 'fix',
          description: '修复问题',
          source: 'extension',
          sourceInfo: { type: 'extension', path: 'ext' }
        },
        {
          name: 'review',
          description: '审查代码',
          source: 'prompt',
          sourceInfo: { type: 'prompt', path: 'prompt' }
        },
        {
          name: 'skill:test',
          description: '测试技能',
          source: 'skill',
          sourceInfo: { type: 'skill', path: 'skill' }
        }
      ]
    })
  })

  /** 验证 prompt 等待 preflight 成功后返回，不等待完整 agent run。 */
  it('prompt 等待 preflight 成功后返回，不等待完整 agent run', async () => {
    let finishPrompt: (() => void) | undefined
    const session = createSession({
      prompt: async (
        _message: string,
        options: { preflightResult?: (success: boolean) => void }
      ) => {
        options.preflightResult?.(true)
        await new Promise<void>((resolve) => {
          finishPrompt = resolve
        })
      }
    })
    const host = createHost(session)

    const response = await handleRuntimeCommand(
      host,
      command('1', { type: 'prompt', message: 'hello' })
    )

    expect(response?.success).toBe(true)
    expect(finishPrompt).toBeDefined()
    finishPrompt?.()
  })

  /** 验证 prompt preflight 失败时返回 runtime_error。 */
  it('prompt preflight 失败时返回 runtime_error', async () => {
    const session = createSession({
      prompt: async (
        _message: string,
        options: { preflightResult?: (success: boolean) => void }
      ) => {
        options.preflightResult?.(false)
        throw new Error('no model')
      }
    })
    const host = createHost(session)

    const response = await handleRuntimeCommand(
      host,
      command('1', { type: 'prompt', message: 'hello' })
    )

    expect(response?.success).toBe(false)
    expect(response?.error?.message).toBe('no model')
  })

  /** 验证 cycle_thinking_level 在模型不支持 thinking 时返回 null。 */
  it('cycle_thinking_level 不支持 thinking 时返回 null', async () => {
    const host = createHost(createSession({ cycleThinkingLevel: () => undefined }))

    const response = await handleRuntimeCommand(
      host,
      command('1', { type: 'cycle_thinking_level' })
    )

    expect(response?.success).toBe(true)
    expect(response?.data).toBeNull()
  })

  /** 验证 switch_session 复用 Pi runtime 的 cwdOverride 与 Project trust context。 */
  it('switch_session 透传 cwdOverride 与 Project trust context factory', async () => {
    let received:
      | {
          sessionPath: string
          cwdOverride?: string
          contextCwd?: string
        }
      | undefined
    const host: RuntimeCommandHandlerHost = {
      ...createHost(),
      projectTrustContextFactory: (cwd) => ({
        cwd,
        mode: 'rpc',
        hasUI: false,
        ui: {
          select: async () => undefined,
          confirm: async () => false,
          input: async () => undefined,
          notify: () => {}
        }
      })
    }
    host.runtime = {
      ...host.runtime,
      switchSession: async (
        sessionPath: string,
        options?: Parameters<RuntimeCommandHandlerHost['runtime']['switchSession']>[1]
      ) => {
        received = {
          sessionPath,
          cwdOverride: options?.cwdOverride,
          contextCwd: options?.projectTrustContextFactory?.('/tmp/next').cwd
        }
        return { cancelled: false }
      }
    } as RuntimeCommandHandlerHost['runtime']

    const response = await handleRuntimeCommand(
      host,
      command('1', {
        type: 'switch_session',
        sessionPath: 'session.jsonl',
        cwdOverride: '/tmp/override'
      })
    )

    expect(response?.success).toBe(true)
    expect(received).toEqual({
      sessionPath: 'session.jsonl',
      cwdOverride: '/tmp/override',
      contextCwd: '/tmp/next'
    })
  })

  /** 验证 import_session 复用 Pi runtime 的 cwdOverride 与 Project trust context。 */
  it('import_session 透传 cwdOverride 与 Project trust context factory', async () => {
    let received:
      | {
          inputPath: string
          cwdOverride?: string
          contextCwd?: string
        }
      | undefined
    const host: RuntimeCommandHandlerHost = {
      ...createHost(),
      projectTrustContextFactory: (cwd) => ({
        cwd,
        mode: 'rpc',
        hasUI: false,
        ui: {
          select: async () => undefined,
          confirm: async () => false,
          input: async () => undefined,
          notify: () => {}
        }
      })
    }
    host.runtime = {
      ...host.runtime,
      importFromJsonl: async (
        inputPath: string,
        options?: Parameters<RuntimeCommandHandlerHost['runtime']['importFromJsonl']>[1]
      ) => {
        if (typeof options === 'string') {
          received = { inputPath, cwdOverride: options }
        } else {
          received = {
            inputPath,
            cwdOverride: options?.cwdOverride,
            contextCwd: options?.projectTrustContextFactory?.('/tmp/imported').cwd
          }
        }
        return { cancelled: false }
      }
    } as RuntimeCommandHandlerHost['runtime']

    const response = await handleRuntimeCommand(
      host,
      command('1', {
        type: 'import_session',
        inputPath: 'import.jsonl',
        cwdOverride: '/tmp/override'
      })
    )

    expect(response?.success).toBe(true)
    expect(received).toEqual({
      inputPath: 'import.jsonl',
      cwdOverride: '/tmp/override',
      contextCwd: '/tmp/imported'
    })
  })
})

function command(id: string, value: WorkerCommandEnvelope['command']): WorkerCommandEnvelope {
  return { kind: 'command', id, command: value }
}

function createHost(session = createSession()): RuntimeCommandHandlerHost {
  return {
    runtime: {
      session,
      newSession: async () => ({ cancelled: false }),
      switchSession: async () => ({ cancelled: false }),
      importFromJsonl: async () => ({ cancelled: false }),
      fork: async () => ({ cancelled: false }),
      createForkedSessionFile: async () => ({ cancelled: false, sessionFile: 'fork.jsonl' }),
      dispose: async () => {}
    } as RuntimeCommandHandlerHost['runtime']
  }
}

function createSession(
  overrides: Record<string, unknown> = {}
): RuntimeCommandHandlerHost['runtime']['session'] {
  const sourceInfo = { type: 'test', path: 'test' }
  return {
    model: { provider: 'openai', id: 'gpt-test' },
    thinkingLevel: 'medium',
    isStreaming: false,
    isCompacting: false,
    steeringMode: 'all',
    followUpMode: 'all',
    sessionFile: 'session.jsonl',
    sessionId: 'session-1',
    sessionName: 'Desktop',
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    messages: [],
    pendingMessageCount: 2,
    getSteeringMessages: () => ['redirect'],
    getFollowUpMessages: () => ['verify'],
    getContextUsage: () => undefined,
    modelRegistry: {
      authStorage: { reload: () => {} },
      refresh: () => {},
      getAvailable: async () => [{ provider: 'openai', id: 'gpt-test' }]
    },
    sessionManager: {
      getCwd: () => '/tmp/project',
      getLeafId: () => null,
      getTree: () => [],
      getBranch: () => [],
      appendLabelChange: () => 'label-entry'
    },
    extensionRunner: {
      getRegisteredCommands: () => [
        {
          invocationName: 'fix',
          description: '修复问题',
          sourceInfo: { type: 'extension', path: 'ext' }
        }
      ]
    },
    promptTemplates: [
      {
        name: 'review',
        description: '审查代码',
        sourceInfo: { type: 'prompt', path: 'prompt' }
      }
    ],
    resourceLoader: {
      getSkills: () => ({
        skills: [
          {
            name: 'test',
            description: '测试技能',
            sourceInfo: { type: 'skill', path: 'skill' }
          }
        ]
      })
    },
    agent: {
      hasQueuedMessages: () => false,
      continue: async () => {}
    },
    prompt: async (_message: string, options: { preflightResult?: (success: boolean) => void }) => {
      options.preflightResult?.(true)
    },
    abortCompaction: () => {},
    abort: async () => {},
    compact: async () => ({ summary: 'done', firstKeptEntryId: 'entry-a', tokensBefore: 100 }),
    setModel: async () => {},
    cycleThinkingLevel: () => 'high',
    ...overrides
  } as RuntimeCommandHandlerHost['runtime']['session']
}
