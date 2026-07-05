/**
 * useAppearanceSettings.ts - 管理 renderer 外观偏好。
 *
 * 字体大小仅作用于 renderer 本地 UI，通过 CSS 变量即时应用并持久化到 localStorage。
 */

import { readonly, ref, watch } from 'vue'

/** UI 字体大小配置范围。 */
export const UI_FONT_SIZE_RANGE = {
  min: 11,
  max: 16,
  step: 1,
  defaultValue: 14
} as const

/** 代码字体大小配置范围。 */
export const CODE_FONT_SIZE_RANGE = {
  min: 11,
  max: 18,
  step: 1,
  defaultValue: 13
} as const

/** localStorage 中存储 UI 字体大小的键名。 */
const uiFontSizeStorageKey = 'meta-agent.ui-font-size'

/** localStorage 中存储代码字体大小的键名。 */
const codeFontSizeStorageKey = 'meta-agent.code-font-size'

/** 当前 UI 字体大小。 */
const uiFontSize = ref(readStoredFontSize(uiFontSizeStorageKey, UI_FONT_SIZE_RANGE))

/** 当前代码字体大小。 */
const codeFontSize = ref(readStoredFontSize(codeFontSizeStorageKey, CODE_FONT_SIZE_RANGE))

/** 是否已完成初始化。 */
let isInitialized = false

/**
 * 从 localStorage 读取字体大小。
 * @param key - 存储键名。
 * @param range - 可用范围。
 * @returns 合法字体大小。
 */
function readStoredFontSize(
  key: string,
  range: typeof UI_FONT_SIZE_RANGE | typeof CODE_FONT_SIZE_RANGE
): number {
  if (typeof window === 'undefined') {
    return range.defaultValue
  }

  return normalizeFontSize(window.localStorage.getItem(key), range)
}

/**
 * 将输入值归一化到指定范围。
 * @param value - 输入值。
 * @param range - 可用范围。
 * @returns 合法字体大小。
 */
function normalizeFontSize(
  value: number | string | null,
  range: typeof UI_FONT_SIZE_RANGE | typeof CODE_FONT_SIZE_RANGE
): number {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    return range.defaultValue
  }

  return Math.min(range.max, Math.max(range.min, Math.round(parsed)))
}

/**
 * 应用字体大小到根节点 CSS 变量。
 * @param nextUiFontSize - UI 字体大小。
 * @param nextCodeFontSize - 代码字体大小。
 */
function applyFontSizes(nextUiFontSize: number, nextCodeFontSize: number): void {
  document.documentElement.style.setProperty('--font-size-ui', `${nextUiFontSize}px`)
  document.documentElement.style.setProperty('--font-size-ui-2xs', `${nextUiFontSize - 3}px`)
  document.documentElement.style.setProperty('--font-size-ui-xs', `${nextUiFontSize - 2}px`)
  document.documentElement.style.setProperty('--font-size-ui-sm', `${nextUiFontSize - 1}px`)
  document.documentElement.style.setProperty('--font-size-ui-lg', `${nextUiFontSize + 2}px`)
  document.documentElement.style.setProperty('--font-size-ui-xl', `${nextUiFontSize + 7}px`)
  document.documentElement.style.setProperty('--font-size-ui-2xl', `${nextUiFontSize + 9}px`)
  document.documentElement.style.setProperty('--font-size-code', `${nextCodeFontSize}px`)
}

/**
 * 设置 UI 字体大小。
 * @param value - 目标字体大小。
 */
function setUiFontSize(value: number | string): void {
  uiFontSize.value = normalizeFontSize(value, UI_FONT_SIZE_RANGE)
}

/**
 * 设置代码字体大小。
 * @param value - 目标字体大小。
 */
function setCodeFontSize(value: number | string): void {
  codeFontSize.value = normalizeFontSize(value, CODE_FONT_SIZE_RANGE)
}

/** 重置字体大小。 */
function resetFontSizes(): void {
  uiFontSize.value = UI_FONT_SIZE_RANGE.defaultValue
  codeFontSize.value = CODE_FONT_SIZE_RANGE.defaultValue
}

/**
 * 组合式函数：提供外观偏好读取与更新能力。
 * @returns 外观偏好相关状态与方法。
 */
export function useAppearanceSettings(): {
  codeFontSize: Readonly<typeof codeFontSize>
  codeFontSizeRange: typeof CODE_FONT_SIZE_RANGE
  resetFontSizes: typeof resetFontSizes
  setCodeFontSize: typeof setCodeFontSize
  setUiFontSize: typeof setUiFontSize
  uiFontSize: Readonly<typeof uiFontSize>
  uiFontSizeRange: typeof UI_FONT_SIZE_RANGE
} {
  if (!isInitialized && typeof window !== 'undefined') {
    isInitialized = true

    watch(
      [uiFontSize, codeFontSize],
      ([nextUiFontSize, nextCodeFontSize]) => {
        window.localStorage.setItem(uiFontSizeStorageKey, String(nextUiFontSize))
        window.localStorage.setItem(codeFontSizeStorageKey, String(nextCodeFontSize))
        applyFontSizes(nextUiFontSize, nextCodeFontSize)
      },
      { immediate: true }
    )
  }

  return {
    codeFontSize: readonly(codeFontSize),
    codeFontSizeRange: CODE_FONT_SIZE_RANGE,
    resetFontSizes,
    setCodeFontSize,
    setUiFontSize,
    uiFontSize: readonly(uiFontSize),
    uiFontSizeRange: UI_FONT_SIZE_RANGE
  }
}
