import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addBrowserTab,
  closeBrowserTab,
  createBrowserTab,
  getBrowserSessionScope,
  MAX_BROWSER_TABS,
  requireBrowserTab,
  restoreBrowserTabs,
  switchBrowserTab,
  transferBrowserSessionScope,
  withBrowserCommandTimeout,
  type BrowserTabsState
} from '../browserPreviewTabs'

function state(): BrowserTabsState {
  return {
    tabs: [createBrowserTab('tab-a', 'https://a.example/')],
    activeBrowserId: 'tab-a'
  }
}

describe('browser preview tabs', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps a draft Browser scope when the draft becomes a thread', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value)
      }
    })
    try {
      expect(getBrowserSessionScope('__orphan__.main.1')).toBe('__orphan__.main.1')
      transferBrowserSessionScope('__orphan__.main.1', 'thread-a')
      expect(getBrowserSessionScope('thread-a', 'thread-a')).toBe('__orphan__.main.1')
      expect(getBrowserSessionScope('thread-b', 'thread-b')).toBe('thread-b')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('falls back to the thread scope when localStorage cannot be read', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('storage unavailable')
        }
      }
    })
    try {
      expect(getBrowserSessionScope('session-storage-read', 'thread-storage-read')).toBe(
        'thread-storage-read'
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps the draft scope in memory when localStorage cannot be written', () => {
    const getItem = vi.fn(() => null)
    vi.stubGlobal('window', {
      localStorage: {
        getItem,
        setItem: () => {
          throw new Error('quota exceeded')
        }
      }
    })
    try {
      expect(() =>
        transferBrowserSessionScope('__orphan__.main.2', 'thread-storage-failure')
      ).not.toThrow()
      expect(getBrowserSessionScope('thread-storage-failure', 'thread-storage-failure')).toBe(
        '__orphan__.main.2'
      )
      expect(getItem).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('opens, targets, and switches independent browser tabs', () => {
    const tabs = state()
    addBrowserTab(tabs, createBrowserTab('tab-b', 'https://b.example/'), false)

    expect(tabs.activeBrowserId).toBe('tab-a')
    expect(requireBrowserTab(tabs).id).toBe('tab-a')
    expect(requireBrowserTab(tabs, 'tab-b').url).toBe('https://b.example/')

    switchBrowserTab(tabs, 'tab-b')
    expect(tabs.activeBrowserId).toBe('tab-b')
  })

  it('selects a neighboring tab when closing the active tab', () => {
    const tabs = state()
    addBrowserTab(tabs, createBrowserTab('tab-b'), true)
    addBrowserTab(tabs, createBrowserTab('tab-c'), false)

    expect(closeBrowserTab(tabs, 'tab-b').id).toBe('tab-b')
    expect(tabs.activeBrowserId).toBe('tab-c')
    expect(tabs.tabs.map((tab) => tab.id)).toEqual(['tab-a', 'tab-c'])
  })

  it('rejects unknown targets and keeps one tab alive', () => {
    const tabs = state()
    expect(() => requireBrowserTab(tabs, 'missing')).toThrow('Browser tab not found')
    expect(() => switchBrowserTab(tabs, 'missing')).toThrow('Browser tab not found')
    expect(() => closeBrowserTab(tabs, 'tab-a')).toThrow('last browser tab')
    expect(tabs.tabs).toHaveLength(1)
    expect(tabs.activeBrowserId).toBe('tab-a')
  })

  it('enforces the tab limit', () => {
    const tabs = state()
    for (let index = 1; index < MAX_BROWSER_TABS; index += 1) {
      addBrowserTab(tabs, createBrowserTab(`tab-${index}`), false)
    }
    expect(tabs.tabs).toHaveLength(MAX_BROWSER_TABS)
    expect(() => addBrowserTab(tabs, createBrowserTab('overflow'))).toThrow('tab limit')
  })

  it('releases a command queue when page execution never settles', async () => {
    vi.useFakeTimers()
    try {
      const timedOut = expect(
        withBrowserCommandTimeout(new Promise(() => undefined), 'execute-js', 25_000)
      ).rejects.toThrow('Browser command timed out in renderer: execute-js')
      await vi.advanceTimersByTimeAsync(25_000)
      await timedOut
      await expect(
        withBrowserCommandTimeout(Promise.resolve('next'), 'snapshot', 25_000)
      ).resolves.toBe('next')
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores only unique valid persisted tabs', () => {
    expect(
      restoreBrowserTabs({
        activeBrowserId: 'duplicate',
        tabs: [
          { id: 'duplicate', url: 'https://one.example/' },
          { id: 'duplicate', url: 'https://two.example/' },
          { id: 'invalid', url: 'file:///tmp/page.html' },
          { id: '', url: 'https://empty-id.example/' },
          { id: '   ', url: 'https://blank-id.example/' },
          { id: 'valid', url: 'https://valid.example/' }
        ]
      })
    ).toEqual({
      activeBrowserId: 'duplicate',
      tabs: [
        createBrowserTab('duplicate', 'https://one.example/'),
        createBrowserTab('valid', 'https://valid.example/')
      ]
    })
    expect(restoreBrowserTabs({ tabs: [{ id: 'bad', url: 'not-a-url' }] })).toBeNull()
  })
})
