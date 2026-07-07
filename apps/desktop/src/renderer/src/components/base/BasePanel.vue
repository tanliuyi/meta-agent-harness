<script setup lang="ts">
/**
 * BasePanel.vue - 基础面板组件。
 *
 * 提供可选标题、眉题与操作区域的内容容器。
 */

withDefaults(
  defineProps<{
    /** 面板标题。 */
    title?: string
    /** 面板眉题（标题上方小字）。 */
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
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(12px);

  & + & {
    margin-top: var(--space-4);
  }
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
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.base-panel__eyebrow {
  margin: 0;
  color: var(--color-primary);
  font-size: var(--font-size-ui-2xs);
  font-weight: 750;
}

.base-panel__title {
  margin: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--font-size-ui);
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
