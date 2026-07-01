<script setup lang="ts">
/**
 * 本文件提供基础面板组件。
 */

withDefaults(
  defineProps<{
    title?: string
    eyebrow?: string
  }>(),
  {
    title: '',
    eyebrow: ''
  }
)
</script>

<template>
  <section class="base-panel">
    <header v-if="title || eyebrow || $slots.actions" class="base-panel__header">
      <div class="base-panel__heading">
        <p v-if="eyebrow" class="base-panel__eyebrow">{{ eyebrow }}</p>
        <h2 v-if="title" class="base-panel__title">{{ title }}</h2>
      </div>
      <div v-if="$slots.actions" class="base-panel__actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="base-panel__body">
      <slot />
    </div>
  </section>
</template>

<style lang="scss" scoped>
.base-panel {
  min-width: 0;
  overflow: hidden;
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(12px);
}

.base-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: 42px;
  padding: var(--space-3);
  border-bottom: 1px solid var(--color-border);
}

.base-panel__heading {
  min-width: 0;
}

.base-panel__eyebrow {
  margin: 0;
  color: var(--color-primary);
  font-size: 10px;
  font-weight: 750;
  text-transform: uppercase;
}

.base-panel__title {
  margin: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: 13px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.base-panel__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 0 0 auto;
}

.base-panel__body {
  padding: var(--space-3);
}
</style>
