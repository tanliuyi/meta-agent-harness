<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import ScrollArea from '@renderer/components/ui/scroll-area/ScrollArea.vue'
import {
  createVirtualDiffLineRows,
  measureDiffContentWidth,
  parseDisplayDiff
} from './display/diffDisplay'

type ScrollAreaInstance = {
  getViewport: () => HTMLElement | undefined
}

const DIFF_LINE_HEIGHT = 20
type MaybeRefValue<T> = T extends { value: infer Value } ? Value : T
type DiffVirtualizerOptions = MaybeRefValue<Parameters<typeof useVirtualizer>[0]>

const props = defineProps<{
  diff: string
}>()

const viewerRef = ref<HTMLElement>()
const scrollAreaRef = ref<ScrollAreaInstance | null>(null)
const measuredContentWidth = ref<number>()
let measureRaf: number | null = null
let measureGeneration = 0
let isDisposed = false

const parsedDiff = computed(() => parseDisplayDiff(props.diff))
const lines = computed(() => parsedDiff.value.lines)
const getDiffScrollElement = (): HTMLElement | null => scrollAreaRef.value?.getViewport() ?? null
const estimateDiffLineSize = (): number => DIFF_LINE_HEIGHT
const virtualizerOptions = computed<DiffVirtualizerOptions>((previous) => {
  const count = lines.value.length
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
const virtualRows = computed(() => createVirtualDiffLineRows(virtualItems.value, lines.value))
const viewerStyle = computed<CSSProperties>(() => ({
  '--diff-content-width': measuredContentWidth.value
    ? `${measuredContentWidth.value}px`
    : `${parsedDiff.value.contentColumns}ch`,
  '--diff-line-height': `${DIFF_LINE_HEIGHT}px`
}))
const tableStyle = computed<CSSProperties>(() => ({
  height: `${virtualTotalSize.value}px`
}))

function scheduleMeasureContentWidth(): void {
  if (measureRaf !== null) return
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
  lines,
  () => {
    measureGeneration += 1
    measuredContentWidth.value = undefined
    void nextTick(scheduleMeasureContentWidth)
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
  <div ref="viewerRef" class="diff-viewer" :style="viewerStyle">
    <ScrollArea ref="scrollAreaRef" scrollbars="both" class="diff-viewer__scroll">
      <div
        class="diff-viewer__table"
        role="table"
        aria-label="Diff"
        :aria-rowcount="lines.length"
        :style="tableStyle"
      >
        <div
          v-for="row in virtualRows"
          :key="row.line.key"
          v-memo="[row.line]"
          class="diff-viewer__line"
          :class="`diff-viewer__line--${row.line.kind}`"
          :data-index="row.virtualItem.index"
          :aria-rowindex="row.virtualItem.index + 1"
          :style="{ transform: row.transform }"
          role="row"
        >
          <span class="diff-viewer__line-number" role="cell">{{ row.line.lineNumber ?? '' }}</span>
          <span class="diff-viewer__marker" role="cell">
            {{ row.line.marker }}
          </span>
          <span class="diff-viewer__content" role="cell">{{ row.line.text }}</span>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>

<style lang="scss" scoped>
.diff-viewer {
  --diff-line-number-width: 48px;
  --diff-marker-width: 22px;
  --diff-content-padding-x: 20px;
  --diff-content-min-width: calc(var(--diff-content-width) + var(--diff-content-padding-x));
  --diff-row-min-width: calc(
    var(--diff-line-number-width) + var(--diff-marker-width) + var(--diff-content-min-width)
  );
  --diff-code-bg: #ffffff;
  --diff-gutter-bg: #f6f8fa;
  --diff-border: #d0d7de;
  --diff-text: #24292f;
  --diff-muted: #57606a;
  --diff-line-hover-bg: #f6f8fa;
  --diff-added-bg: #e6ffec;
  --diff-added-gutter-bg: #ccffd8;
  --diff-added-fg: #1a7f37;
  --diff-removed-bg: #ffebe9;
  --diff-removed-gutter-bg: #ffd7d5;
  --diff-removed-fg: #cf222e;
  --diff-skipped-fg: var(--diff-muted);

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
  border-radius: inherit;
}

:global(:root[data-theme='dark'] .diff-viewer) {
  --diff-code-bg: #0d1117;
  --diff-gutter-bg: #161b22;
  --diff-border: #30363d;
  --diff-text: #c9d1d9;
  --diff-muted: #8b949e;
  --diff-line-hover-bg: rgb(177 186 196 / 12%);
  --diff-added-bg: #10281a;
  --diff-added-gutter-bg: #1a3d21;
  --diff-added-fg: #3fb950;
  --diff-removed-bg: #33191e;
  --diff-removed-gutter-bg: #542024;
  --diff-removed-fg: #f85149;
  --diff-skipped-fg: var(--diff-muted);
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
}

.diff-viewer__line--removed .diff-viewer__line-number {
  background: var(--diff-removed-gutter-bg);
}

.diff-viewer__line--skipped .diff-viewer__line-number {
  background: var(--diff-gutter-bg);
  color: var(--diff-skipped-fg);
}

.diff-viewer__marker {
  position: sticky;
  left: var(--diff-line-number-width);
  z-index: 2;
  flex: 0 0 var(--diff-marker-width);
  width: var(--diff-marker-width);
  padding: 0 4px;
  color: var(--diff-muted);
  background: var(--diff-code-bg);
  text-align: center;
  user-select: none;
  border-right: 1px solid transparent;
}

.diff-viewer__line--added .diff-viewer__marker {
  color: var(--diff-added-fg);
  background: var(--diff-added-bg);
}

.diff-viewer__line--removed .diff-viewer__marker {
  color: var(--diff-removed-fg);
  background: var(--diff-removed-bg);
}

.diff-viewer__line--skipped .diff-viewer__marker {
  color: var(--diff-skipped-fg);
  background: var(--diff-code-bg);
}

.diff-viewer__content {
  box-sizing: border-box;
  display: block;
  flex: 1 0 auto;
  min-width: 0;
  padding: 0 12px 0 8px;
  overflow: visible;
  white-space: pre;
}
</style>
