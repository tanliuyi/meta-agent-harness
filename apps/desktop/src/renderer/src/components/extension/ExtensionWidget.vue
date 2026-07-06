<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    title: string
    lines: string[]
    variant?: 'compact' | 'detail'
  }>(),
  {
    variant: 'detail'
  }
)

const primaryLine = computed(() => props.lines[0] ?? '')
const secondaryLine = computed(() => props.lines.slice(1).join(' · '))
const fullText = computed(() => props.lines.join('\n'))
</script>

<template>
  <article class="extension-ui-widget" :class="`is-${variant}`">
    <header class="extension-ui-widget__header">
      <strong>{{ title }}</strong>
      <slot name="actions" />
    </header>

    <div v-if="variant === 'compact'" class="extension-ui-widget__compact-lines" :title="fullText">
      <span class="extension-ui-widget__primary">{{ primaryLine }}</span>
      <span v-if="secondaryLine" class="extension-ui-widget__secondary">{{ secondaryLine }}</span>
    </div>

    <div v-else class="extension-ui-widget__detail-lines">
      <p v-for="(line, index) in lines" :key="`${index}:${line}`">{{ line }}</p>
    </div>
  </article>
</template>

<style scoped lang="scss">
.extension-ui-widget {
  min-width: 0;
  color: var(--color-text-muted);
}

.extension-ui-widget__header {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  justify-content: space-between;
  min-width: 0;
}

.extension-ui-widget__header strong {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--font-size-ui-xs);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.extension-ui-widget.is-compact {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-2);
  align-items: center;
  min-height: 26px;
  padding: 0 var(--space-2);
  background: var(--color-surface);
  border: 1px solid var(--color-border-muted);
  border-radius: var(--radius-md);
}

.extension-ui-widget.is-compact .extension-ui-widget__header {
  min-width: 0;
}

.extension-ui-widget__compact-lines {
  display: flex;
  gap: var(--space-1);
  min-width: 0;
  overflow: hidden;
  font-size: var(--font-size-ui-xs);
  white-space: nowrap;
}

.extension-ui-widget__primary,
.extension-ui-widget__secondary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.extension-ui-widget__primary {
  flex: 0 1 auto;
}

.extension-ui-widget__secondary {
  flex: 1 1 auto;
  color: var(--color-text-subtle);
}

.extension-ui-widget.is-detail {
  display: grid;
  gap: 4px;
  padding: 7px 2px;
  background: transparent;
  border-bottom: 1px solid var(--color-border-muted);
}

.extension-ui-widget.is-detail .extension-ui-widget__header {
  min-height: 24px;
}

.extension-ui-widget__detail-lines {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.extension-ui-widget__detail-lines p {
  min-width: 0;
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);
  line-height: 1.45;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
