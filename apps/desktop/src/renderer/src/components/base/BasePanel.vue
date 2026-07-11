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

  & + & {
    margin-top: 36px;
  }
}

.base-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: 28px;
  padding: 0 0 var(--space-3);
  border-bottom: 1px solid var(--color-border-muted);
}

.base-panel__heading {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.base-panel__eyebrow {
  display: none;
}

.base-panel__title {
  margin: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--font-size-ui-sm);
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: 0.03em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.base-panel__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-2);
}

.base-panel__body {
  min-width: 0;
  overflow: hidden;
  padding: var(--space-4);
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
}
</style>
