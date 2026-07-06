import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useSessionPanelTabsState } from '../state/useSessionPanelTabsState'
import type { SessionPanelTab } from '../model/types'

const tabs: SessionPanelTab[] = [
  { id: 'session', label: 'Session', allowMultiple: true },
  { id: 'changes', label: 'Changes', allowMultiple: true },
  { id: 'tree', label: 'Tree', allowMultiple: true },
  { id: 'commands', label: 'Commands', allowMultiple: true },
  { id: 'extensions', label: 'Extensions', allowMultiple: true },
  { id: 'approvals', label: 'Approvals', allowMultiple: true }
]

const singleSessionTabs: SessionPanelTab[] = tabs.map((tab) =>
  tab.id === 'session' ? { ...tab, allowMultiple: false } : tab
)

beforeEach(() => {
  const storage = createMemoryStorage()
  vi.stubGlobal('window', { localStorage: storage })
  window.localStorage.clear()
})

describe('useSessionPanelTabsState', () => {
  it('默认只打开 Session，其他 tab 通过可添加列表进入', () => {
    const sessionKey = ref<string | undefined>('thread-a')
    const state = useSessionPanelTabsState(tabs, sessionKey)

    expect(state.activeTabId.value).toBe('session')
    expect(state.openTabs.value.map((tab) => tab.id)).toEqual(['session'])
    expect(state.availableTabs.value.map((tab) => tab.id)).toEqual(tabs.map((tab) => tab.id))
  })

  it('按 session key 隔离 active tab 与 opened tabs', () => {
    const sessionKey = ref<string | undefined>('thread-a')
    const state = useSessionPanelTabsState(tabs, sessionKey)

    state.openTab('tree')
    const threadATreeInstanceId = state.activeTabInstanceId.value

    expect(state.activeTabId.value).toBe('tree')
    expect(state.openTabs.value.map((tab) => tab.id)).toEqual(['session', 'tree'])

    sessionKey.value = 'thread-b'

    expect(state.activeTabId.value).toBe('session')
    expect(state.openTabs.value.map((tab) => tab.id)).toEqual(['session'])

    state.openTab('approvals')
    const threadBSessionInstanceId = state.openTabs.value[0].instanceId
    state.closeTab(threadBSessionInstanceId)

    sessionKey.value = 'thread-a'

    expect(state.activeTabId.value).toBe('tree')
    expect(state.activeTabInstanceId.value).toBe(threadATreeInstanceId)
    expect(state.openTabs.value.map((tab) => tab.id)).toEqual(['session', 'tree'])

    sessionKey.value = 'thread-b'

    expect(state.activeTabId.value).toBe('approvals')
    expect(state.openTabs.value.map((tab) => tab.id)).toEqual(['approvals'])
  })

  it('允许声明支持多开的 tab 同时存在多个实例，并且关闭单个实例', () => {
    const sessionKey = ref<string | undefined>('thread-a')
    const state = useSessionPanelTabsState(tabs, sessionKey)

    state.openTab('tree')
    const firstTreeInstanceId = state.activeTabInstanceId.value
    state.openTab('tree')
    const secondTreeInstanceId = state.activeTabInstanceId.value

    expect(firstTreeInstanceId).not.toBe(secondTreeInstanceId)
    expect(state.openTabs.value.map((tab) => tab.id)).toEqual(['session', 'tree', 'tree'])

    state.closeTab(firstTreeInstanceId)

    expect(state.openTabs.value.map((tab) => tab.instanceId)).not.toContain(firstTreeInstanceId)
    expect(state.openTabs.value.map((tab) => tab.instanceId)).toContain(secondTreeInstanceId)
    expect(state.openTabs.value.map((tab) => tab.id)).toEqual(['session', 'tree'])
  })

  it('不支持多开的 tab 已打开时再次打开会选中已有实例', () => {
    const sessionKey = ref<string | undefined>('thread-a')
    const state = useSessionPanelTabsState(singleSessionTabs, sessionKey)

    const sessionInstanceId = state.activeTabInstanceId.value
    state.openTab('session')

    expect(state.activeTabInstanceId.value).toBe(sessionInstanceId)
    expect(state.openTabs.value.map((tab) => tab.id)).toEqual(['session'])
    expect(state.availableTabs.value.map((tab) => tab.id)).not.toContain('session')
  })
})

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key)
    },
    setItem: (key: string, value: string) => {
      values.set(key, value)
    }
  }
}
