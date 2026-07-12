import {
  createBrowserTab,
  DEFAULT_BROWSER_URL,
  normalizeBrowserUrl,
  restoreBrowserTabs,
  type BrowserTabsState
} from './browserPreviewTabs'

type BrowserPreviewStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>

interface MigrateLegacyBrowserPreviewStorageInput {
  createBrowserId: () => string
  legacyScope: string
  storage: BrowserPreviewStorage
  targetScope: string
}

const tabsKey = (scope: string): string => `meta-agent.browser-preview.tabs:${scope}`
const pageKey = (kind: 'url' | 'device' | 'device-toolbar', scope: string): string =>
  `meta-agent.browser-preview.${kind}:${scope}`
const migrationKey = (legacyScope: string): string =>
  `meta-agent.browser-preview.migrated-v0.0.20:${legacyScope}`

function readLegacyTabs(
  storage: BrowserPreviewStorage,
  legacyScope: string
): BrowserTabsState | null {
  const stored = storage.getItem(tabsKey(legacyScope))
  try {
    return restoreBrowserTabs(JSON.parse(stored || ''))
  } catch {
    return null
  }
}

function copyPageStorage(
  storage: BrowserPreviewStorage,
  sourcePageScope: string,
  targetPageScope: string
): void {
  for (const kind of ['url', 'device', 'device-toolbar'] as const) {
    const targetKey = pageKey(kind, targetPageScope)
    if (storage.getItem(targetKey) !== null) continue
    const value = storage.getItem(pageKey(kind, sourcePageScope))
    if (value !== null) storage.setItem(targetKey, value)
  }
}

function persistMigratedTabs(
  storage: BrowserPreviewStorage,
  targetScope: string,
  state: BrowserTabsState
): void {
  storage.setItem(
    tabsKey(targetScope),
    JSON.stringify({
      activeBrowserId: state.activeBrowserId,
      tabs: state.tabs.map(({ id, url }) => ({ id, url }))
    })
  )
}

function removePageStorage(storage: BrowserPreviewStorage, pageScope: string): void {
  for (const kind of ['url', 'device', 'device-toolbar'] as const) {
    storage.removeItem(pageKey(kind, pageScope))
  }
}

function removeLegacyStorage(
  storage: BrowserPreviewStorage,
  legacyScope: string,
  legacyBrowserIds: string[]
): void {
  removePageStorage(storage, legacyScope)
  for (const browserId of legacyBrowserIds) removePageStorage(storage, browserId)
  storage.removeItem(tabsKey(legacyScope))
}

export function migrateLegacyBrowserPreviewStorage(
  input: MigrateLegacyBrowserPreviewStorageInput
): void {
  const { createBrowserId, legacyScope, storage, targetScope } = input
  const markerKey = migrationKey(legacyScope)

  try {
    if (storage.getItem(markerKey) !== null) return
    const legacyTabs = readLegacyTabs(storage, legacyScope)
    if (storage.getItem(tabsKey(targetScope)) !== null) {
      removeLegacyStorage(storage, legacyScope, legacyTabs?.tabs.map((tab) => tab.id) ?? [])
      storage.setItem(markerKey, targetScope)
      return
    }

    if (legacyTabs) {
      for (const tab of legacyTabs.tabs) {
        copyPageStorage(storage, tab.id, `${targetScope}:${tab.id}`)
      }
      persistMigratedTabs(storage, targetScope, legacyTabs)
    } else {
      const legacyUrl = storage.getItem(pageKey('url', legacyScope))
      const hasLegacyPageState =
        legacyUrl !== null ||
        storage.getItem(pageKey('device', legacyScope)) !== null ||
        storage.getItem(pageKey('device-toolbar', legacyScope)) !== null
      if (hasLegacyPageState) {
        let url = DEFAULT_BROWSER_URL
        try {
          url = normalizeBrowserUrl(legacyUrl || DEFAULT_BROWSER_URL)
        } catch {
          // Invalid legacy URLs fall back while preserving valid device state.
        }
        const tab = createBrowserTab(createBrowserId(), url)
        copyPageStorage(storage, legacyScope, `${targetScope}:${tab.id}`)
        persistMigratedTabs(storage, targetScope, {
          tabs: [tab],
          activeBrowserId: tab.id
        })
      }
    }

    removeLegacyStorage(storage, legacyScope, legacyTabs?.tabs.map((tab) => tab.id) ?? [])
    storage.setItem(markerKey, targetScope)
  } catch {
    // Storage failures leave the marker unset so a later mount can retry.
  }
}
