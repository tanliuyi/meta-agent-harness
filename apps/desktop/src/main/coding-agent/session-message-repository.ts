/** Main-owned standard AG-UI session message projections. */

import type { AGUIEvent, Message, MessagesSnapshotEvent } from '@ag-ui/core'
import {
  createMessagesSnapshot,
  reduceAgUiMessages,
  toAgUiMessages
} from '@shared/coding-agent/ag-ui-messages'
import type { AgentSessionIpcEvent, ThreadMessage } from '@shared/coding-agent/types'
import { PiAgUiAdapter } from './pi-ag-ui-adapter'

interface SessionMessageState {
  generation: number
  messages?: Message[]
  pendingEvents: AGUIEvent[]
  loading?: Promise<void>
}

/** Canonical persistence remains Pi JSONL; only its renderer-facing AG-UI projection is cached. */
export class SessionMessageRepository {
  private readonly states = new Map<string, SessionMessageState>()
  private readonly adapter = new PiAgUiAdapter()

  constructor(private readonly loadMessages: (sessionId: string) => Promise<ThreadMessage[]>) {}

  record(event: AgentSessionIpcEvent): AGUIEvent[] {
    const state = this.ensureState(event.threadId)
    const events = this.adapter.adapt(event)
    if (state.messages) {
      for (const agUiEvent of events) {
        state.messages = reduceAgUiMessages(state.messages, agUiEvent)
      }
    } else {
      state.pendingEvents.push(...events)
    }
    return events
  }

  async get(sessionId: string): Promise<MessagesSnapshotEvent> {
    const state = this.ensureState(sessionId)
    while (!state.messages) {
      if (!state.loading) {
        const generation = state.generation
        const loading = this.initialize(sessionId, state, generation)
        state.loading = loading
        const clearLoading = (): void => {
          if (state.loading === loading) state.loading = undefined
        }
        void loading.then(clearLoading, clearLoading)
      }
      await state.loading
    }
    return createMessagesSnapshot(state.messages)
  }

  replace(sessionId: string, messages: ThreadMessage[]): void {
    const state = this.ensureState(sessionId)
    state.generation += 1
    state.messages = toAgUiMessages(messages)
    state.pendingEvents = []
    state.loading = undefined
  }

  /** Forces the next snapshot to rebuild from the worker/Pi JSONL source. */
  invalidate(sessionId: string): void {
    const state = this.ensureState(sessionId)
    state.generation += 1
    state.messages = undefined
    state.pendingEvents = []
    state.loading = undefined
  }

  private async initialize(
    sessionId: string,
    state: SessionMessageState,
    generation: number
  ): Promise<void> {
    let messages = toAgUiMessages(await this.loadMessages(sessionId))
    if (state.generation !== generation) return
    for (const event of state.pendingEvents) {
      messages = reduceAgUiMessages(messages, event)
    }
    if (state.generation !== generation) return
    state.messages = messages
    state.pendingEvents = []
  }

  private ensureState(sessionId: string): SessionMessageState {
    let state = this.states.get(sessionId)
    if (!state) {
      state = { generation: 0, pendingEvents: [] }
      this.states.set(sessionId, state)
    }
    return state
  }
}
