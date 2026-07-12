<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import ScrollArea from '@renderer/components/ui/scroll-area/ScrollArea.vue'
import {
  createStaticDiffLineRows,
  createVirtualDiffLineRows,
  measureDiffContentWidth,
  parseDisplayDiff,
  type DiffLine
} from './display/diffDisplay'
import { getIndexedDiffLine, type DiffDocumentIndex } from './display/diffDocumentIndex'

type ScrollAreaInstance = {
  getViewport: () => HTMLElement | undefined
}

const DEFAULT_DIFF_LINE_HEIGHT = 20
type MaybeRefValue<T> = T extends { value: infer Value } ? Value : T
type DiffVirtualizerOptions = MaybeRefValue<Parameters<typeof useVirtualizer>[0]>

const props = withDefaults(
  defineProps<{
    diff: string
    expandVertically?: boolean
    documentIndex?: DiffDocumentIndex
    visibleStartLine?: number
    visibleEndLine?: number
    visibleStartOffset?: number
    contentHeight?: number
    lineHeight?: number
  }>(),
  {
    expandVertically: false,
    lineHeight: DEFAULT_DIFF_LINE_HEIGHT
  }
)

const viewerRef = ref<HTMLElement>()
const scrollAreaRef = ref<ScrollAreaInstance | null>(null)
const measuredContentWidth = ref<number>()
let measureRaf: number | null = null
let measureGeneration = 0
let isDisposed = false

const indexedStartLine = computed(() =>
  Math.max(0, Math.min(props.visibleStartLine ?? 0, props.documentIndex?.lineCount ?? 0))
)
const indexedEndLine = computed(() =>
  Math.max(
    indexedStartLine.value,
    Math.min(
      props.visibleEndLine ?? props.documentIndex?.lineCount ?? 0,
      props.documentIndex?.lineCount ?? 0
    )
  )
)
const indexedLines = computed(() => {
  if (!props.documentIndex) {
    return undefined
  }
  const result: DiffLine[] = []
  for (let index = indexedStartLine.value; index < indexedEndLine.value; index += 1) {
    const line = getIndexedDiffLine(props.documentIndex, index)
    if (line) {
      result.push(line)
    }
  }
  return result
})
const parsedDiff = computed(() =>
  props.documentIndex
    ? {
        lines: indexedLines.value ?? [],
        contentColumns: props.documentIndex.contentColumns
      }
    : parseDisplayDiff(props.diff)
)
const lines = computed(() => parsedDiff.value.lines)
const totalLineCount = computed(() => props.documentIndex?.lineCount ?? lines.value.length)
const getDiffScrollElement = (): HTMLElement | null => scrollAreaRef.value?.getViewport() ?? null
const estimateDiffLineSize = (): number => props.lineHeight
const virtualizerOptions = computed<DiffVirtualizerOptions>((previous) => {
  const count = props.documentIndex ? 0 : lines.value.length
  if (previous?.count === count) {
    return previous
  }
  return {
    count,
    getScrollElement: getDiffScrollElement,
    estimateSize: estimateDiffLineSize,
    overscan: 12
  }
})
const virtualizer = useVirtualizer(virtualizerOptions)
const virtualItems = computed(() => virtualizer.value.getVirtualItems())
const virtualTotalSize = computed(() => virtualizer.value.getTotalSize())
const diffRows = computed(() => {
  if (props.documentIndex) {
    return createStaticDiffLineRows(
      lines.value,
      props.lineHeight,
      indexedStartLine.value,
      props.visibleStartOffset
    )
  }
  return props.expandVertically
    ? createStaticDiffLineRows(lines.value, props.lineHeight)
    : createVirtualDiffLineRows(virtualItems.value, lines.value)
})
const viewerStyle = computed<CSSProperties>(() => ({
  '--diff-content-width': measuredContentWidth.value
    ? `${measuredContentWidth.value}px`
    : `${parsedDiff.value.contentColumns}ch`,
  '--diff-line-height': `${props.lineHeight}px`
}))
const tableStyle = computed<CSSProperties>(() => ({
  height: `${
    props.contentHeight ??
    (props.expandVertically ? totalLineCount.value * props.lineHeight : virtualTotalSize.value)
  }px`
}))

function scheduleMeasureContentWidth(): void {
  if (props.documentIndex || measureRaf !== null) return
  measureRaf = window.requestAnimationFrame(() => {
    measureRaf = null
    void measureContentWidth()
  })
}

async function measureContentWidth(): Promise<void> {
  const viewer = viewerRef.value
  if (!viewer) {
    measuredContentWidth.value = undefined
    return
  }

  const generation = measureGeneration
  const nextWidth = await measureDiffContentWidth(lines.value, window.getComputedStyle(viewer))
  if (isDisposed || generation !== measureGeneration) {
    return
  }
  measuredContentWidth.value = nextWidth
}

onMounted(() => {
  scheduleMeasureContentWidth()
})

watch(
  [lines, () => props.documentIndex],
  () => {
    measureGeneration += 1
    measuredContentWidth.value = undefined
    if (!props.documentIndex) {
      void nextTick(scheduleMeasureContentWidth)
    }
  },
  { deep: false }
)

onBeforeUnmount(() => {
  isDisposed = true
  measureGeneration += 1
  if (measureRaf !== null) {
    window.cancelAnimationFrame(measureRaf)
  }
})
</script>

<template>
  <div
    ref="viewerRef"
    class="diff-viewer"
    :class="{ 'diff-viewer--expanded-vertical': expandVertically }"
    :style="viewerStyle"
  >
    <ScrollArea
      ref="scrollAreaRef"
      :scrollbars="expandVertically ? 'horizontal' : 'both'"
      class="diff-viewer__scroll"
    >
      <div
        class="diff-viewer__table"
        role="table"
        aria-label="Diff"
        :aria-rowcount="totalLineCount"
        :style="tableStyle"
      >
        <div
          v-for="row in diffRows"
          :key="row.line.key"
          v-memo="[row.line.key, row.line.text, row.transform]"
          class="diff-viewer__line"
          :class="`diff-viewer__line--${row.line.kind}`"
          :data-index="row.virtualItem.index"
          :aria-rowindex="row.virtualItem.index + 1"
          :style="{ transform: row.transform }"
          role="row"
        >
          <span class="diff-viewer__line-number" role="cell">{{ row.line.lineNumber ?? '' }}</span>
          <span class="diff-viewer__content" role="cell">{{ row.line.text }}</span>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>

<style lang="scss" scoped>
.diff-viewer {
  --diff-line-number-width: 44px;
  --diff-content-padding-x: 16px;
  --diff-content-min-width: calc(var(--diff-content-width) + var(--diff-content-padding-x));
  --diff-row-min-width: calc(var(--diff-line-number-width) + var(--diff-content-min-width));
  --diff-code-bg: var(--color-surface);
  --diff-gutter-bg: color-mix(in srgb, var(--color-text) 5%, var(--color-surface));
  --diff-border: var(--color-border);
  --diff-text: var(--color-text);
  --diff-muted: var(--color-text-muted);
  --diff-line-hover-bg: color-mix(in srgb, var(--color-text) 4%, var(--color-surface));
  --diff-added-bg: var(--color-diff-added-bg);
  --diff-added-gutter-bg: var(--color-diff-added-gutter-bg);
  --diff-removed-bg: var(--color-diff-removed-bg);
  --diff-removed-gutter-bg: var(--color-diff-removed-gutter-bg);
  --diff-skipped-fg: var(--diff-muted);

  box-sizing: border-box;
  display: block;
  width: 100%;
  min-width: 0;
  min-height: 0;
  max-height: inherit;
  overflow: hidden;
  color: var(--diff-text);
  font-family: var(--font-mono) !important;
  font-size: var(--font-size-code);
  font-weight: var(--font-weight-code);
  line-height: var(--diff-line-height);
  background: var(--diff-code-bg);
  border: 1px solid var(--diff-border);
  border-radius: var(--radius-sm);
}

.diff-viewer__scroll {
  width: 100%;
  min-width: 0;
  max-height: inherit;
}

.diff-viewer__scroll :deep([data-slot='scroll-area-viewport']) {
  width: 100%;
  min-width: 0;
  max-height: inherit;
}

.diff-viewer__scroll :deep([data-slot='scroll-area-viewport'] > div) {
  width: 100%;
  min-width: 100% !important;
}

.diff-viewer--expanded-vertical {
  max-height: none;
}

.diff-viewer--expanded-vertical .diff-viewer__scroll,
.diff-viewer--expanded-vertical .diff-viewer__scroll :deep([data-slot='scroll-area-viewport']) {
  height: auto;
  max-height: none;
}

.diff-viewer__table {
  position: relative;
  display: block;
  width: 100%;
  min-width: var(--diff-row-min-width);
}

.diff-viewer__line {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  align-items: stretch;
  width: 100%;
  min-width: var(--diff-row-min-width);
  height: var(--diff-line-height);
}

.diff-viewer__line:hover {
  background: var(--diff-line-hover-bg);
}

.diff-viewer__line--added {
  background: var(--diff-added-bg);
}

.diff-viewer__line--removed {
  background: var(--diff-removed-bg);
}

.diff-viewer__line--skipped {
  color: var(--diff-skipped-fg);
}

.diff-viewer__line-number {
  position: sticky;
  left: 0;
  z-index: 2;
  flex: 0 0 var(--diff-line-number-width);
  width: var(--diff-line-number-width);
  padding: 0 8px 0 6px;
  color: var(--diff-muted);
  background: var(--diff-gutter-bg);
  text-align: right;
  user-select: none;
  border-right: 1px solid var(--diff-border);
}

.diff-viewer__line--added .diff-viewer__line-number {
  background: var(--diff-added-gutter-bg);
  box-shadow: inset 2px 0 0 var(--color-success);
}

.diff-viewer__line--removed .diff-viewer__line-number {
  background: var(--diff-removed-gutter-bg);
  box-shadow: inset 2px 0 0 var(--color-danger);
}

.diff-viewer__line--skipped .diff-viewer__line-number {
  background: var(--diff-gutter-bg);
  color: var(--diff-skipped-fg);
}

.diff-viewer__content {
  box-sizing: border-box;
  display: block;
  flex: 1 0 auto;
  min-width: 0;
  padding: 0 10px 0 6px;
  overflow: visible;
  white-space: pre;
}
</style>
