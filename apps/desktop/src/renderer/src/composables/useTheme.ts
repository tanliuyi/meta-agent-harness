import { computed, onBeforeUnmount, readonly, ref, watch } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'
type ResolvedTheme = 'light' | 'dark'

const storageKey = 'meta-agent.theme'
const themeMode = ref<ThemeMode>(readStoredTheme())
const systemTheme = ref<ResolvedTheme>('dark')
let mediaQuery: MediaQueryList | undefined
let isInitialized = false

const themeOptions: Array<{ label: string; value: ThemeMode }> = [
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
  { label: '系统', value: 'system' }
]

const resolvedTheme = computed<ResolvedTheme>(() =>
  themeMode.value === 'system' ? systemTheme.value : themeMode.value
)

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

function applyTheme(mode: ThemeMode, resolved: ResolvedTheme): void {
  document.documentElement.dataset.themeMode = mode
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
}

function setThemeMode(mode: ThemeMode): void {
  themeMode.value = mode
}

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
