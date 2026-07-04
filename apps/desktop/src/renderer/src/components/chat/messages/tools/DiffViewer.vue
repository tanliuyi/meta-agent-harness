<script setup lang="ts">
import { computed } from 'vue'

type DiffLineKind = 'added' | 'removed' | 'context' | 'skipped'

interface DiffLine {
  kind: DiffLineKind
  lineNumber?: number
  text: string
}

const props = defineProps<{
  diff: string
}>()

const lines = computed(() => parseDisplayDiff(props.diff))

function parseDisplayDiff(diff: string): DiffLine[] {
  return diff.split('\n').map((line) => {
    const match = line.match(/^([+\- ])(\s*\d+)\s(.*)$/)
    if (!match) {
      return {
        kind: 'skipped',
        text: line.trim() === '...' ? '...' : line
      }
    }

    const [, marker, rawLineNumber = '', text = ''] = match
    const lineNumber = Number.parseInt(rawLineNumber.trim(), 10)
    if (marker === '+') {
      return { kind: 'added', lineNumber, text }
    }
    if (marker === '-') {
      return { kind: 'removed', lineNumber, text }
    }
    return {
      kind: text.trim() === '...' ? 'skipped' : 'context',
      lineNumber: Number.isNaN(lineNumber) ? undefined : lineNumber,
      text
    }
  })
}
</script>

<template>
  <div class="diff-viewer" role="table" aria-label="Diff">
    <div
      v-for="(line, index) in lines"
      :key="`${index}:${line.kind}:${line.lineNumber ?? ''}`"
      class="diff-viewer__line"
      :class="`diff-viewer__line--${line.kind}`"
      role="row"
    >
      <span class="diff-viewer__line-number" role="cell">{{ line.lineNumber ?? '' }}</span>
      <span class="diff-viewer__marker" role="cell">
        <template v-if="line.kind === 'added'">+</template>
        <template v-else-if="line.kind === 'removed'">-</template>
      </span>
      <span class="diff-viewer__content" role="cell">{{ line.text }}</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.diff-viewer {
  --diff-line-number-width: 30px;
  --diff-marker-width: 18px;
  --diff-code-bg: var(--color-canvas);
  --diff-gutter-bg: var(--color-surface-raised);
  --diff-border: var(--color-border);
  --diff-text: var(--color-text);
  --diff-muted: var(--color-text-subtle);
  --diff-added-bg: var(--color-diff-added-bg);
  --diff-added-gutter-bg: var(--color-diff-added-gutter-bg);
  --diff-added-fg: var(--color-primary);
  --diff-removed-bg: var(--color-diff-removed-bg);
  --diff-removed-gutter-bg: var(--color-diff-removed-gutter-bg);
  --diff-removed-fg: var(--color-danger);
  --diff-skipped-bg: var(--color-surface-raised);

  min-width: 100%;
  max-height: inherit;
  overflow: auto;
  color: var(--diff-text);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: var(--font-weight-code);
  line-height: 20px;
  background: var(--diff-code-bg);
}

.diff-viewer__line {
  display: grid;
  grid-template-columns: var(--diff-line-number-width) var(--diff-marker-width) minmax(24rem, 1fr);
  width: max-content;
  min-width: 100%;
}

.diff-viewer__line--added {
  background: var(--diff-added-bg);
}

.diff-viewer__line--removed {
  background: var(--diff-removed-bg);
}

.diff-viewer__line--skipped {
  background: var(--diff-skipped-bg);
}

.diff-viewer__line-number {
  position: sticky;
  left: 0;
  z-index: 2;
  padding: 0 6px 0 2px;
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
  background: var(--diff-skipped-bg);
}

.diff-viewer__marker {
  padding: 0 3px;
  color: var(--diff-muted);
  text-align: center;
  user-select: none;
}

.diff-viewer__line--added .diff-viewer__marker {
  color: var(--diff-added-fg);
}

.diff-viewer__line--removed .diff-viewer__marker {
  color: var(--diff-removed-fg);
}

.diff-viewer__content {
  padding: 0 16px 0 4px;
  white-space: pre;
}
</style>
