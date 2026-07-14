import { AbstractAgent, type AgentConfig } from '@ag-ui/client'
import { EventType, type AGUIEvent, type BaseEvent, type RunAgentInput } from '@ag-ui/core'
import { Observable } from 'rxjs'

import { codingAgentApi } from '@renderer/api/coding-agent'
import { reduceAgUiMessages } from '@shared/coding-agent/ag-ui-messages'

export interface AgentTransport {
  connectAgent(input: { threadId: string }): Promise<void>
  disconnectAgent(input: { threadId: string }): Promise<void>
  runAgent(input: RunAgentInput): Promise<void>
  abort(threadId: string): Promise<void>
  onAgentEvent(listener: (event: AGUIEvent) => void): () => void
}

export interface DesktopAgentConfig extends AgentConfig {
  transport?: AgentTransport
}

/** Standard AG-UI Agent using Electron IPC as its transport. */
export class Agent extends AbstractAgent {
  private transport: AgentTransport
  private detachAttachedFeed?: () => void
  private attachmentGeneration = 0

  constructor(config: DesktopAgentConfig = {}) {
    super(config)
    this.transport = config.transport ?? codingAgentApi
  }

  /** Attach the idle thread feed. This transport lifecycle is separate from AG-UI connectAgent(). */
  async attach(): Promise<void> {
    const generation = ++this.attachmentGeneration
    this.detachAttachedFeed?.()

    const unsubscribe = this.transport.onAgentEvent((event) => {
      if (generation !== this.attachmentGeneration || this.isRunning) return
      const messages = reduceAgUiMessages(this.messages, event)
      if (messages !== this.messages) this.setMessages(messages)
    })
    this.detachAttachedFeed = unsubscribe

    try {
      await this.transport.connectAgent({ threadId: this.threadId })
    } catch (error) {
      if (generation === this.attachmentGeneration) {
        unsubscribe()
        this.detachAttachedFeed = undefined
      }
      throw error
    }
  }

  /** Detach only when this instance still owns the thread feed. */
  async detach(): Promise<void> {
    this.attachmentGeneration += 1
    this.detachAttachedFeed?.()
    this.detachAttachedFeed = undefined
    await this.transport.disconnectAgent({ threadId: this.threadId })
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      let active = true
      let sawTerminalEvent = false
      const unsubscribe = this.transport.onAgentEvent((event) => {
        if (!active) return

        subscriber.next(event)
        if (
          event.type === EventType.RUN_ERROR ||
          (event.type === EventType.RUN_FINISHED &&
            event.threadId === input.threadId &&
            event.runId === input.runId)
        ) {
          sawTerminalEvent = true
          subscriber.complete()
        }
      })

      void this.transport.runAgent(input).then(
        () => {
          if (active && !sawTerminalEvent) {
            subscriber.error(
              new Error(`Agent run ${input.runId} completed without a terminal event`)
            )
          }
        },
        (error: unknown) => {
          if (active) subscriber.error(toError(error))
        }
      )

      return () => {
        active = false
        unsubscribe()
      }
    })
  }

  override abortRun(): void {
    void this.transport.abort(this.threadId)
    super.abortRun()
  }

  override clone(): Agent {
    const cloned = super.clone() as Agent
    cloned.transport = this.transport
    cloned.detachAttachedFeed = undefined
    cloned.attachmentGeneration = 0
    return cloned
  }
}

export function createAgent(config: DesktopAgentConfig): Agent {
  return new Agent(config)
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
