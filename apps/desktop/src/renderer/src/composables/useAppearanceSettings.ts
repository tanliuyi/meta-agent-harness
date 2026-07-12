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
  DesktopUiPreferences,
  MarkdownFontStyle,
  MessageTimeDisplay,
  MotionPreference,
  SidebarDisplayMode,
  ToolExpansionMode,
  UiDensity,
  UserMessageAlignment
} from '@shared/coding-agent/types'
import { queueDesktopUiPreferencesUpdate } from './desktopUiPreferencesSync'

type AppearancePreferences = NonNullable<DesktopUiPreferences['appearance']>
type AppearanceField = Exclude<keyof AppearancePreferences, 'themeMode'>
type AppearanceSnapshot = Required<Pick<AppearancePreferences, AppearanceField>>

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
const avatarStyle = ref<AvatarStyle>(showAvatars.value ? 'pixel' : 'hidden')
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

const appearanceFields = [
  'uiFontSize',
  'codeFontSize',
  'customUiFontFamily',
  'customCodeFontFamily',
  'showAvatars',
  'density',
  'chatContentWidth',
  'messageTimeDisplay',
  'wrapCode',
  'toolExpansion',
  'sidebarDisplay',
  'markdownFontStyle',
  'customMarkdownFontFamily',
  'motion',
  'avatarStyle',
  'userMessageAlignment',
  'activityDisplay',
  'activityIndicatorStyle',
  'customActivityText'
] as const satisfies readonly AppearanceField[]

let nextAppearanceGeneration = 0
const appearanceFieldGenerations = Object.fromEntries(
  appearanceFields.map((field) => [field, 0])
) as Record<AppearanceField, number>

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
  markAppearanceFieldsDirty('uiFontSize')
}

/**
 * 设置代码字体大小。
 * @param value - 目标字体大小。
 */
function setCodeFontSize(value: number | string | null | undefined): void {
  codeFontSize.value = normalizeFontSize(value, CODE_FONT_SIZE_RANGE)
  markAppearanceFieldsDirty('codeFontSize')
}

/** 重置字体大小。 */
function resetFontSizes(): void {
  uiFontSize.value = UI_FONT_SIZE_RANGE.defaultValue
  codeFontSize.value = CODE_FONT_SIZE_RANGE.defaultValue
  markAppearanceFieldsDirty('uiFontSize', 'codeFontSize')
}

function getAppearanceSnapshot(): AppearanceSnapshot {
  return {
    uiFontSize: uiFontSize.value,
    codeFontSize: codeFontSize.value,
    customUiFontFamily: customUiFontFamily.value,
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
}

function queueAppearanceFields(fields: readonly AppearanceField[]): void {
  if (fields.length === 0) return

  const snapshot = getAppearanceSnapshot()
  const appearance = Object.fromEntries(
    [...new Set(fields)].map((field) => [field, snapshot[field]])
  ) as AppearancePreferences
  queueDesktopUiPreferencesUpdate({ appearance })
}

function markAppearanceFieldsDirty(...fields: AppearanceField[]): void {
  for (const field of fields) {
    appearanceFieldGenerations[field] = ++nextAppearanceGeneration
  }
  if (hasLoadedDesktopPreferences) {
    queueAppearanceFields(fields)
  }
}

function applyAppearanceLocally(): void {
  window.localStorage.setItem(uiFontSizeStorageKey, String(uiFontSize.value))
  window.localStorage.setItem(codeFontSizeStorageKey, String(codeFontSize.value))
  window.localStorage.setItem(showAvatarsStorageKey, String(showAvatars.value))
  applyFontSizes(uiFontSize.value, codeFontSize.value)
}

function applyHydratedField<T>(
  field: AppearanceField,
  value: T | undefined,
  generationsAtStart: Readonly<Record<AppearanceField, number>>,
  apply: (value: T) => void
): void {
  if (value !== undefined && appearanceFieldGenerations[field] === generationsAtStart[field]) {
    apply(value)
  }
}

function hasLegacyPreference(key: string): boolean {
  return window.localStorage.getItem(key) !== null
}

function getDirtyFieldsSince(
  generationsAtStart: Readonly<Record<AppearanceField, number>>
): AppearanceField[] {
  return appearanceFields.filter(
    (field) => appearanceFieldGenerations[field] !== generationsAtStart[field]
  )
}

async function hydrateDesktopPreferences(): Promise<void> {
  const generationsAtStart = { ...appearanceFieldGenerations }
  try {
    const preferences = await window.api?.codingAgent.getDesktopUiPreferences?.()
    const appearance = preferences?.appearance

    applyHydratedField('uiFontSize', appearance?.uiFontSize, generationsAtStart, (value) => {
      uiFontSize.value = normalizeFontSize(value, UI_FONT_SIZE_RANGE)
    })
    applyHydratedField('codeFontSize', appearance?.codeFontSize, generationsAtStart, (value) => {
      codeFontSize.value = normalizeFontSize(value, CODE_FONT_SIZE_RANGE)
    })
    applyHydratedField(
      'customUiFontFamily',
      appearance?.customUiFontFamily,
      generationsAtStart,
      (value) => {
        customUiFontFamily.value = normalizeCustomFontFamily(value)
      }
    )
    applyHydratedField(
      'customCodeFontFamily',
      appearance?.customCodeFontFamily,
      generationsAtStart,
      (value) => {
        customCodeFontFamily.value = normalizeCustomFontFamily(value)
      }
    )
    applyHydratedField('density', appearance?.density, generationsAtStart, (value) => {
      density.value = value
    })
    applyHydratedField(
      'chatContentWidth',
      appearance?.chatContentWidth,
      generationsAtStart,
      (value) => {
        chatContentWidth.value = value
      }
    )
    applyHydratedField(
      'messageTimeDisplay',
      appearance?.messageTimeDisplay,
      generationsAtStart,
      (value) => {
        messageTimeDisplay.value = value
      }
    )
    applyHydratedField('wrapCode', appearance?.wrapCode, generationsAtStart, (value) => {
      wrapCode.value = value
    })
    applyHydratedField(
      'toolExpansion',
      appearance?.toolExpansion,
      generationsAtStart,
      (value) => {
        toolExpansion.value = value
      }
    )
    applyHydratedField(
      'sidebarDisplay',
      appearance?.sidebarDisplay,
      generationsAtStart,
      (value) => {
        sidebarDisplay.value = value
      }
    )
    applyHydratedField(
      'markdownFontStyle',
      appearance?.markdownFontStyle,
      generationsAtStart,
      (value) => {
        markdownFontStyle.value = value
      }
    )
    applyHydratedField(
      'customMarkdownFontFamily',
      appearance?.customMarkdownFontFamily,
      generationsAtStart,
      (value) => {
        customMarkdownFontFamily.value = normalizeCustomFontFamily(value)
      }
    )
    applyHydratedField('motion', appearance?.motion, generationsAtStart, (value) => {
      motion.value = value
    })
    applyHydratedField(
      'userMessageAlignment',
      appearance?.userMessageAlignment,
      generationsAtStart,
      (value) => {
        userMessageAlignment.value = value
      }
    )
    applyHydratedField(
      'activityDisplay',
      appearance?.activityDisplay,
      generationsAtStart,
      (value) => {
        activityDisplay.value = value
      }
    )
    applyHydratedField(
      'activityIndicatorStyle',
      appearance?.activityIndicatorStyle,
      generationsAtStart,
      (value) => {
        activityIndicatorStyle.value = value
      }
    )
    applyHydratedField(
      'customActivityText',
      appearance?.customActivityText,
      generationsAtStart,
      (value) => {
        customActivityText.value = normalizeActivityText(value)
      }
    )

    const hydratedAvatarStyle =
      appearance?.avatarStyle ?? (appearance?.showAvatars === false ? 'hidden' : undefined)
    applyHydratedField(
      'avatarStyle',
      hydratedAvatarStyle,
      generationsAtStart,
      (value) => {
        avatarStyle.value = value
      }
    )
    applyHydratedField(
      'showAvatars',
      hydratedAvatarStyle === undefined
        ? appearance?.showAvatars
        : hydratedAvatarStyle !== 'hidden',
      generationsAtStart,
      (value) => {
        showAvatars.value = value
      }
    )

    const migrationFields: AppearanceField[] = []
    if (
      appearance?.uiFontSize === undefined &&
      appearanceFieldGenerations.uiFontSize === generationsAtStart.uiFontSize &&
      hasLegacyPreference(uiFontSizeStorageKey)
    ) {
      migrationFields.push('uiFontSize')
    }
    if (
      appearance?.codeFontSize === undefined &&
      appearanceFieldGenerations.codeFontSize === generationsAtStart.codeFontSize &&
      hasLegacyPreference(codeFontSizeStorageKey)
    ) {
      migrationFields.push('codeFontSize')
    }
    if (
      appearance?.avatarStyle === undefined &&
      appearance?.showAvatars === undefined &&
      appearanceFieldGenerations.avatarStyle === generationsAtStart.avatarStyle &&
      appearanceFieldGenerations.showAvatars === generationsAtStart.showAvatars &&
      hasLegacyPreference(showAvatarsStorageKey)
    ) {
      migrationFields.push('avatarStyle', 'showAvatars')
    }

    hasLoadedDesktopPreferences = true
    applyAppearanceLocally()
    queueAppearanceFields([...getDirtyFieldsSince(generationsAtStart), ...migrationFields])
  } catch {
    hasLoadedDesktopPreferences = true
    queueAppearanceFields(getDirtyFieldsSince(generationsAtStart))
  }
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
    void hydrateDesktopPreferences().catch(() => {
      // hydrateDesktopPreferences 已处理预期错误；这里确保未来改动不会泄漏 rejection。
    })

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
      () => {
        applyAppearanceLocally()
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
      markAppearanceFieldsDirty('activityDisplay')
    },
    setActivityIndicatorStyle: (value) => {
      activityIndicatorStyle.value = value
      markAppearanceFieldsDirty('activityIndicatorStyle')
    },
    setAvatarStyle: (value) => {
      avatarStyle.value = value
      showAvatars.value = value !== 'hidden'
      markAppearanceFieldsDirty('avatarStyle', 'showAvatars')
    },
    setChatContentWidth: (value) => {
      chatContentWidth.value = value
      markAppearanceFieldsDirty('chatContentWidth')
    },
    setCodeFontSize,
    setCustomActivityText: (value) => {
      customActivityText.value = normalizeActivityText(value)
      markAppearanceFieldsDirty('customActivityText')
    },
    setCustomCodeFontFamily: (value) => {
      customCodeFontFamily.value = normalizeCustomFontFamily(value)
      applyFontSizes(uiFontSize.value, codeFontSize.value)
      markAppearanceFieldsDirty('customCodeFontFamily')
    },
    setCustomMarkdownFontFamily: (value) => {
      customMarkdownFontFamily.value = normalizeCustomFontFamily(value)
      markAppearanceFieldsDirty('customMarkdownFontFamily')
    },
    setCustomUiFontFamily: (value) => {
      customUiFontFamily.value = normalizeCustomFontFamily(value)
      applyFontSizes(uiFontSize.value, codeFontSize.value)
      markAppearanceFieldsDirty('customUiFontFamily')
    },
    setDensity: (value) => {
      density.value = value
      markAppearanceFieldsDirty('density')
    },
    setMarkdownFontStyle: (value) => {
      markdownFontStyle.value = value
      markAppearanceFieldsDirty('markdownFontStyle')
    },
    setMessageTimeDisplay: (value) => {
      messageTimeDisplay.value = value
      markAppearanceFieldsDirty('messageTimeDisplay')
    },
    setMotion: (value) => {
      motion.value = value
      markAppearanceFieldsDirty('motion')
    },
    setSidebarDisplay: (value) => {
      sidebarDisplay.value = value
      markAppearanceFieldsDirty('sidebarDisplay')
    },
    setShowAvatars: (value) => {
      showAvatars.value = value
      avatarStyle.value = value ? 'pixel' : 'hidden'
      markAppearanceFieldsDirty('showAvatars', 'avatarStyle')
    },
    setToolExpansion: (value) => {
      toolExpansion.value = value
      markAppearanceFieldsDirty('toolExpansion')
    },
    setUiFontSize,
    setUserMessageAlignment: (value) => {
      userMessageAlignment.value = value
      markAppearanceFieldsDirty('userMessageAlignment')
    },
    setWrapCode: (value) => {
      wrapCode.value = value
      markAppearanceFieldsDirty('wrapCode')
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
  nextAppearanceGeneration = 0
  for (const field of appearanceFields) {
    appearanceFieldGenerations[field] = 0
  }
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
