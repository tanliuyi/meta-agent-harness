import { reactive } from 'vue'

export interface ChatDisplayOpenState {
  collapsedHistory: Record<string, boolean>
  toolGroups: Record<string, boolean>
}

const states = new Map<string, ChatDisplayOpenState>()

export function getChatDisplayOpenState(stateKey: string): ChatDisplayOpenState {
  const existing = states.get(stateKey)
  if (existing) return existing
  const state = reactive<ChatDisplayOpenState>({
    collapsedHistory: {},
    toolGroups: {}
  })
  states.set(stateKey, state)
  return state
}

export function pruneChatDisplayOpenState(
  state: ChatDisplayOpenState,
  historyKeys: ReadonlySet<string>,
  toolGroupKeys: ReadonlySet<string>
): void {
  for (const key of Object.keys(state.collapsedHistory)) {
    if (!historyKeys.has(key)) delete state.collapsedHistory[key]
  }
  for (const key of Object.keys(state.toolGroups)) {
    if (!toolGroupKeys.has(key)) delete state.toolGroups[key]
  }
}
