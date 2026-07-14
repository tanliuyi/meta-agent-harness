import { uiMessagesToWire } from '@tanstack/ai/client'
import type { ModelMessage, StreamChunk, UIMessage } from '@tanstack/ai/client'
import type { AGUIEvent, RunAgentInput } from '@ag-ui/core'
import type { RunAgentInputContext, SubscribeConnectionAdapter } from '@tanstack/ai-vue'

import { codingAgentApi } from '@renderer/api/coding-agent'

export interface ElectronAgentConnectionTransport {
  connectAgent(input: { threadId: string }): Promise<void>
  disconnectAgent(input: { threadId: string }): Promise<void>
  runAgent(input: RunAgentInput): Promise<void>
  abort(threadId: string): Promise<void>
  onAgentEvent(listener: (event: AGUIEvent) => void): () => void
}

export interface ElectronSubscribeConnectionAdapterOptions {
  threadId: string
  transport?: ElectronAgentConnectionTransport
}

interface RunAbortRegistration {
  signal: AbortSignal
  listener: () => void
}

interface ActiveRendererSubscription {
  owner: symbol
  stop: () => void
}

const rendererSubscriptionCoordinators = new WeakMap<
  ElectronAgentConnectionTransport,
  RendererSubscriptionCoordinator
>()

/**
 * Bridge TanStack AI's persistent subscription transport to the controlled
 * Electron preload API. Events stay as unwrapped AG-UI StreamChunks.
 */
export function createElectronSubscribeConnectionAdapter(
  options: ElectronSubscribeConnectionAdapterOptions
): SubscribeConnectionAdapter {
  const { threadId } = options
  const transport = options.transport ?? codingAgentApi
  const runAbortRegistrations = new Map<string, RunAbortRegistration>()
  const subscriptionCoordinator = getSubscriptionCoordinator(transport)

  const clearRunAbortRegistration = (runId: string): void => {
    const registration = runAbortRegistrations.get(runId)
    if (!registration) return
    registration.signal.removeEventListener('abort', registration.listener)
    runAbortRegistrations.delete(runId)
  }

  const clearRunAbortRegistrations = (): void => {
    for (const runId of runAbortRegistrations.keys()) {
      clearRunAbortRegistration(runId)
    }
  }

  return {
    async *subscribe(signal?: AbortSignal): AsyncIterable<StreamChunk> {
      if (signal?.aborted) return

      const owner = Symbol(threadId)
      const queue = new AsyncEventQueue<StreamChunk>()
      let stopped = false
      let connected = false

      const unsubscribe = transport.onAgentEvent((event) => {
        const chunk = event as StreamChunk
        settleRunAbortRegistration(chunk, clearRunAbortRegistration, clearRunAbortRegistrations)
        queue.push(chunk)
      })
      const stop = (): void => {
        if (stopped) return
        stopped = true
        signal?.removeEventListener('abort', stop)
        unsubscribe()
        clearRunAbortRegistrations()
        queue.close()
      }

      subscriptionCoordinator.activate({ owner, stop })
      signal?.addEventListener('abort', stop, { once: true })

      try {
        await transport.connectAgent({ threadId })
        connected = true

        if (signal?.aborted || !subscriptionCoordinator.isOwner(owner)) return

        for await (const event of queue) {
          yield event
        }
      } finally {
        stop()
        if (subscriptionCoordinator.release(owner) && connected) {
          await ignoreDisconnectError(transport.disconnectAgent({ threadId }))
        }
      }
    },

    async send(
      messages: Array<UIMessage> | Array<ModelMessage>,
      data?: Record<string, unknown>,
      signal?: AbortSignal,
      runContext?: RunAgentInputContext
    ): Promise<void> {
      if (!runContext) {
        throw new Error('Electron agent connection requires a TanStack RunAgentInputContext')
      }
      if (runContext.threadId !== threadId) {
        throw new Error(
          `Electron agent connection is bound to thread ${threadId}, received ${runContext.threadId}`
        )
      }
      if (signal?.aborted) throw createAbortError()

      if (runContext.clientTools && runContext.clientTools.length > 0) {
        throw new Error('Client-provided AG-UI tools are not supported by the desktop Pi runtime')
      }

      const runId = runContext.runId
      clearRunAbortRegistration(runId)

      let abortRequested = false
      if (signal) {
        const abortRun = (): void => {
          abortRequested = true
          void transport.abort(threadId).catch(() => undefined)
        }
        runAbortRegistrations.set(runId, { signal, listener: abortRun })
        signal.addEventListener('abort', abortRun, { once: true })
      }

      const forwardedProps = {
        ...(runContext.forwardedProps ?? {}),
        ...(data ?? {})
      }
      const input: RunAgentInput = {
        threadId,
        runId,
        ...(runContext.parentRunId !== undefined && { parentRunId: runContext.parentRunId }),
        state: {},
        messages: uiMessagesToWire(messages as Array<UIMessage>) as RunAgentInput['messages'],
        tools: [],
        context: [],
        forwardedProps
      }

      try {
        await transport.runAgent(input)
        if (signal?.aborted && !abortRequested) {
          abortRequested = true
          await transport.abort(threadId)
        }
      } catch (error) {
        clearRunAbortRegistration(runId)
        throw error
      }
    }
  }
}

function getSubscriptionCoordinator(
  transport: ElectronAgentConnectionTransport
): RendererSubscriptionCoordinator {
  const existing = rendererSubscriptionCoordinators.get(transport)
  if (existing) return existing

  const coordinator = new RendererSubscriptionCoordinator()
  rendererSubscriptionCoordinators.set(transport, coordinator)
  return coordinator
}

class RendererSubscriptionCoordinator {
  private active?: ActiveRendererSubscription

  activate(subscription: ActiveRendererSubscription): void {
    this.active?.stop()
    this.active = subscription
  }

  isOwner(owner: symbol): boolean {
    return this.active?.owner === owner
  }

  release(owner: symbol): boolean {
    if (!this.isOwner(owner)) return false
    this.active = undefined
    return true
  }
}

function settleRunAbortRegistration(
  event: StreamChunk,
  clearRun: (runId: string) => void,
  clearAllRuns: () => void
): void {
  if (event.type !== 'RUN_FINISHED' && event.type !== 'RUN_ERROR') return

  const runId = 'runId' in event && typeof event.runId === 'string' ? event.runId : undefined
  if (runId) {
    clearRun(runId)
  } else if (event.type === 'RUN_ERROR') {
    clearAllRuns()
  }
}

function createAbortError(): Error {
  const error = new Error('The agent run was aborted')
  error.name = 'AbortError'
  return error
}

async function ignoreDisconnectError(disconnect: Promise<void>): Promise<void> {
  try {
    await disconnect
  } catch {
    // Subscription teardown is best-effort; the main process also drops stale owners.
  }
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private values: T[] = []
  private pendingResolve?: (result: IteratorResult<T>) => void
  private closed = false

  push(value: T): void {
    if (this.closed) return
    if (this.pendingResolve) {
      const resolve = this.pendingResolve
      this.pendingResolve = undefined
      resolve({ value, done: false })
      return
    }
    this.values.push(value)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.values = []
    if (this.pendingResolve) {
      const resolve = this.pendingResolve
      this.pendingResolve = undefined
      resolve({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift()
        if (value !== undefined) return Promise.resolve({ value, done: false })
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise<IteratorResult<T>>((resolve) => {
          this.pendingResolve = resolve
        })
      }
    }
  }
}
