import { generateMessageId, normalizeToUIMessage, uiMessagesToWire } from '@tanstack/ai/client'
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
        const chunk = projectAgentEventForTanStack(event)
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
        messages: uiMessagesToWire(
          messages.map((message) => normalizeToUIMessage(message, generateMessageId))
        ) as RunAgentInput['messages'],
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

export function projectAgentEventForTanStack(event: AGUIEvent): StreamChunk {
  if (event.type === 'TOOL_CALL_RESULT') {
    const isError = getRecord(event.rawEvent)?.isError === true
    return {
      ...event,
      state: isError ? 'output-error' : 'output-available'
    } as StreamChunk
  }
  if (event.type !== 'MESSAGES_SNAPSHOT') return event as StreamChunk

  const toolResults = new Map<string, { content: string; error?: string }>()
  for (const message of event.messages) {
    if (message.role === 'tool') {
      toolResults.set(message.toolCallId, {
        content: message.content,
        ...(message.error ? { error: message.error } : {})
      })
    }
  }

  return {
    ...event,
    messages: event.messages.map((message) => {
      if (message.role === 'assistant' && message.toolCalls) {
        const hasToolResult = message.toolCalls.some((toolCall) => toolResults.has(toolCall.id))
        if (!hasToolResult) return message

        return {
          id: message.id,
          role: 'assistant',
          parts: [
            ...(message.content ? [{ type: 'text' as const, content: message.content }] : []),
            ...message.toolCalls.map((toolCall) => {
              const result = toolResults.get(toolCall.id)
              return {
                type: 'tool-call' as const,
                id: toolCall.id,
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
                state: result
                  ? result.error
                    ? ('error' as const)
                    : ('complete' as const)
                  : ('input-complete' as const),
                ...(result && {
                  output: result.error
                    ? { error: result.error }
                    : parseToolResultContent(result.content)
                })
              }
            })
          ]
        }
      }
      if (message.role !== 'tool' || !message.error) return message
      return {
        id: message.id,
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: message.toolCallId,
            content: message.content,
            state: 'error',
            error: message.error
          }
        ]
      }
    })
  } as StreamChunk
}

function parseToolResultContent(content: string): unknown {
  try {
    return JSON.parse(content)
  } catch {
    return content
  }
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
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
