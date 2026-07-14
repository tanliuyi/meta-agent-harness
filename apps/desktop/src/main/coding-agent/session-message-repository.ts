/** Main-owned standard AG-UI session message projections. */

import type { AGUIEvent, Message, MessagesSnapshotEvent } from '@ag-ui/core'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import {
  createMessagesSnapshot,
  reduceAgUiMessages,
  toAgUiMessages
} from '@shared/coding-agent/ag-ui-messages'
import type { AgentSessionIpcEvent } from '@shared/coding-agent/types'
import { PiAgUiAdapter } from './pi-ag-ui-adapter'

interface SessionMessageState {
  generation: number
  messages?: Message[]
  pendingEvents: AGUIEvent[]
  loading?: Promise<void>
}

interface CanonicalMessageHistory {
  messages: AgentMessage[]
  messageEntryIds?: string[]
}

/** Canonical persistence remains Pi JSONL; only its renderer-facing AG-UI projection is cached. */
export class SessionMessageRepository {
  private readonly states = new Map<string, SessionMessageState>()
  private readonly adapter = new PiAgUiAdapter()

  constructor(
    private readonly loadCanonicalMessages: (
      sessionId: string
    ) => Promise<AgentMessage[] | CanonicalMessageHistory>
  ) {}

  prepareRun(sessionId: string, runId: string): void {
    this.adapter.prepareRun(sessionId, runId)
  }

  startPreparedRun(sessionId: string, runId: string): AGUIEvent {
    return this.adapter.startPreparedRun(sessionId, runId)
  }

  cancelPreparedRun(sessionId: string, runId: string): void {
    this.adapter.cancelPreparedRun(sessionId, runId)
  }

  failRun(sessionId: string, message: string, runId?: string): AGUIEvent | undefined {
    const event = this.adapter.failRun(sessionId, message, runId)
    this.invalidate(sessionId)
    return event
  }

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

  async mergeMessages(sessionId: string, messages: Message[]): Promise<MessagesSnapshotEvent> {
    await this.get(sessionId)
    const state = this.ensureState(sessionId)
    const messageIds = new Set(state.messages!.map((message) => message.id))
    for (const message of messages) {
      // Pi JSONL is the canonical source for assistant, reasoning, and tool history.
      // The client sends its complete UI history with every run, and TanStack may
      // regenerate reasoning IDs while converting that history back to AG-UI wire
      // messages. Merging those projections would append old reasoning as new rows.
      if (message.role !== 'user') continue
      if (!messageIds.has(message.id)) {
        state.messages!.push(message)
        messageIds.add(message.id)
      }
    }
    return createMessagesSnapshot(state.messages!)
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
    const loaded = await this.loadCanonicalMessages(sessionId)
    let messages = Array.isArray(loaded)
      ? toAgUiMessages(loaded)
      : toAgUiMessages(loaded.messages, loaded.messageEntryIds)
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
