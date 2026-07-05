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
  --diff-line-number-width: 48px;
  --diff-marker-width: 22px;
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

  min-width: 100%;
  max-height: inherit;
  overflow: auto;
  color: var(--diff-text);
  font-family: var(--font-mono);
  font-size: var(--font-size-code);
  font-weight: var(--font-weight-code);
  line-height: 20px;
  background: var(--diff-code-bg);
  border-radius: inherit;
}

:global(:root[data-theme='dark']) .diff-viewer {
  --diff-code-bg: #0d1117;
  --diff-gutter-bg: #161b22;
  --diff-border: #30363d;
  --diff-text: #c9d1d9;
  --diff-muted: #8b949e;
  --diff-line-hover-bg: rgb(177 186 196 / 12%);
  --diff-added-bg: rgb(46 160 67 / 15%);
  --diff-added-gutter-bg: rgb(46 160 67 / 30%);
  --diff-added-fg: #3fb950;
  --diff-removed-bg: rgb(248 81 73 / 15%);
  --diff-removed-gutter-bg: rgb(248 81 73 / 30%);
  --diff-removed-fg: #f85149;
  --diff-skipped-fg: var(--diff-muted);
}

.diff-viewer__line {
  display: grid;
  grid-template-columns: var(--diff-line-number-width) var(--diff-marker-width) minmax(24rem, 1fr);
  width: max-content;
  min-width: 100%;
  min-height: 20px;
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
  padding: 0 16px 0 8px;
  white-space: pre;
}
</style>
