import { measureNaturalWidth, prepareWithSegments } from '@chenglou/pretext'
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

export function useSelectContentWidth(options: SelectContentWidthOptions) {
  const triggerRef = ref<Element | ComponentPublicInstance | null>(null)
  const contentWidth = ref<string>()
  const inlinePadding = options.inlinePadding ?? 44
  let measureRaf: number | null = null

  const contentStyle = computed(() => ({
    width: contentWidth.value
  }))

  function setTriggerRef(refValue: Element | ComponentPublicInstance | null): void {
    triggerRef.value = refValue
    scheduleMeasureContentWidth()
  }

  function scheduleMeasureContentWidth(): void {
    if (measureRaf !== null) return
    measureRaf = window.requestAnimationFrame(() => {
      measureRaf = null
      measureContentWidth()
    })
  }

  function measureContentWidth(): void {
    const trigger = getElement(triggerRef.value)
    if (!trigger) {
      contentWidth.value = undefined
      return
    }

    const triggerWidth = trigger.getBoundingClientRect().width
    const optionTextWidth = toValue(options.labels).reduce(
      (width, label) => Math.max(width, measureSelectTextWidth(label, trigger)),
      0
    )
    const nextWidth = Math.max(triggerWidth, Math.ceil(optionTextWidth + inlinePadding))
    contentWidth.value = `${nextWidth}px`
  }

  onMounted(() => {
    scheduleMeasureContentWidth()
  })

  watch(
    () => toValue(options.labels),
    () => {
      void nextTick(scheduleMeasureContentWidth)
    },
    { deep: true }
  )

  onBeforeUnmount(() => {
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

function measureSelectTextWidth(text: string, sourceElement: Element): number {
  const style = window.getComputedStyle(sourceElement)
  return measureNaturalWidth(
    prepareWithSegments(text, getCanvasFont(style), {
      letterSpacing: readPixelValue(style.letterSpacing)
    })
  )
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
