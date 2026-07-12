/**
 * useTheme.ts - 管理 renderer 应用主题状态。
 *
 * 支持 light / dark / system 三种模式，自动响应系统主题变化并持久化到 Desktop 配置。
 */

import type { ThemeMode } from '@shared/coding-agent/types'
import { computed, onBeforeUnmount, readonly, ref, watch } from 'vue'
import type { WatchStopHandle } from 'vue'
import { queueDesktopUiPreferencesUpdate } from './desktopUiPreferencesSync'

export type { ThemeMode } from '@shared/coding-agent/types'

/** 实际解析后的主题。 */
type ResolvedTheme = 'light' | 'dark'

/** localStorage 中存储主题模式的键名，用作首屏缓存和旧版本迁移。 */
const storageKey = 'meta-agent.theme'

/** 当前用户设置的主题模式。 */
const themeMode = ref<ThemeMode>(readStoredTheme())

/** 系统当前解析后的主题。 */
const systemTheme = ref<ResolvedTheme>('dark')

/** 系统媒体查询对象。 */
let mediaQuery: MediaQueryList | undefined

/** 主题是否已完成初始化。 */
let isInitialized = false

/** 是否已完成 Desktop 配置读取。 */
let hasLoadedDesktopPreferences = false

/** 停止主题 watcher。 */
let stopThemeWatch: WatchStopHandle | undefined

/** 用户修改 generation，用于区分异步 hydration 与真实交互。 */
let themeGeneration = 0

/** 可供用户选择的主题选项。 */
const themeOptions: Array<{ label: string; value: ThemeMode }> = [
  { label: '跟随系统', value: 'system' },
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' }
]

/** 根据当前模式解析出的最终主题。 */
const resolvedTheme = computed<ResolvedTheme>(() =>
  themeMode.value === 'system' ? systemTheme.value : themeMode.value
)

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

/** 从首屏缓存读取主题模式。 */
function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'system'
  const storedTheme = window.localStorage.getItem(storageKey)
  return isThemeMode(storedTheme) ? storedTheme : 'system'
}

/** 将主题应用到 document 根节点。 */
function applyTheme(mode: ThemeMode, resolved: ResolvedTheme): void {
  document.documentElement.dataset.themeMode = mode
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
}

function cacheThemeMode(): void {
  window.localStorage.setItem(storageKey, themeMode.value)
}

function queueThemeModeUpdate(): void {
  queueDesktopUiPreferencesUpdate({
    appearance: { themeMode: themeMode.value }
  })
}

async function hydrateDesktopTheme(): Promise<void> {
  const generationAtStart = themeGeneration
  const hasCachedTheme = isThemeMode(window.localStorage.getItem(storageKey))
  try {
    const preferences = await window.api?.codingAgent.getDesktopUiPreferences?.()
    const storedMode = preferences?.appearance?.themeMode
    if (isThemeMode(storedMode) && themeGeneration === generationAtStart) {
      themeMode.value = storedMode
    }
    hasLoadedDesktopPreferences = true
    cacheThemeMode()
    if (themeGeneration !== generationAtStart || (!isThemeMode(storedMode) && hasCachedTheme)) {
      queueThemeModeUpdate()
    }
  } catch {
    hasLoadedDesktopPreferences = true
    if (themeGeneration !== generationAtStart) {
      queueThemeModeUpdate()
    }
  }
}

/** 设置用户主题模式。 */
function setThemeMode(mode: ThemeMode): void {
  themeMode.value = mode
  themeGeneration += 1
  cacheThemeMode()
  if (hasLoadedDesktopPreferences) {
    queueThemeModeUpdate()
  }
}

/** 组合式函数：提供主题读取与切换能力。 */
export function useTheme(): {
  resolvedTheme: Readonly<typeof resolvedTheme>
  setThemeMode: typeof setThemeMode
  themeMode: Readonly<typeof themeMode>
  themeOptions: typeof themeOptions
} {
  if (!isInitialized && typeof window !== 'undefined') {
    isInitialized = true
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    systemTheme.value = mediaQuery.matches ? 'dark' : 'light'

    const handleSystemThemeChange = (event: MediaQueryListEvent): void => {
      systemTheme.value = event.matches ? 'dark' : 'light'
    }

    mediaQuery.addEventListener('change', handleSystemThemeChange)

    void hydrateDesktopTheme().catch(() => {
      // hydrateDesktopTheme 已处理预期错误；这里确保未来改动不会泄漏 rejection。
    })

    stopThemeWatch = watch(
      [themeMode, resolvedTheme],
      ([mode, resolved]) => {
        cacheThemeMode()
        applyTheme(mode, resolved)
      },
      { immediate: true }
    )

    onBeforeUnmount(() => {
      mediaQuery?.removeEventListener('change', handleSystemThemeChange)
    })
  }

  return {
    resolvedTheme,
    setThemeMode,
    themeMode: readonly(themeMode),
    themeOptions
  }
}

export function resetThemeForTest(): void {
  stopThemeWatch?.()
  stopThemeWatch = undefined
  isInitialized = false
  hasLoadedDesktopPreferences = false
  themeGeneration = 0
  themeMode.value = readStoredTheme()
  systemTheme.value = 'dark'
  mediaQuery = undefined
}
