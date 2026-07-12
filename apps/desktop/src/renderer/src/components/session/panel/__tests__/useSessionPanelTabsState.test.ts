import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import {
  transferStoredSessionPanelTabsState,
  useSessionPanelTabsState
} from '../state/useSessionPanelTabsState'
import type { SessionPanelTab } from '../model/types'

const tabs: SessionPanelTab[] = [
  { id: 'session', label: '会话', allowMultiple: true },
  { id: 'changes', label: '变更', allowMultiple: true },
  { id: 'tree', label: '会话树', allowMultiple: true },
  { id: 'commands', label: '命令', allowMultiple: true },
  { id: 'extensions', label: '扩展', allowMultiple: true },
  { id: 'approvals', label: '审批', allowMultiple: true }
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
    const state = useSessionPanelTabsState(ref(tabs), sessionKey)

    expect(state.activeTabId.value).toBe('session')
    expect(state.openTabs.value.map((tab) => tab.id)).toEqual(['session'])
    expect(state.availableTabs.value.map((tab) => tab.id)).toEqual(tabs.map((tab) => tab.id))
  })

  it('草稿绑定到新 session 时迁移 opened tabs 与 active tab', () => {
    const browserTab: SessionPanelTab = {
      id: 'extension:browser-preview',
      label: 'Browser',
      allowMultiple: false
    }
    const sessionKey = ref<string>()
    const state = useSessionPanelTabsState(ref([...singleSessionTabs, browserTab]), sessionKey)

    state.openTab(browserTab.id)
    transferStoredSessionPanelTabsState(undefined, 'thread-new')
    sessionKey.value = 'thread-new'

    expect(state.activeTabId.value).toBe(browserTab.id)
    expect(state.openTabs.value.map((tab) => tab.id)).toEqual(['session', browserTab.id])
    expect(window.localStorage.getItem('meta-agent.session-panel.tabs.v2.__orphan__')).toBeNull()
    expect(
      window.localStorage.getItem('meta-agent.session-panel.active-tab.v2.__orphan__')
    ).toBeNull()

    sessionKey.value = '__orphan__.fresh'
    expect(state.activeTabId.value).toBe('session')
    expect(state.openTabs.value.map((tab) => tab.id)).toEqual(['session'])
  })

  it('按 session key 隔离 active tab 与 opened tabs', () => {
    const sessionKey = ref<string | undefined>('thread-a')
    const state = useSessionPanelTabsState(ref(tabs), sessionKey)

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
    const state = useSessionPanelTabsState(ref(tabs), sessionKey)

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
    const state = useSessionPanelTabsState(ref(singleSessionTabs), sessionKey)

    const sessionInstanceId = state.activeTabInstanceId.value
    state.openTab('session')

    expect(state.activeTabInstanceId.value).toBe(sessionInstanceId)
    expect(state.openTabs.value.map((tab) => tab.id)).toEqual(['session'])
    expect(state.availableTabs.value.map((tab) => tab.id)).not.toContain('session')
  })

  it('支持运行时加入 extension tab', () => {
    const sessionKey = ref<string | undefined>('thread-a')
    const dynamicTabs = ref<SessionPanelTab[]>([...singleSessionTabs])
    const state = useSessionPanelTabsState(dynamicTabs, sessionKey)

    dynamicTabs.value = [
      ...dynamicTabs.value,
      { id: 'extension:deploy', label: 'Deploy', allowMultiple: false }
    ]

    expect(state.availableTabs.value.map((tab) => tab.id)).toContain('extension:deploy')
    state.openTab('extension:deploy')

    expect(state.activeTabId.value).toBe('extension:deploy')
    expect(state.openTabs.value.map((tab) => tab.label)).toContain('Deploy')
  })

  it('reload 后保留尚未重新注册的 extension tab，并在注册后刷新 label', () => {
    const sessionKey = ref<string | undefined>('thread-a')
    const initialTabs = ref<SessionPanelTab[]>([
      ...singleSessionTabs,
      { id: 'extension:deploy', label: 'Deploy', allowMultiple: false }
    ])
    const firstState = useSessionPanelTabsState(initialTabs, sessionKey)
    firstState.openTab('extension:deploy')

    const reloadedTabs = ref<SessionPanelTab[]>([...singleSessionTabs])
    const reloadedState = useSessionPanelTabsState(reloadedTabs, sessionKey)

    expect(reloadedState.activeTabId.value).toBe('extension:deploy')
    expect(reloadedState.openTabs.value.map((tab) => tab.id)).toEqual([
      'session',
      'extension:deploy'
    ])
    expect(reloadedState.openTabs.value.find((tab) => tab.id === 'extension:deploy')?.label).toBe(
      'deploy'
    )

    reloadedTabs.value = [
      ...reloadedTabs.value,
      { id: 'extension:deploy', label: 'Deployments', allowMultiple: false }
    ]

    expect(reloadedState.activeTabId.value).toBe('extension:deploy')
    expect(reloadedState.openTabs.value.find((tab) => tab.id === 'extension:deploy')?.label).toBe(
      'Deployments'
    )
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
