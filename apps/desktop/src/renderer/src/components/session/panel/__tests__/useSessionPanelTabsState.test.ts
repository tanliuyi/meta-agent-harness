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
  it('初次展开默认打开 tab-picker（无预开 tab）', () => {
    const sessionKey = ref<string | undefined>('thread-a')
    const state = useSessionPanelTabsState(ref(tabs), sessionKey)

    expect(state.activeTabId.value).toBeUndefined()
    expect(state.openTabs.value.map((tab) => tab.id)).toEqual([])
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
    expect(state.openTabs.value.map((tab) => tab.id)).toEqual([browserTab.id])
    expect(window.localStorage.getItem('meta-agent.session-panel.tabs.v2.__orphan__')).toBeNull()
    expect(
      window.localStorage.getItem('meta-agent.session-panel.active-tab.v2.__orphan__')
    ).toBeNull()

    sessionKey.value = '__orphan__.fresh'
    expect(state.activeTabId.value).toBeUndefined()
    expect(state.openTabs.value.map((tab) => tab.id)).toEqual([])
  })

  it('按 session key 隔离 active tab 与 opened tabs', () => {
    const sessionKey = ref<string | undefined>('thread-a')
    const state = useSessionPanelTabsState(ref(tabs), sessionKey)

    state.openTab('tree')
    const threadATreeInstanceId = state.activeTabInstanceId.value

    expect(state.activeTabId.value).toBe('tree')
    expect(state.openTabs.value.map((tab) => tab.id)).toEqual(['tree'])

    sessionKey.value = 'thread-b'

    expect(state.activeTabId.value).toBeUndefined()
    expect(state.openTabs.value.map((tab) => tab.id)).toEqual([])

    state.openTab('approvals')
    const threadBSessionInstanceId = state.openTabs.value[0].instanceId
    state.closeTab(threadBSessionInstanceId)

    sessionKey.value = 'thread-a'

    expect(state.activeTabId.value).toBe('tree')
    expect(state.activeTabInstanceId.value).toBe(threadATreeInstanceId)
    expect(state.openTabs.value.map((tab) => tab.id)).toEqual(['tree'])

    sessionKey.value = 'thread-b'

    expect(state.activeTabId.value).toBeUndefined()
    expect(state.openTabs.value.map((tab) => tab.id)).toEqual([])
  })

  it('允许声明支持多开的 tab 同时存在多个实例，并且关闭单个实例', () => {
    const sessionKey = ref<string | undefined>('thread-a')
    const state = useSessionPanelTabsState(ref(tabs), sessionKey)

    state.openTab('tree')
    const firstTreeInstanceId = state.activeTabInstanceId.value
    state.openTab('tree')
    const secondTreeInstanceId = state.activeTabInstanceId.value

    expect(firstTreeInstanceId).not.toBe(secondTreeInstanceId)
    expect(state.openTabs.value.map((tab) => tab.id)).toEqual(['tree', 'tree'])

    state.closeTab(firstTreeInstanceId)

    expect(state.openTabs.value.map((tab) => tab.instanceId)).not.toContain(firstTreeInstanceId)
    expect(state.openTabs.value.map((tab) => tab.instanceId)).toContain(secondTreeInstanceId)
    expect(state.openTabs.value.map((tab) => tab.id)).toEqual(['tree'])
  })

  it('不支持多开的 tab 已打开时再次打开会选中已有实例', () => {
    const sessionKey = ref<string | undefined>('thread-a')
    const state = useSessionPanelTabsState(ref(singleSessionTabs), sessionKey)

    state.openTab('session')
    const sessionInstanceId = state.activeTabInstanceId.value
    state.openTab('session')

    expect(state.activeTabInstanceId.value).toBe(sessionInstanceId)
    expect(state.openTabs.value.map((tab) => tab.id)).toEqual(['session'])
    expect(state.availableTabs.value.map((tab) => tab.id)).not.toContain('session')
  })

  it('可按目标 session key 记录后台 extension tab attention', () => {
    const browserTab: SessionPanelTab = {
      id: 'extension:browser-preview',
      label: 'Browser',
      allowMultiple: false
    }
    const sessionKey = ref<string | undefined>('thread-a')
    const state = useSessionPanelTabsState(ref([...singleSessionTabs, browserTab]), sessionKey)

    state.markTabAttention(browserTab.id, 'thread-b')
    expect(state.attentionTabIds.value).toEqual([])

    sessionKey.value = 'thread-b'
    expect(state.attentionTabIds.value).toEqual([browserTab.id])

    state.openTab(browserTab.id)
    state.clearTabAttention(browserTab.id)
    expect(state.attentionTabIds.value).toEqual([])
  })

  it('面板折叠时可强制标记当前 active tab attention', () => {
    const browserTab: SessionPanelTab = {
      id: 'extension:browser-preview',
      label: 'Browser',
      allowMultiple: false
    }
    const sessionKey = ref<string | undefined>('thread-a')
    const state = useSessionPanelTabsState(ref([...singleSessionTabs, browserTab]), sessionKey)

    state.openTab(browserTab.id)
    state.markTabAttention(browserTab.id, 'thread-a', true)
    expect(state.attentionTabIds.value).toEqual([browserTab.id])

    state.clearTabAttention(browserTab.id)
    expect(state.attentionTabIds.value).toEqual([])
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

  it('关闭目标 extension tab 时保留其他 tab 的稳定 instanceId', () => {
    const sessionKey = ref<string | undefined>('thread-a')
    const extensionTabs: SessionPanelTab[] = [
      ...singleSessionTabs,
      { id: 'extension:deploy', label: 'Deploy', allowMultiple: false },
      { id: 'extension:logs', label: 'Logs', allowMultiple: false }
    ]
    const state = useSessionPanelTabsState(ref(extensionTabs), sessionKey)

    state.openTab('extension:deploy')
    const deployInstanceId = state.activeTabInstanceId.value
    state.openTab('extension:logs')
    const logsInstanceId = state.activeTabInstanceId.value
    state.closeTab(deployInstanceId)

    expect(state.activeTabId.value).toBe('extension:logs')
    expect(state.activeTabInstanceId.value).toBe(logsInstanceId)
    expect(state.openTabs.value).toEqual([
      expect.objectContaining({ id: 'extension:logs', instanceId: logsInstanceId })
    ])
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
    expect(reloadedState.openTabs.value.map((tab) => tab.id)).toEqual(['extension:deploy'])
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
