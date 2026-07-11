/**
 * useAppearanceSettings.ts - 管理 renderer 外观偏好。
 *
 * 字体大小通过 CSS 变量即时应用，并持久化到 desktop 配置 JSON。
 */

import { readonly, ref, watch } from 'vue'
import type { WatchStopHandle } from 'vue'
import type {
  ActivityDisplayMode,
  ActivityIndicatorStyle,
  AvatarStyle,
  ChatContentWidth,
  MarkdownFontStyle,
  MessageTimeDisplay,
  MotionPreference,
  SidebarDisplayMode,
  ToolExpansionMode,
  UiDensity,
  UserMessageAlignment
} from '@shared/coding-agent/types'

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

/** 旧 localStorage 中存储 UI 字体大小的键名，用于迁移与降级。 */
const uiFontSizeStorageKey = 'meta-agent.ui-font-size'

/** 旧 localStorage 中存储代码字体大小的键名，用于迁移与降级。 */
const codeFontSizeStorageKey = 'meta-agent.code-font-size'

/** localStorage 中存储头像显示偏好的键名，用于降级。 */
const showAvatarsStorageKey = 'meta-agent.show-avatars'

/** 当前 UI 字体大小。 */
const uiFontSize = ref(readStoredFontSize(uiFontSizeStorageKey, UI_FONT_SIZE_RANGE))

/** 当前代码字体大小。 */
const codeFontSize = ref(readStoredFontSize(codeFontSizeStorageKey, CODE_FONT_SIZE_RANGE))
const customUiFontFamily = ref('')
const customCodeFontFamily = ref('')

/** 是否在聊天消息旁显示头像。 */
const showAvatars = ref(readStoredBoolean(showAvatarsStorageKey, true))

const density = ref<UiDensity>('standard')
const chatContentWidth = ref<ChatContentWidth>('standard')
const messageTimeDisplay = ref<MessageTimeDisplay>('hover')
const wrapCode = ref(false)
const toolExpansion = ref<ToolExpansionMode>('auto')
const sidebarDisplay = ref<SidebarDisplayMode>('persistent')
const markdownFontStyle = ref<MarkdownFontStyle>('sans')
const customMarkdownFontFamily = ref('')
const motion = ref<MotionPreference>('full')
const avatarStyle = ref<AvatarStyle>('pixel')
const userMessageAlignment = ref<UserMessageAlignment>('right')
const activityDisplay = ref<ActivityDisplayMode>('full')
const activityIndicatorStyle = ref<ActivityIndicatorStyle>('pixels')
const customActivityText = ref('')

/** 是否已完成初始化。 */
let isInitialized = false

/** 是否已完成 desktop 配置读取。 */
let hasLoadedDesktopPreferences = false

/** 停止持久化 watcher。 */
let stopPersistWatch: WatchStopHandle | undefined

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

function readStoredBoolean(key: string, defaultValue: boolean): boolean {
  if (typeof window === 'undefined') return defaultValue
  const stored = window.localStorage.getItem(key)
  return stored === null ? defaultValue : stored === 'true'
}

/**
 * 将输入值归一化到指定范围。
 * @param value - 输入值。
 * @param range - 可用范围。
 * @returns 合法字体大小。
 */
function normalizeActivityText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\r\n]/g, ' ')
    .trim()
    .slice(0, 80)
}

export function normalizeCustomFontFamily(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[;{}<>\r\n]/g, '')
    .trim()
    .slice(0, 120)
}

export function normalizeFontSize(
  value: number | string | null | undefined,
  range: typeof UI_FONT_SIZE_RANGE | typeof CODE_FONT_SIZE_RANGE
): number {
  if (value === null || value === undefined || value === '') {
    return range.defaultValue
  }

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
  document.documentElement.style.setProperty(
    '--font-sans',
    customUiFontFamily.value || "'Source Han Sans SC VF', 'Source Han Sans SC', sans-serif"
  )
  document.documentElement.style.setProperty(
    '--font-mono',
    customCodeFontFamily.value ||
      "'JetBrains Mono', 'Source Han Sans SC VF', 'Source Han Sans SC', monospace"
  )
}

/**
 * 设置 UI 字体大小。
 * @param value - 目标字体大小。
 */
function setUiFontSize(value: number | string | null | undefined): void {
  uiFontSize.value = normalizeFontSize(value, UI_FONT_SIZE_RANGE)
}

/**
 * 设置代码字体大小。
 * @param value - 目标字体大小。
 */
function setCodeFontSize(value: number | string | null | undefined): void {
  codeFontSize.value = normalizeFontSize(value, CODE_FONT_SIZE_RANGE)
}

/** 重置字体大小。 */
function resetFontSizes(): void {
  uiFontSize.value = UI_FONT_SIZE_RANGE.defaultValue
  codeFontSize.value = CODE_FONT_SIZE_RANGE.defaultValue
}

async function hydrateDesktopPreferences(): Promise<void> {
  try {
    const preferences = await window.api?.codingAgent.getDesktopUiPreferences?.()
    const nextUiFontSize = normalizeFontSize(
      preferences?.appearance?.uiFontSize ?? uiFontSize.value,
      UI_FONT_SIZE_RANGE
    )
    const nextCodeFontSize = normalizeFontSize(
      preferences?.appearance?.codeFontSize ?? codeFontSize.value,
      CODE_FONT_SIZE_RANGE
    )
    uiFontSize.value = nextUiFontSize
    codeFontSize.value = nextCodeFontSize
    customUiFontFamily.value = normalizeCustomFontFamily(
      preferences?.appearance?.customUiFontFamily
    )
    customCodeFontFamily.value = normalizeCustomFontFamily(
      preferences?.appearance?.customCodeFontFamily
    )
    showAvatars.value = preferences?.appearance?.showAvatars ?? showAvatars.value
    density.value = preferences?.appearance?.density ?? density.value
    chatContentWidth.value = preferences?.appearance?.chatContentWidth ?? chatContentWidth.value
    messageTimeDisplay.value =
      preferences?.appearance?.messageTimeDisplay ?? messageTimeDisplay.value
    wrapCode.value = preferences?.appearance?.wrapCode ?? wrapCode.value
    toolExpansion.value = preferences?.appearance?.toolExpansion ?? toolExpansion.value
    sidebarDisplay.value = preferences?.appearance?.sidebarDisplay ?? sidebarDisplay.value
    markdownFontStyle.value = preferences?.appearance?.markdownFontStyle ?? markdownFontStyle.value
    customMarkdownFontFamily.value = normalizeCustomFontFamily(
      preferences?.appearance?.customMarkdownFontFamily
    )
    motion.value = preferences?.appearance?.motion ?? motion.value
    avatarStyle.value =
      preferences?.appearance?.avatarStyle ??
      (preferences?.appearance?.showAvatars === false ? 'hidden' : avatarStyle.value)
    showAvatars.value = avatarStyle.value !== 'hidden'
    userMessageAlignment.value =
      preferences?.appearance?.userMessageAlignment ?? userMessageAlignment.value
    activityDisplay.value = preferences?.appearance?.activityDisplay ?? activityDisplay.value
    activityIndicatorStyle.value =
      preferences?.appearance?.activityIndicatorStyle ?? activityIndicatorStyle.value
    customActivityText.value = normalizeActivityText(preferences?.appearance?.customActivityText)
  } finally {
    hasLoadedDesktopPreferences = true
    persistAppearanceSettings()
  }
}

function persistAppearanceSettings(): void {
  window.localStorage.setItem(uiFontSizeStorageKey, String(uiFontSize.value))
  window.localStorage.setItem(codeFontSizeStorageKey, String(codeFontSize.value))
  window.localStorage.setItem(showAvatarsStorageKey, String(showAvatars.value))
  applyFontSizes(uiFontSize.value, codeFontSize.value)
  void window.api?.codingAgent.updateDesktopUiPreferences?.({
    appearance: {
      uiFontSize: uiFontSize.value,
      customUiFontFamily: customUiFontFamily.value,
      codeFontSize: codeFontSize.value,
      customCodeFontFamily: customCodeFontFamily.value,
      showAvatars: showAvatars.value,
      density: density.value,
      chatContentWidth: chatContentWidth.value,
      messageTimeDisplay: messageTimeDisplay.value,
      wrapCode: wrapCode.value,
      toolExpansion: toolExpansion.value,
      sidebarDisplay: sidebarDisplay.value,
      markdownFontStyle: markdownFontStyle.value,
      customMarkdownFontFamily: customMarkdownFontFamily.value,
      motion: motion.value,
      avatarStyle: avatarStyle.value,
      userMessageAlignment: userMessageAlignment.value,
      activityDisplay: activityDisplay.value,
      activityIndicatorStyle: activityIndicatorStyle.value,
      customActivityText: customActivityText.value
    }
  })
}

/**
 * 组合式函数：提供外观偏好读取与更新能力。
 * @returns 外观偏好相关状态与方法。
 */
export function useAppearanceSettings(): {
  activityDisplay: Readonly<typeof activityDisplay>
  activityIndicatorStyle: Readonly<typeof activityIndicatorStyle>
  avatarStyle: Readonly<typeof avatarStyle>
  chatContentWidth: Readonly<typeof chatContentWidth>
  codeFontSize: Readonly<typeof codeFontSize>
  codeFontSizeRange: typeof CODE_FONT_SIZE_RANGE
  customActivityText: Readonly<typeof customActivityText>
  customCodeFontFamily: Readonly<typeof customCodeFontFamily>
  customMarkdownFontFamily: Readonly<typeof customMarkdownFontFamily>
  customUiFontFamily: Readonly<typeof customUiFontFamily>
  density: Readonly<typeof density>
  markdownFontStyle: Readonly<typeof markdownFontStyle>
  messageTimeDisplay: Readonly<typeof messageTimeDisplay>
  motion: Readonly<typeof motion>
  resetFontSizes: typeof resetFontSizes
  setActivityDisplay: (value: ActivityDisplayMode) => void
  setActivityIndicatorStyle: (value: ActivityIndicatorStyle) => void
  setAvatarStyle: (value: AvatarStyle) => void
  setChatContentWidth: (value: ChatContentWidth) => void
  setCodeFontSize: typeof setCodeFontSize
  setCustomActivityText: (value: string) => void
  setCustomCodeFontFamily: (value: string) => void
  setCustomMarkdownFontFamily: (value: string) => void
  setCustomUiFontFamily: (value: string) => void
  setDensity: (value: UiDensity) => void
  setMarkdownFontStyle: (value: MarkdownFontStyle) => void
  setMessageTimeDisplay: (value: MessageTimeDisplay) => void
  setMotion: (value: MotionPreference) => void
  setSidebarDisplay: (value: SidebarDisplayMode) => void
  setShowAvatars: (value: boolean) => void
  setToolExpansion: (value: ToolExpansionMode) => void
  setUiFontSize: typeof setUiFontSize
  setUserMessageAlignment: (value: UserMessageAlignment) => void
  setWrapCode: (value: boolean) => void
  showAvatars: Readonly<typeof showAvatars>
  sidebarDisplay: Readonly<typeof sidebarDisplay>
  toolExpansion: Readonly<typeof toolExpansion>
  uiFontSize: Readonly<typeof uiFontSize>
  uiFontSizeRange: typeof UI_FONT_SIZE_RANGE
  userMessageAlignment: Readonly<typeof userMessageAlignment>
  wrapCode: Readonly<typeof wrapCode>
} {
  if (!isInitialized && typeof window !== 'undefined') {
    isInitialized = true
    applyFontSizes(uiFontSize.value, codeFontSize.value)
    void hydrateDesktopPreferences()

    stopPersistWatch = watch(
      [
        uiFontSize,
        codeFontSize,
        customUiFontFamily,
        customCodeFontFamily,
        customMarkdownFontFamily,
        showAvatars,
        density,
        chatContentWidth,
        messageTimeDisplay,
        wrapCode,
        toolExpansion,
        sidebarDisplay,
        markdownFontStyle,
        motion,
        avatarStyle,
        userMessageAlignment,
        activityDisplay,
        activityIndicatorStyle,
        customActivityText
      ],
      ([nextUiFontSize, nextCodeFontSize]) => {
        if (!hasLoadedDesktopPreferences) {
          applyFontSizes(nextUiFontSize, nextCodeFontSize)
          return
        }
        persistAppearanceSettings()
      }
    )
  }

  return {
    activityDisplay: readonly(activityDisplay),
    activityIndicatorStyle: readonly(activityIndicatorStyle),
    avatarStyle: readonly(avatarStyle),
    chatContentWidth: readonly(chatContentWidth),
    codeFontSize: readonly(codeFontSize),
    codeFontSizeRange: CODE_FONT_SIZE_RANGE,
    customActivityText: readonly(customActivityText),
    customCodeFontFamily: readonly(customCodeFontFamily),
    customMarkdownFontFamily: readonly(customMarkdownFontFamily),
    customUiFontFamily: readonly(customUiFontFamily),
    density: readonly(density),
    markdownFontStyle: readonly(markdownFontStyle),
    messageTimeDisplay: readonly(messageTimeDisplay),
    motion: readonly(motion),
    resetFontSizes,
    setActivityDisplay: (value) => {
      activityDisplay.value = value
    },
    setActivityIndicatorStyle: (value) => {
      activityIndicatorStyle.value = value
    },
    setAvatarStyle: (value) => {
      avatarStyle.value = value
      showAvatars.value = value !== 'hidden'
    },
    setChatContentWidth: (value) => {
      chatContentWidth.value = value
    },
    setCodeFontSize,
    setCustomActivityText: (value) => {
      customActivityText.value = normalizeActivityText(value)
    },
    setCustomCodeFontFamily: (value) => {
      customCodeFontFamily.value = normalizeCustomFontFamily(value)
      applyFontSizes(uiFontSize.value, codeFontSize.value)
    },
    setCustomMarkdownFontFamily: (value) => {
      customMarkdownFontFamily.value = normalizeCustomFontFamily(value)
    },
    setCustomUiFontFamily: (value) => {
      customUiFontFamily.value = normalizeCustomFontFamily(value)
      applyFontSizes(uiFontSize.value, codeFontSize.value)
    },
    setDensity: (value) => {
      density.value = value
    },
    setMarkdownFontStyle: (value) => {
      markdownFontStyle.value = value
    },
    setMessageTimeDisplay: (value) => {
      messageTimeDisplay.value = value
    },
    setMotion: (value) => {
      motion.value = value
    },
    setSidebarDisplay: (value) => {
      sidebarDisplay.value = value
    },
    setShowAvatars: (value) => {
      showAvatars.value = value
      avatarStyle.value = value ? 'pixel' : 'hidden'
    },
    setToolExpansion: (value) => {
      toolExpansion.value = value
    },
    setUiFontSize,
    setUserMessageAlignment: (value) => {
      userMessageAlignment.value = value
    },
    setWrapCode: (value) => {
      wrapCode.value = value
    },
    showAvatars: readonly(showAvatars),
    sidebarDisplay: readonly(sidebarDisplay),
    toolExpansion: readonly(toolExpansion),
    uiFontSize: readonly(uiFontSize),
    uiFontSizeRange: UI_FONT_SIZE_RANGE,
    userMessageAlignment: readonly(userMessageAlignment),
    wrapCode: readonly(wrapCode)
  }
}

export function resetAppearanceSettingsForTest(): void {
  stopPersistWatch?.()
  stopPersistWatch = undefined
  isInitialized = false
  hasLoadedDesktopPreferences = false
  uiFontSize.value = UI_FONT_SIZE_RANGE.defaultValue
  codeFontSize.value = CODE_FONT_SIZE_RANGE.defaultValue
  customUiFontFamily.value = ''
  customCodeFontFamily.value = ''
  customMarkdownFontFamily.value = ''
  showAvatars.value = true
  density.value = 'standard'
  chatContentWidth.value = 'standard'
  messageTimeDisplay.value = 'hover'
  wrapCode.value = false
  toolExpansion.value = 'auto'
  sidebarDisplay.value = 'persistent'
  markdownFontStyle.value = 'sans'
  motion.value = 'full'
  avatarStyle.value = 'pixel'
  userMessageAlignment.value = 'right'
  activityDisplay.value = 'full'
  activityIndicatorStyle.value = 'pixels'
  customActivityText.value = ''
}
