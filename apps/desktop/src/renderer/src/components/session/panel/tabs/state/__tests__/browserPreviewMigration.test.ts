import { describe, expect, it } from 'vitest'
import { migrateLegacyBrowserPreviewStorage } from '../browserPreviewMigration'

function memoryStorage(initial: Record<string, string> = {}): {
  storage: Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>
  values: Map<string, string>
} {
  const values = new Map(Object.entries(initial))
  return {
    values,
    storage: {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value)
    }
  }
}

describe('browser preview v0.0.20 migration', () => {
  it('moves tabs and page settings to the first session scope with browser ids intact', () => {
    const { storage, values } = memoryStorage({
      'meta-agent.browser-preview.tabs:browser-preview': JSON.stringify({
        activeBrowserId: 'tab-b',
        tabs: [
          { id: 'tab-a', url: 'https://a.example/' },
          { id: 'tab-b', url: 'https://b.example/' }
        ]
      }),
      'meta-agent.browser-preview.url:tab-a': 'https://a.example/current',
      'meta-agent.browser-preview.device:tab-a': '{"preset":"iphone-15"}',
      'meta-agent.browser-preview.device-toolbar:tab-b': 'true'
    })

    migrateLegacyBrowserPreviewStorage({
      createBrowserId: () => 'unused',
      legacyScope: 'browser-preview',
      storage,
      targetScope: 'browser-preview:thread-a'
    })

    expect(
      JSON.parse(values.get('meta-agent.browser-preview.tabs:browser-preview:thread-a') || '')
    ).toEqual({
      activeBrowserId: 'tab-b',
      tabs: [
        { id: 'tab-a', url: 'https://a.example/' },
        { id: 'tab-b', url: 'https://b.example/' }
      ]
    })
    expect(values.get('meta-agent.browser-preview.url:browser-preview:thread-a:tab-a')).toBe(
      'https://a.example/current'
    )
    expect(values.get('meta-agent.browser-preview.device:browser-preview:thread-a:tab-a')).toBe(
      '{"preset":"iphone-15"}'
    )
    expect(
      values.get('meta-agent.browser-preview.device-toolbar:browser-preview:thread-a:tab-b')
    ).toBe('true')
    expect(values.has('meta-agent.browser-preview.tabs:browser-preview')).toBe(false)
    expect(values.has('meta-agent.browser-preview.url:tab-a')).toBe(false)
    expect(values.has('meta-agent.browser-preview.device:tab-a')).toBe(false)
    expect(values.has('meta-agent.browser-preview.device-toolbar:tab-b')).toBe(false)
  })

  it('does not overwrite a new scope and never migrates the legacy data into a later scope', () => {
    const targetTabs = JSON.stringify({
      activeBrowserId: 'new-tab',
      tabs: [{ id: 'new-tab', url: 'https://new.example/' }]
    })
    const { storage, values } = memoryStorage({
      'meta-agent.browser-preview.tabs:browser-preview': JSON.stringify({
        activeBrowserId: 'legacy-tab',
        tabs: [{ id: 'legacy-tab', url: 'https://legacy.example/' }]
      }),
      'meta-agent.browser-preview.tabs:browser-preview:thread-a': targetTabs
    })

    migrateLegacyBrowserPreviewStorage({
      createBrowserId: () => 'unused',
      legacyScope: 'browser-preview',
      storage,
      targetScope: 'browser-preview:thread-a'
    })
    migrateLegacyBrowserPreviewStorage({
      createBrowserId: () => 'unused',
      legacyScope: 'browser-preview',
      storage,
      targetScope: 'browser-preview:thread-b'
    })

    expect(values.get('meta-agent.browser-preview.tabs:browser-preview:thread-a')).toBe(targetTabs)
    expect(values.has('meta-agent.browser-preview.tabs:browser-preview:thread-b')).toBe(false)
    expect(values.has('meta-agent.browser-preview.tabs:browser-preview')).toBe(false)
    expect(values.get('meta-agent.browser-preview.migrated-v0.0.20:browser-preview')).toBe(
      'browser-preview:thread-a'
    )
  })

  it('maps the pre-tabs page state to a generated browser id', () => {
    const { storage, values } = memoryStorage({
      'meta-agent.browser-preview.url:browser-preview': 'https://single.example/path',
      'meta-agent.browser-preview.device:browser-preview': '{"preset":"pixel-7"}',
      'meta-agent.browser-preview.device-toolbar:browser-preview': 'true'
    })

    migrateLegacyBrowserPreviewStorage({
      createBrowserId: () => 'tab-migrated',
      legacyScope: 'browser-preview',
      storage,
      targetScope: 'browser-preview:thread-a'
    })

    expect(
      JSON.parse(values.get('meta-agent.browser-preview.tabs:browser-preview:thread-a') || '')
    ).toEqual({
      activeBrowserId: 'tab-migrated',
      tabs: [{ id: 'tab-migrated', url: 'https://single.example/path' }]
    })
    expect(
      values.get('meta-agent.browser-preview.device:browser-preview:thread-a:tab-migrated')
    ).toBe('{"preset":"pixel-7"}')
    expect(
      values.get('meta-agent.browser-preview.device-toolbar:browser-preview:thread-a:tab-migrated')
    ).toBe('true')
    expect(values.has('meta-agent.browser-preview.url:browser-preview')).toBe(false)
    expect(values.has('meta-agent.browser-preview.device:browser-preview')).toBe(false)
    expect(values.has('meta-agent.browser-preview.device-toolbar:browser-preview')).toBe(false)
  })

  it('keeps legacy keys and the marker unset when target persistence fails', () => {
    const legacyTabsKey = 'meta-agent.browser-preview.tabs:browser-preview'
    const legacyUrlKey = 'meta-agent.browser-preview.url:tab-a'
    const targetTabsKey = 'meta-agent.browser-preview.tabs:browser-preview:thread-a'
    const { storage, values } = memoryStorage({
      [legacyTabsKey]: JSON.stringify({
        activeBrowserId: 'tab-a',
        tabs: [{ id: 'tab-a', url: 'https://a.example/' }]
      }),
      [legacyUrlKey]: 'https://a.example/current'
    })
    const failingStorage = {
      ...storage,
      setItem: (key: string, value: string) => {
        if (key === targetTabsKey) throw new Error('quota exceeded')
        storage.setItem(key, value)
      }
    }

    migrateLegacyBrowserPreviewStorage({
      createBrowserId: () => 'unused',
      legacyScope: 'browser-preview',
      storage: failingStorage,
      targetScope: 'browser-preview:thread-a'
    })

    expect(values.has(legacyTabsKey)).toBe(true)
    expect(values.has(legacyUrlKey)).toBe(true)
    expect(values.has('meta-agent.browser-preview.migrated-v0.0.20:browser-preview')).toBe(false)
  })

  it('retries when reading legacy tabs fails without deleting the source state', () => {
    const legacyTabsKey = 'meta-agent.browser-preview.tabs:browser-preview'
    const targetTabsKey = 'meta-agent.browser-preview.tabs:browser-preview:thread-a'
    const markerKey = 'meta-agent.browser-preview.migrated-v0.0.20:browser-preview'
    const legacyTabs = JSON.stringify({
      activeBrowserId: 'tab-a',
      tabs: [{ id: 'tab-a', url: 'https://a.example/' }]
    })
    const { storage, values } = memoryStorage({ [legacyTabsKey]: legacyTabs })
    let failLegacyRead = true
    const flakyStorage = {
      ...storage,
      getItem: (key: string) => {
        if (key === legacyTabsKey && failLegacyRead) {
          failLegacyRead = false
          throw new Error('storage unavailable')
        }
        return storage.getItem(key)
      }
    }

    migrateLegacyBrowserPreviewStorage({
      createBrowserId: () => 'unused',
      legacyScope: 'browser-preview',
      storage: flakyStorage,
      targetScope: 'browser-preview:thread-a'
    })

    expect(values.get(legacyTabsKey)).toBe(legacyTabs)
    expect(values.has(targetTabsKey)).toBe(false)
    expect(values.has(markerKey)).toBe(false)

    migrateLegacyBrowserPreviewStorage({
      createBrowserId: () => 'unused',
      legacyScope: 'browser-preview',
      storage: flakyStorage,
      targetScope: 'browser-preview:thread-a'
    })

    expect(values.has(legacyTabsKey)).toBe(false)
    expect(values.get(targetTabsKey)).toBe(legacyTabs)
    expect(values.get(markerKey)).toBe('browser-preview:thread-a')
  })

  it('retries a partial legacy cleanup with the browser id list still available', () => {
    const legacyTabsKey = 'meta-agent.browser-preview.tabs:browser-preview'
    const legacyUrlKey = 'meta-agent.browser-preview.url:tab-a'
    const markerKey = 'meta-agent.browser-preview.migrated-v0.0.20:browser-preview'
    const { storage, values } = memoryStorage({
      [legacyTabsKey]: JSON.stringify({
        activeBrowserId: 'tab-a',
        tabs: [{ id: 'tab-a', url: 'https://a.example/' }]
      }),
      [legacyUrlKey]: 'https://a.example/current',
      'meta-agent.browser-preview.device:tab-a': '{"preset":"desktop"}'
    })
    let failPageCleanup = true
    const flakyStorage = {
      ...storage,
      removeItem: (key: string) => {
        if (key === legacyUrlKey && failPageCleanup) {
          failPageCleanup = false
          throw new Error('storage unavailable')
        }
        storage.removeItem(key)
      }
    }

    migrateLegacyBrowserPreviewStorage({
      createBrowserId: () => 'unused',
      legacyScope: 'browser-preview',
      storage: flakyStorage,
      targetScope: 'browser-preview:thread-a'
    })

    expect(values.has(legacyTabsKey)).toBe(true)
    expect(values.has(legacyUrlKey)).toBe(true)
    expect(values.has(markerKey)).toBe(false)

    migrateLegacyBrowserPreviewStorage({
      createBrowserId: () => 'unused',
      legacyScope: 'browser-preview',
      storage: flakyStorage,
      targetScope: 'browser-preview:thread-a'
    })

    expect(values.has(legacyTabsKey)).toBe(false)
    expect(values.has(legacyUrlKey)).toBe(false)
    expect(values.has('meta-agent.browser-preview.device:tab-a')).toBe(false)
    expect(values.get(markerKey)).toBe('browser-preview:thread-a')
  })
})
