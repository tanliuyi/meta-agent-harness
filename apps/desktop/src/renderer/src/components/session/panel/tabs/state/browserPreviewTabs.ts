export const DEFAULT_BROWSER_URL = 'http://127.0.0.1:3000'
export const MAX_BROWSER_TABS = 20
const BROWSER_SESSION_SCOPE_STORAGE_PREFIX = 'meta-agent.browser-preview.session-scope:'
const browserSessionScopeByThreadId = new Map<string, string>()

export interface BrowserTab {
  id: string
  title: string
  url: string
  loading: boolean
  webContentsId?: number
}

export interface BrowserTabsState {
  tabs: BrowserTab[]
  activeBrowserId: string
}

export function getBrowserSessionScope(sessionKey: string, threadId?: string): string {
  if (!threadId) return sessionKey
  const volatileScope = browserSessionScopeByThreadId.get(threadId)
  if (volatileScope !== undefined) return volatileScope
  try {
    const storedScope = window.localStorage.getItem(
      `${BROWSER_SESSION_SCOPE_STORAGE_PREFIX}${threadId}`
    )
    if (storedScope) {
      browserSessionScopeByThreadId.set(threadId, storedScope)
      return storedScope
    }
  } catch {
    // Fall through to the thread scope when persisted state is unavailable.
  }
  return threadId
}

export function transferBrowserSessionScope(sourceScope: string, threadId: string): void {
  browserSessionScopeByThreadId.set(threadId, sourceScope)
  try {
    window.localStorage.setItem(`${BROWSER_SESSION_SCOPE_STORAGE_PREFIX}${threadId}`, sourceScope)
  } catch {
    // Browser state persistence is best-effort and must not interrupt thread creation.
  }
}

export function normalizeBrowserUrl(value: unknown): string {
  const url = new URL(typeof value === 'string' && value ? value : DEFAULT_BROWSER_URL)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP(S) URLs are allowed')
  if (url.username || url.password) throw new Error('URLs containing credentials are not allowed')
  return url.toString()
}

export function restoreBrowserTabs(value: unknown): BrowserTabsState | null {
  if (!value || typeof value !== 'object') return null
  const stored = value as { activeBrowserId?: unknown; tabs?: unknown }
  if (!Array.isArray(stored.tabs)) return null

  const seenIds = new Set<string>()
  const tabs: BrowserTab[] = []
  for (const candidate of stored.tabs) {
    if (!candidate || typeof candidate !== 'object') continue
    const tab = candidate as { id?: unknown; url?: unknown }
    if (
      typeof tab.id !== 'string' ||
      !tab.id.trim() ||
      typeof tab.url !== 'string' ||
      seenIds.has(tab.id)
    ) {
      continue
    }
    try {
      tabs.push(createBrowserTab(tab.id, normalizeBrowserUrl(tab.url)))
      seenIds.add(tab.id)
    } catch {
      // Skip corrupted persisted entries while preserving valid tabs.
    }
    if (tabs.length >= MAX_BROWSER_TABS) break
  }
  if (!tabs.length) return null
  const activeBrowserId =
    typeof stored.activeBrowserId === 'string' &&
    tabs.some((tab) => tab.id === stored.activeBrowserId)
      ? stored.activeBrowserId
      : tabs[0].id
  return { tabs, activeBrowserId }
}

export function withBrowserCommandTimeout<T>(
  operation: Promise<T>,
  command: string,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(
      () => reject(new Error(`Browser command timed out in renderer: ${command}`)),
      timeoutMs
    )
    operation.then(
      (value) => {
        globalThis.clearTimeout(timer)
        resolve(value)
      },
      (cause) => {
        globalThis.clearTimeout(timer)
        reject(cause)
      }
    )
  })
}

export function createBrowserTab(id: string, url = DEFAULT_BROWSER_URL): BrowserTab {
  return { id, title: 'New tab', url, loading: false }
}

export function addBrowserTab(
  state: BrowserTabsState,
  tab: BrowserTab,
  activate = true
): BrowserTab {
  if (state.tabs.length >= MAX_BROWSER_TABS) {
    throw new Error(`Browser tab limit reached (${MAX_BROWSER_TABS})`)
  }
  if (state.tabs.some((entry) => entry.id === tab.id)) {
    throw new Error(`Browser tab already exists: ${tab.id}`)
  }
  state.tabs.push(tab)
  if (activate) state.activeBrowserId = tab.id
  return tab
}

export function switchBrowserTab(state: BrowserTabsState, browserId: string): BrowserTab {
  const tab = requireBrowserTab(state, browserId)
  state.activeBrowserId = tab.id
  return tab
}

export function closeBrowserTab(state: BrowserTabsState, browserId: string): BrowserTab {
  if (state.tabs.length === 1) throw new Error('The last browser tab cannot be closed')
  const index = state.tabs.findIndex((tab) => tab.id === browserId)
  if (index < 0) throw new Error(`Browser tab not found: ${browserId}`)
  const [closed] = state.tabs.splice(index, 1)
  if (state.activeBrowserId === browserId) {
    state.activeBrowserId = state.tabs[Math.min(index, state.tabs.length - 1)].id
  }
  return closed
}

export function requireBrowserTab(state: BrowserTabsState, browserId?: string): BrowserTab {
  const resolvedId = browserId || state.activeBrowserId
  const tab = state.tabs.find((entry) => entry.id === resolvedId)
  if (!tab) throw new Error(`Browser tab not found: ${resolvedId}`)
  return tab
}
