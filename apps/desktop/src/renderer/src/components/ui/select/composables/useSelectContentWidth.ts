import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  toValue,
  watch,
  type ComponentPublicInstance,
  type MaybeRefOrGetter
} from 'vue'

type SelectContentWidthOptions = {
  labels: MaybeRefOrGetter<string[]>
  inlinePadding?: number
}

const SELECT_TEXT_WIDTH_CACHE_LIMIT = 2048
const FALLBACK_FONT_SIZE_PX = 14
const selectTextWidthCache = new Map<string, number>()
let pretextModulePromise: Promise<PretextModule> | null = null

type PretextModule = {
  measureNaturalWidth: (typeof import('@chenglou/pretext'))['measureNaturalWidth']
  prepareWithSegments: (typeof import('@chenglou/pretext'))['prepareWithSegments']
}

export function useSelectContentWidth(options: SelectContentWidthOptions) {
  const triggerRef = ref<Element | ComponentPublicInstance | null>(null)
  const contentWidth = ref<string>()
  const inlinePadding = options.inlinePadding ?? 44
  let measureRaf: number | null = null
  let measureGeneration = 0
  let isDisposed = false

  const contentStyle = computed(() => ({
    width: contentWidth.value
  }))

  function setTriggerRef(refValue: Element | ComponentPublicInstance | null): void {
    triggerRef.value = refValue
    updateFallbackContentWidth()
  }

  function scheduleMeasureContentWidth(): void {
    if (measureRaf !== null) return
    measureRaf = window.requestAnimationFrame(() => {
      measureRaf = null
      void measureContentWidth()
    })
  }

  function getFallbackContentWidth(trigger: Element): number {
    const triggerWidth = trigger.getBoundingClientRect().width
    const style = window.getComputedStyle(trigger)
    const fallbackTextWidth = estimateWidestSelectTextWidth(
      toValue(options.labels),
      readPixelValue(style.fontSize) || FALLBACK_FONT_SIZE_PX
    )
    return Math.max(triggerWidth, fallbackTextWidth + inlinePadding)
  }

  async function measureContentWidth(): Promise<void> {
    const trigger = getElement(triggerRef.value)
    if (!trigger) {
      contentWidth.value = undefined
      return
    }

    const fallbackWidth = getFallbackContentWidth(trigger)
    const style = window.getComputedStyle(trigger)
    const font = getCanvasFont(style)
    const letterSpacing = readPixelValue(style.letterSpacing)
    const labels = toValue(options.labels)
    const generation = measureGeneration
    const pretext = await loadPretextModule()
    if (isDisposed || generation !== measureGeneration) {
      return
    }
    let optionTextWidth = 0
    for (const label of labels) {
      optionTextWidth = Math.max(
        optionTextWidth,
        measureSelectTextWidth(label, font, letterSpacing, pretext)
      )
    }
    const nextWidth = Math.max(fallbackWidth, Math.ceil(optionTextWidth + inlinePadding))
    contentWidth.value = `${nextWidth}px`
  }

  function updateFallbackContentWidth(): void {
    const trigger = getElement(triggerRef.value)
    if (!trigger) {
      contentWidth.value = undefined
      return
    }

    contentWidth.value = `${Math.ceil(getFallbackContentWidth(trigger))}px`
  }

  onMounted(() => {
    updateFallbackContentWidth()
    void document.fonts.ready.then(() => {
      if (isDisposed) return
      clearSelectTextWidthCache()
    })
  })

  watch(
    () => toValue(options.labels),
    () => {
      measureGeneration += 1
      void nextTick(updateFallbackContentWidth)
    },
    { deep: true }
  )

  onBeforeUnmount(() => {
    isDisposed = true
    measureGeneration += 1
    if (measureRaf !== null) {
      window.cancelAnimationFrame(measureRaf)
    }
  })

  return {
    contentStyle,
    setTriggerRef,
    scheduleMeasureContentWidth
  }
}

function measureSelectTextWidth(
  text: string,
  font: string,
  letterSpacing: number,
  pretext: PretextModule
): number {
  const cacheKey = getSelectTextWidthCacheKey(text, font, letterSpacing)
  const cached = selectTextWidthCache.get(cacheKey)
  if (cached !== undefined) {
    selectTextWidthCache.delete(cacheKey)
    selectTextWidthCache.set(cacheKey, cached)
    return cached
  }

  const measured = pretext.measureNaturalWidth(
    pretext.prepareWithSegments(text, font, {
      letterSpacing
    })
  )
  selectTextWidthCache.set(cacheKey, measured)
  trimSelectTextWidthCache()
  return measured
}

function getElement(refValue: Element | ComponentPublicInstance | null): Element | undefined {
  if (refValue instanceof Element) {
    return refValue
  }
  const element = refValue?.$el
  return element instanceof Element ? element : undefined
}

function getCanvasFont(style: CSSStyleDeclaration): string {
  if (style.font) return style.font
  const fontStyle = style.fontStyle || 'normal'
  const fontVariant = style.fontVariant || 'normal'
  const fontWeight = style.fontWeight || '400'
  const fontSize = style.fontSize || '14px'
  const fontFamily = style.fontFamily || 'sans-serif'
  return `${fontStyle} ${fontVariant} ${fontWeight} ${fontSize} ${fontFamily}`
}

function readPixelValue(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function estimateWidestSelectTextWidth(labels: string[], fontSize: number): number {
  let widest = 0
  for (const label of labels) {
    widest = Math.max(widest, estimateSelectTextWidth(label, fontSize))
  }
  return widest
}

function estimateSelectTextWidth(text: string, fontSize: number): number {
  let width = 0
  for (const char of Array.from(text)) {
    width += getFallbackCharWidth(char, fontSize)
  }
  return width
}

function getFallbackCharWidth(char: string, fontSize: number): number {
  if (/\s/.test(char)) return fontSize * 0.35
  if (/[\u3000-\u9fff\uff00-\uffef]/u.test(char)) return fontSize
  if (/[.,:;|!'`]/.test(char)) return fontSize * 0.3
  if (/[-_/\\()[\]{}]/.test(char)) return fontSize * 0.48
  if (/[A-Z0-9]/.test(char)) return fontSize * 0.62
  return fontSize * 0.56
}

function getSelectTextWidthCacheKey(text: string, font: string, letterSpacing: number): string {
  return `${font}\n${letterSpacing}\n${text}`
}

function trimSelectTextWidthCache(): void {
  if (selectTextWidthCache.size <= SELECT_TEXT_WIDTH_CACHE_LIMIT) return

  const staleKey = selectTextWidthCache.keys().next().value
  if (staleKey !== undefined) {
    selectTextWidthCache.delete(staleKey)
  }
}

function clearSelectTextWidthCache(): void {
  selectTextWidthCache.clear()
}

function loadPretextModule(): Promise<PretextModule> {
  pretextModulePromise ??= import('@chenglou/pretext').then((pretext) => ({
    measureNaturalWidth: pretext.measureNaturalWidth,
    prepareWithSegments: pretext.prepareWithSegments
  }))
  return pretextModulePromise
}
