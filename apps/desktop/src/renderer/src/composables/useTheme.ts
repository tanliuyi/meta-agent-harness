/**
 * useTheme.ts - 管理 renderer 应用主题状态。
 *
 * 支持 light / dark / system 三种模式，自动响应系统主题变化并持久化到 localStorage。
 */

import { computed, onBeforeUnmount, readonly, ref, watch } from 'vue'

/** 用户可选的主题模式。 */
export type ThemeMode = 'light' | 'dark' | 'system'

/** 实际解析后的主题。 */
type ResolvedTheme = 'light' | 'dark'

/** localStorage 中存储主题模式的键名。 */
const storageKey = 'meta-agent.theme'

/** 当前用户设置的主题模式。 */
const themeMode = ref<ThemeMode>(readStoredTheme())

/** 系统当前解析后的主题。 */
const systemTheme = ref<ResolvedTheme>('dark')

/** 系统媒体查询对象。 */
let mediaQuery: MediaQueryList | undefined

/** 主题是否已完成初始化。 */
let isInitialized = false

/** 可供用户选择的主题选项。 */
const themeOptions: Array<{ label: string; value: ThemeMode }> = [
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
  { label: '系统', value: 'system' }
]

/** 根据当前模式解析出的最终主题。 */
const resolvedTheme = computed<ResolvedTheme>(() =>
  themeMode.value === 'system' ? systemTheme.value : themeMode.value
)

/**
 * 从 localStorage 读取已保存的主题模式。
 * @returns 存储的主题模式，无效或不存在时返回 'system'。
 */
function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'system'
  }

  const storedTheme = window.localStorage.getItem(storageKey)

  if (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system') {
    return storedTheme
  }

  return 'system'
}

/**
 * 将解析后的主题应用到 document 根节点。
 * @param mode - 用户选择的主题模式。
 * @param resolved - 解析后的实际主题。
 */
function applyTheme(mode: ThemeMode, resolved: ResolvedTheme): void {
  document.documentElement.dataset.themeMode = mode
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
}

/**
 * 设置用户主题模式。
 * @param mode - 目标主题模式。
 */
function setThemeMode(mode: ThemeMode): void {
  themeMode.value = mode
}

/**
 * 组合式函数：提供主题读取与切换能力。
 * @returns 主题相关的响应式状态与切换方法。
 */
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

    /**
     * 系统主题变化时的回调。
     * @param event - 媒体查询变化事件。
     */
    const handleSystemThemeChange = (event: MediaQueryListEvent): void => {
      systemTheme.value = event.matches ? 'dark' : 'light'
    }

    mediaQuery.addEventListener('change', handleSystemThemeChange)

    watch(
      [themeMode, resolvedTheme],
      ([mode, resolved]) => {
        window.localStorage.setItem(storageKey, mode)
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
