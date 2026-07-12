export type BrowserRevealDecision = 'reveal' | 'attention' | 'background'

const AUTO_REVEAL_COMMANDS = new Set(['open', 'navigate'])
const VISIBLE_COMMANDS = new Set(['switch', 'action', 'execute-js', 'set-viewport'])

export function decideBrowserReveal(input: {
  command: string
  activeThread: boolean
  browserVisible: boolean
  panelOpen: boolean
  autoRevealed: boolean
  recentlyCollapsed: boolean
}): BrowserRevealDecision {
  if (!input.activeThread) return 'attention'

  if (AUTO_REVEAL_COMMANDS.has(input.command)) {
    if (input.autoRevealed) return input.browserVisible ? 'background' : 'attention'
    return input.recentlyCollapsed ? 'attention' : 'reveal'
  }

  if (VISIBLE_COMMANDS.has(input.command)) {
    return input.panelOpen ? 'reveal' : 'attention'
  }

  return 'background'
}
