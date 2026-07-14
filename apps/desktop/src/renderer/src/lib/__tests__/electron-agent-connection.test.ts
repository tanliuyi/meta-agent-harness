import { describe, expect, it, vi } from 'vitest'
import type { AGUIEvent, RunAgentInput } from '@ag-ui/core'
import type { RunAgentInputContext } from '@tanstack/ai-vue'
import type { UIMessage } from '@tanstack/ai/client'

import {
  createElectronSubscribeConnectionAdapter,
  type ElectronAgentConnectionTransport
} from '../electron-agent-connection'

function createTransport(): ElectronAgentConnectionTransport & {
  emit(event: AGUIEvent): void
} {
  const listeners = new Set<(event: AGUIEvent) => void>()
  return {
    connectAgent: vi.fn(async () => undefined),
    disconnectAgent: vi.fn(async () => undefined),
    runAgent: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    onAgentEvent: vi.fn((listener: (event: AGUIEvent) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    emit(event) {
      for (const listener of listeners) listener(event)
    }
  }
}

function runContext(overrides: Partial<RunAgentInputContext> = {}): RunAgentInputContext {
  return {
    threadId: 'thread-1',
    runId: 'run-1',
    ...overrides
  }
}

function snapshotEvent(): AGUIEvent {
  return {
    type: 'MESSAGES_SNAPSHOT',
    messages: []
  } as AGUIEvent
}

function finishedEvent(runId = 'run-1'): AGUIEvent {
  return {
    type: 'RUN_FINISHED',
    threadId: 'thread-1',
    runId
  } as AGUIEvent
}

describe('createElectronSubscribeConnectionAdapter', () => {
  it('registers the event listener before connecting and yields unwrapped AG-UI events', async () => {
    const transport = createTransport()
    const adapter = createElectronSubscribeConnectionAdapter({
      threadId: 'thread-1',
      transport
    })
    const controller = new AbortController()
    const iterator = adapter.subscribe(controller.signal)[Symbol.asyncIterator]()

    const nextEvent = iterator.next()
    await vi.waitFor(() => {
      expect(transport.onAgentEvent).toHaveBeenCalledOnce()
      expect(transport.connectAgent).toHaveBeenCalledWith({ threadId: 'thread-1' })
    })

    const snapshot = snapshotEvent()
    transport.emit(snapshot)
    await expect(nextEvent).resolves.toEqual({ value: snapshot, done: false })

    controller.abort()
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true })
    expect(transport.disconnectAgent).toHaveBeenCalledWith({ threadId: 'thread-1' })
  })

  it('does not connect when subscription is already aborted', async () => {
    const transport = createTransport()
    const adapter = createElectronSubscribeConnectionAdapter({
      threadId: 'thread-1',
      transport
    })
    const controller = new AbortController()
    controller.abort()

    const iterator = adapter.subscribe(controller.signal)[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true })
    expect(transport.connectAgent).not.toHaveBeenCalled()
    expect(transport.disconnectAgent).not.toHaveBeenCalled()
  })

  it('does not let an already-aborted replacement cancel a healthy subscription', async () => {
    const transport = createTransport()
    const adapter = createElectronSubscribeConnectionAdapter({
      threadId: 'thread-1',
      transport
    })
    const activeController = new AbortController()
    const activeIterator = adapter.subscribe(activeController.signal)[Symbol.asyncIterator]()
    const activeNext = activeIterator.next()
    await vi.waitFor(() => expect(transport.connectAgent).toHaveBeenCalledOnce())

    const abortedController = new AbortController()
    abortedController.abort()
    const abortedIterator = adapter.subscribe(abortedController.signal)[Symbol.asyncIterator]()
    await expect(abortedIterator.next()).resolves.toEqual({ value: undefined, done: true })

    const snapshot = snapshotEvent()
    transport.emit(snapshot)
    await expect(activeNext).resolves.toEqual({ value: snapshot, done: false })

    activeController.abort()
    await expect(activeIterator.next()).resolves.toEqual({ value: undefined, done: true })
    expect(transport.disconnectAgent).toHaveBeenCalledOnce()
  })

  it('prevents an older subscription cleanup from disconnecting its replacement', async () => {
    const transport = createTransport()
    let resolveFirstConnect!: () => void
    const firstConnect = new Promise<void>((resolve) => {
      resolveFirstConnect = resolve
    })
    vi.mocked(transport.connectAgent)
      .mockImplementationOnce(() => firstConnect)
      .mockResolvedValueOnce(undefined)

    const adapter = createElectronSubscribeConnectionAdapter({
      threadId: 'thread-1',
      transport
    })
    const firstController = new AbortController()
    const firstIterator = adapter.subscribe(firstController.signal)[Symbol.asyncIterator]()
    const firstNext = firstIterator.next()
    await vi.waitFor(() => expect(transport.connectAgent).toHaveBeenCalledTimes(1))

    firstController.abort()
    const secondController = new AbortController()
    const secondIterator = adapter.subscribe(secondController.signal)[Symbol.asyncIterator]()
    const secondNext = secondIterator.next()
    await vi.waitFor(() => expect(transport.connectAgent).toHaveBeenCalledTimes(2))

    resolveFirstConnect()
    await expect(firstNext).resolves.toEqual({ value: undefined, done: true })
    expect(transport.disconnectAgent).not.toHaveBeenCalled()

    const snapshot = snapshotEvent()
    transport.emit(snapshot)
    await expect(secondNext).resolves.toEqual({ value: snapshot, done: false })

    secondController.abort()
    await expect(secondIterator.next()).resolves.toEqual({ value: undefined, done: true })
    expect(transport.disconnectAgent).toHaveBeenCalledOnce()
  })

  it('serializes TanStack UI messages into a standard AG-UI RunAgentInput', async () => {
    const transport = createTransport()
    const adapter = createElectronSubscribeConnectionAdapter({
      threadId: 'thread-1',
      transport
    })
    const messages: UIMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', content: 'Hello' }]
      }
    ]

    await adapter.send(
      messages,
      { requestValue: 2 },
      undefined,
      runContext({
        forwardedProps: { baseValue: 1 }
      })
    )

    expect(transport.runAgent).toHaveBeenCalledOnce()
    const input = vi.mocked(transport.runAgent).mock.calls[0][0] as RunAgentInput
    expect(input).toMatchObject({
      threadId: 'thread-1',
      runId: 'run-1',
      state: {},
      context: [],
      forwardedProps: { baseValue: 1, requestValue: 2 },
      tools: []
    })
    expect(input.messages).toEqual([
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', content: 'Hello' }],
        content: 'Hello'
      }
    ])
  })

  it('preserves TanStack ModelMessages that are already in wire form', async () => {
    const transport = createTransport()
    const adapter = createElectronSubscribeConnectionAdapter({
      threadId: 'thread-1',
      transport
    })

    await adapter.send(
      [
        { role: 'user', content: 'Hello from a model message' },
        {
          role: 'assistant',
          content: [{ type: 'text', content: 'Existing response' }]
        }
      ],
      undefined,
      undefined,
      runContext()
    )

    const input = vi.mocked(transport.runAgent).mock.calls[0][0]
    expect(input.messages).toEqual([
      { role: 'user', content: 'Hello from a model message' },
      {
        role: 'assistant',
        content: [{ type: 'text', content: 'Existing response' }]
      }
    ])
  })

  it('rejects missing, mismatched, or unsupported run context before dispatch', async () => {
    const transport = createTransport()
    const adapter = createElectronSubscribeConnectionAdapter({
      threadId: 'thread-1',
      transport
    })

    await expect(adapter.send([], undefined, undefined, undefined)).rejects.toThrow(
      'requires a TanStack RunAgentInputContext'
    )
    await expect(
      adapter.send([], undefined, undefined, runContext({ threadId: 'thread-2' }))
    ).rejects.toThrow('bound to thread thread-1, received thread-2')
    await expect(
      adapter.send(
        [],
        undefined,
        undefined,
        runContext({
          clientTools: [
            {
              name: 'lookup',
              description: 'Look up a value',
              parameters: { type: 'object' }
            }
          ]
        })
      )
    ).rejects.toThrow('Client-provided AG-UI tools are not supported')
    expect(transport.runAgent).not.toHaveBeenCalled()
  })

  it('allows only one live adapter subscription per renderer transport', async () => {
    const transport = createTransport()
    const firstAdapter = createElectronSubscribeConnectionAdapter({
      threadId: 'thread-1',
      transport
    })
    const secondAdapter = createElectronSubscribeConnectionAdapter({
      threadId: 'thread-2',
      transport
    })
    const firstController = new AbortController()
    const firstIterator = firstAdapter.subscribe(firstController.signal)[Symbol.asyncIterator]()
    const firstNext = firstIterator.next()
    await vi.waitFor(() => expect(transport.connectAgent).toHaveBeenCalledTimes(1))

    const secondController = new AbortController()
    const secondIterator = secondAdapter.subscribe(secondController.signal)[Symbol.asyncIterator]()
    const secondNext = secondIterator.next()
    await vi.waitFor(() => expect(transport.connectAgent).toHaveBeenCalledTimes(2))

    await expect(firstNext).resolves.toEqual({ value: undefined, done: true })
    const snapshot = snapshotEvent()
    transport.emit(snapshot)
    await expect(secondNext).resolves.toEqual({ value: snapshot, done: false })
    expect(transport.disconnectAgent).not.toHaveBeenCalled()

    secondController.abort()
    await expect(secondIterator.next()).resolves.toEqual({ value: undefined, done: true })
    expect(transport.disconnectAgent).toHaveBeenCalledWith({ threadId: 'thread-2' })
  })

  it('maps a run abort signal to the bound Electron thread', async () => {
    const transport = createTransport()
    const adapter = createElectronSubscribeConnectionAdapter({
      threadId: 'thread-1',
      transport
    })
    const controller = new AbortController()

    await adapter.send([], undefined, controller.signal, runContext())
    controller.abort()

    await vi.waitFor(() => expect(transport.abort).toHaveBeenCalledWith('thread-1'))
  })

  it('removes the run abort listener after its terminal event', async () => {
    const transport = createTransport()
    const adapter = createElectronSubscribeConnectionAdapter({
      threadId: 'thread-1',
      transport
    })
    const subscriptionController = new AbortController()
    const iterator = adapter.subscribe(subscriptionController.signal)[Symbol.asyncIterator]()
    const nextEvent = iterator.next()
    await vi.waitFor(() => expect(transport.connectAgent).toHaveBeenCalledOnce())

    const runController = new AbortController()
    await adapter.send([], undefined, runController.signal, runContext())
    const terminal = finishedEvent()
    transport.emit(terminal)
    await expect(nextEvent).resolves.toEqual({ value: terminal, done: false })

    runController.abort()
    expect(transport.abort).not.toHaveBeenCalled()

    subscriptionController.abort()
    await iterator.next()
  })
})
