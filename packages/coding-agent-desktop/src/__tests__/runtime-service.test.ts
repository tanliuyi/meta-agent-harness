/**
 * 本文件测试 runtime desktop worker service 的启动、绑定与停止行为。
 */

import { describe, expect, it } from 'vitest'
import type { AgentSessionRuntime } from '@earendil-works/pi-coding-agent'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import { RuntimeDesktopWorkerService } from '../worker/runtime-service.ts'
import type { StartThreadInput } from '../protocol/thread.ts'
import type { WorkerEventEnvelope } from '../protocol/envelope.ts'
import type { ExtensionBindings } from '@earendil-works/pi-coding-agent'

/** RuntimeDesktopWorkerService 测试套件。 */
describe('RuntimeDesktopWorkerService', () => {
  /** 验证 startThread 使用 factory 创建 Pi runtime。 */
  it('startThread 使用 factory 创建 Pi runtime', async () => {
    const calls: StartThreadInput[] = []
    const service = new RuntimeDesktopWorkerService(async (input) => {
      calls.push(input)
      return createRuntime()
    })

    const response = await service.handle({
      kind: 'command',
      id: '1',
      command: { type: 'worker.startThread', input: { threadId: 'thread-1', cwd: 'H:/repo' } }
    })

    expect(response.success).toBe(true)
    expect(calls).toEqual([{ threadId: 'thread-1', cwd: 'H:/repo' }])
  })

  /** 验证重复绑定同一个 worker 时 fail-first。 */
  it('重复绑定同一个 worker 时 fail-first', async () => {
    const service = new RuntimeDesktopWorkerService(async () => createRuntime())
    await service.startThread({ threadId: 'thread-1', cwd: 'H:/repo' })

    const response = await service.handle({
      kind: 'command',
      id: '1',
      command: { type: 'worker.startThread', input: { threadId: 'thread-2', cwd: 'H:/repo' } }
    })

    expect(response.success).toBe(false)
    expect(response.error?.message).toContain('already has a bound thread')
  })

  /** 验证 stop 会释放 runtime。 */
  it('stop 会释放 runtime 并取消等待中的 extension dialog', async () => {
    let disposed = false
    let bindings: ExtensionBindings | undefined
    const events: WorkerEventEnvelope[] = []
    const service = new RuntimeDesktopWorkerService(async () =>
      createRuntime({
        dispose: async () => {
          disposed = true
        },
        session: {
          bindExtensions: async (nextBindings: ExtensionBindings) => {
            bindings = nextBindings
          }
        }
      })
    )
    service.setEventSink((event) => events.push(event))
    await service.startThread({ threadId: 'thread-1', cwd: 'H:/repo' })
    const pendingDialog = bindings?.uiContext?.confirm('Stop', 'Stop worker?')

    await service.stop('test')
    const response = await service.handle({
      kind: 'command',
      id: '1',
      command: { type: 'worker.ping' }
    })

    expect(disposed).toBe(true)
    await expect(pendingDialog).resolves.toBe(false)
    expect(events.at(-1)).toMatchObject({
      eventType: 'projection',
      event: { type: 'extensionUi.dismissed', reason: 'workerStopped' }
    })
    expect(response.success).toBe(true)
  })

  it('session 失效时取消旧 session 等待中的 extension dialog', async () => {
    let bindings: ExtensionBindings | undefined
    let beforeSessionInvalidate: (() => void) | undefined
    const events: WorkerEventEnvelope[] = []
    const service = new RuntimeDesktopWorkerService(async () =>
      createRuntime({
        setBeforeSessionInvalidate: (callback) => {
          beforeSessionInvalidate = callback
        },
        session: {
          bindExtensions: async (nextBindings: ExtensionBindings) => {
            bindings = nextBindings
          }
        }
      })
    )
    service.setEventSink((event) => events.push(event))
    await service.startThread({ threadId: 'thread-1', cwd: 'H:/repo' })
    const pendingDialog = bindings?.uiContext?.input('Old session')

    beforeSessionInvalidate?.()

    await expect(pendingDialog).resolves.toBeUndefined()
    expect(events.at(-1)).toMatchObject({
      eventType: 'projection',
      event: { type: 'extensionUi.dismissed', reason: 'sessionInvalidated' }
    })
  })

  /** 验证绑定 runtime 后原样转发 canonical event。 */
  it('绑定 runtime 后原样转发 canonical event', async () => {
    let listener: ((event: AgentSessionEvent) => void) | undefined
    const model = createModel('gpt-5.1')
    const events: WorkerEventEnvelope[] = []
    const service = new RuntimeDesktopWorkerService(async () =>
      createRuntime({
        session: {
          subscribe: (next: typeof listener) => {
            listener = next
            return () => {}
          }
        }
      })
    )
    service.setEventSink((event) => events.push(event))
    await service.startThread({ threadId: 'thread-1', cwd: 'H:/repo' })

    listener?.({ type: 'thinking_level_changed', level: 'high' })
    listener?.({ type: 'model_changed', model, source: 'set' })

    expect(events).toEqual([
      {
        kind: 'event',
        eventType: 'projection',
        threadId: 'thread-1',
        event: { type: 'thread.stateChanged', threadId: 'thread-1', status: 'idle' }
      },
      {
        kind: 'event',
        eventType: 'canonical',
        threadId: 'thread-1',
        event: { type: 'thinking_level_changed', level: 'high' }
      },
      {
        kind: 'event',
        eventType: 'canonical',
        threadId: 'thread-1',
        event: { type: 'model_changed', model, source: 'set' }
      }
    ])
  })

  it('message_end 持久化后补充 sessionEntryId', async () => {
    let listener: ((event: AgentSessionEvent) => void) | undefined
    const message = createAssistantMessage('done')
    const events: WorkerEventEnvelope[] = []
    const service = new RuntimeDesktopWorkerService(async () =>
      createRuntime({
        session: {
          subscribe: (next: typeof listener) => {
            listener = next
            return () => {}
          },
          sessionManager: {
            getBranch: () => [
              {
                type: 'message',
                id: 'entry-assistant',
                parentId: null,
                timestamp: '2026-07-01T00:00:00.000Z',
                message
              }
            ]
          }
        }
      })
    )
    service.setEventSink((event) => events.push(event))
    await service.startThread({ threadId: 'thread-1', cwd: 'H:/repo' })

    listener?.({ type: 'message_end', message })
    expect(events).toEqual([
      {
        kind: 'event',
        eventType: 'projection',
        threadId: 'thread-1',
        event: { type: 'thread.stateChanged', threadId: 'thread-1', status: 'idle' }
      }
    ])

    await Promise.resolve()

    expect(events.at(-1)).toMatchObject({
      kind: 'event',
      eventType: 'canonical',
      threadId: 'thread-1',
      event: {
        type: 'message_end',
        message,
        sessionEntryId: 'entry-assistant'
      }
    })
  })

  it('edit tool 结束后派生 file.changed projection', async () => {
    let listener: ((event: { type: string; [key: string]: unknown }) => void) | undefined
    const events: WorkerEventEnvelope[] = []
    const service = new RuntimeDesktopWorkerService(async () =>
      createRuntime({
        session: {
          subscribe: (next: typeof listener) => {
            listener = next
            return () => {}
          }
        }
      })
    )
    service.setEventSink((event) => events.push(event))
    await service.startThread({ threadId: 'thread-1', cwd: 'H:/repo' })

    listener?.({
      type: 'tool_execution_start',
      toolCallId: 'tool-edit',
      toolName: 'edit',
      args: { path: 'src/app.ts' }
    })
    listener?.({
      type: 'tool_execution_end',
      toolCallId: 'tool-edit',
      toolName: 'edit',
      result: {
        content: [{ type: 'text', text: 'Successfully replaced 1 block(s) in src/app.ts.' }],
        details: {
          diff: '-1 old\n+1 new',
          patch: '--- src/app.ts\n+++ src/app.ts\n@@\n-old\n+new\n',
          firstChangedLine: 1
        }
      },
      isError: false
    })

    expect(events).toMatchObject([
      { eventType: 'projection', event: { type: 'thread.stateChanged' } },
      { eventType: 'canonical', event: { type: 'tool_execution_start' } },
      { eventType: 'canonical', event: { type: 'tool_execution_end' } },
      {
        eventType: 'projection',
        threadId: 'thread-1',
        event: {
          type: 'file.changed',
          threadId: 'thread-1',
          change: {
            threadId: 'thread-1',
            toolCallId: 'tool-edit',
            path: 'src/app.ts',
            changeType: 'updated',
            diff: '-1 old\n+1 new',
            patch: '--- src/app.ts\n+++ src/app.ts\n@@\n-old\n+new\n',
            additions: 1,
            deletions: 1,
            firstChangedLine: 1
          }
        }
      }
    ])
  })

  it('为 extension command context 绑定真实 session lifecycle actions', async () => {
    let bindings: ExtensionBindings | undefined
    let rebindSession: ((session: AgentSessionRuntime['session']) => Promise<void>) | undefined
    let newSessionCalled = false
    let bindCount = 0
    const service = new RuntimeDesktopWorkerService(async () =>
      createRuntime({
        setRebindSession: (next) => {
          rebindSession = next
        },
        newSession: async () => {
          newSessionCalled = true
          await rebindSession?.({} as AgentSessionRuntime['session'])
          return { cancelled: false }
        },
        session: {
          bindExtensions: async (nextBindings: ExtensionBindings) => {
            bindings = nextBindings
            bindCount++
          }
        }
      })
    )
    await service.startThread({ threadId: 'thread-1', cwd: 'H:/repo' })

    const result = await bindings?.commandContextActions?.newSession()

    expect(result).toEqual({ cancelled: false })
    expect(newSessionCalled).toBe(true)
    expect(bindCount).toBe(2)
    expect(bindings?.commandContextActions?.reload).toEqual(expect.any(Function))
  })

  it('runtime rebind 发生在启动阶段时已有 extension UI bridge', async () => {
    let rebindSession: (() => Promise<void>) | undefined
    let bindCount = 0
    const service = new RuntimeDesktopWorkerService(async () =>
      createRuntime({
        setRebindSession: (next) => {
          rebindSession = next
        },
        session: {
          bindExtensions: async (nextBindings: ExtensionBindings) => {
            bindCount++
            expect(nextBindings.uiContext).toBeDefined()
            expect(nextBindings.desktopContext).toBeDefined()
            expect(nextBindings.mode).toBe('desktop')
          }
        }
      })
    )

    await service.startThread({ threadId: 'thread-1', cwd: 'H:/repo' })
    await rebindSession?.()

    expect(bindCount).toBe(2)
  })

  it('同步 editor text 并触发 extension shortcut', async () => {
    let bindings: ExtensionBindings | undefined
    const shortcutRuns: string[] = []
    const service = new RuntimeDesktopWorkerService(async () =>
      createRuntime({
        session: {
          bindExtensions: async (nextBindings: ExtensionBindings) => {
            bindings = nextBindings
          },
          extensionRunner: {
            executeShortcut: async (shortcut: string) => {
              shortcutRuns.push(shortcut)
              return true
            }
          }
        }
      })
    )
    await service.startThread({ threadId: 'thread-1', cwd: 'H:/repo' })

    const syncResponse = await service.handle({
      kind: 'command',
      id: 'sync-editor',
      command: { type: 'ui.editorTextChanged', text: 'hello args' }
    })
    const shortcutResponse = await service.handle({
      kind: 'command',
      id: 'shortcut',
      command: { type: 'shortcut.dispatch', shortcut: 'shift+ctrl+k' }
    })

    expect(syncResponse.success).toBe(true)
    expect(bindings?.uiContext?.getEditorText()).toBe('hello args')
    expect(shortcutResponse.success).toBe(true)
    expect(shortcutResponse.data).toEqual({ handled: true })
    expect(shortcutRuns).toEqual(['shift+ctrl+k'])
  })

  it('向 extension 派发 desktop panel message', async () => {
    const panelMessages: unknown[] = []
    const service = new RuntimeDesktopWorkerService(async () =>
      createRuntime({
        session: {
          extensionRunner: {
            emit: async (event: unknown) => {
              panelMessages.push(event)
            }
          }
        }
      })
    )
    await service.startThread({ threadId: 'thread-1', cwd: 'H:/repo' })

    const response = await service.handle({
      kind: 'command',
      id: 'panel-message',
      command: { type: 'desktop.panelMessage', panelId: 'deploy', message: { type: 'cancel' } }
    })

    expect(response.success).toBe(true)
    expect(panelMessages).toEqual([
      { type: 'desktop_panel_message', panelId: 'deploy', message: { type: 'cancel' } }
    ])
  })

  it('向 extension 派发 desktop panel lifecycle', async () => {
    const panelEvents: unknown[] = []
    const extensionRunner = {
      panelEvents,
      async emit(event: unknown) {
        this.panelEvents.push(event)
      }
    }
    const service = new RuntimeDesktopWorkerService(async () =>
      createRuntime({
        session: {
          extensionRunner
        }
      })
    )
    await service.startThread({ threadId: 'thread-1', cwd: 'H:/repo' })

    const viewStateResponse = await service.handle({
      kind: 'command',
      id: 'panel-visible',
      command: {
        type: 'desktop.panelLifecycle',
        event: { type: 'viewStateChanged', panelId: 'deploy', visible: true, active: true }
      }
    })
    const disposedResponse = await service.handle({
      kind: 'command',
      id: 'panel-disposed',
      command: {
        type: 'desktop.panelLifecycle',
        event: { type: 'disposed', panelId: 'deploy', reason: 'removed' }
      }
    })
    const restoreResponse = await service.handle({
      kind: 'command',
      id: 'panel-restore',
      command: {
        type: 'desktop.panelRestore',
        restore: {
          panelId: 'deploy',
          viewType: 'demo.deploy',
          state: { selectedDeploymentId: 'prod' }
        }
      }
    })

    expect(viewStateResponse.success).toBe(true)
    expect(disposedResponse.success).toBe(true)
    expect(restoreResponse.success).toBe(true)
    expect(panelEvents).toEqual([
      { type: 'desktop_panel_view_state_changed', panelId: 'deploy', visible: true, active: true },
      { type: 'desktop_panel_disposed', panelId: 'deploy', reason: 'removed' },
      {
        type: 'desktop_panel_restore',
        panelId: 'deploy',
        viewType: 'demo.deploy',
        state: { selectedDeploymentId: 'prod' }
      }
    ])
  })

  it('未注册 extension shortcut 返回未处理而不是错误', async () => {
    const service = new RuntimeDesktopWorkerService(async () =>
      createRuntime({
        session: {
          extensionRunner: {
            executeShortcut: async () => false
          }
        }
      })
    )
    await service.startThread({ threadId: 'thread-1', cwd: 'H:/repo' })

    const shortcutResponse = await service.handle({
      kind: 'command',
      id: 'shortcut',
      command: { type: 'shortcut.dispatch', shortcut: 'ctrl+c' }
    })

    expect(shortcutResponse.success).toBe(true)
    expect(shortcutResponse.data).toEqual({ handled: false })
  })
})

function createRuntime(overrides: Partial<AgentSessionRuntime> = {}): AgentSessionRuntime {
  const overrideSession = (overrides.session as Record<string, unknown> | undefined) ?? {}
  const overrideSessionManager =
    (overrideSession.sessionManager as Record<string, unknown> | undefined) ?? {}
  const session = {
    subscribe: () => () => {},
    bindExtensions: async () => {},
    agent: { waitForIdle: async () => {} },
    ...overrideSession,
    sessionManager: {
      getCwd: () => 'H:/repo',
      ...overrideSessionManager
    }
  }
  const { session: _session, ...rest } = overrides
  return {
    session,
    setRebindSession: () => {},
    setBeforeSessionInvalidate: () => {},
    newSession: async () => ({ cancelled: false }),
    fork: async () => ({ cancelled: false }),
    switchSession: async () => ({ cancelled: false }),
    dispose: async () => {},
    ...rest
  } as AgentSessionRuntime
}

function createModel(id: string) {
  return {
    id,
    name: id,
    api: 'openai-responses' as const,
    provider: 'openai' as const,
    baseUrl: 'https://api.openai.com/v1',
    reasoning: true,
    input: ['text' as const],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0
    },
    contextWindow: 128000,
    maxTokens: 16384
  }
}

function createAssistantMessage(
  text: string
): Extract<AgentSessionEvent, { type: 'message_end' }>['message'] {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-responses',
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
}
