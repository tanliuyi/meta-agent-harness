<script setup lang="ts">
/**
 * BaseBadge.vue - 基础徽标组件。
 *
 * 提供多种语调的标签徽标，用于展示状态或分类。
 */

withDefaults(
  defineProps<{
    /** 徽标语调。 */
    tone?: 'neutral' | 'success' | 'warning' | 'info'
  }>(),
  {
    tone: 'neutral'
  }
)
</script>

<template>
  <span class="base-badge" :class="`is-${tone}`">
    <slot />
  </span>
</template>

<style lang="scss" scoped>
.base-badge {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  min-width: 0;
  min-height: 18px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  font-size: var(--font-size-ui-2xs);
  font-weight: 700;
  line-height: 1;
}

.is-neutral {
  color: var(--color-text-muted);
  background: var(--color-badge-neutral-bg);
  border-color: var(--color-border);
}

.is-success {
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
  border-color: var(--color-primary-outline);
}

.is-warning {
  color: var(--color-accent);
  background: var(--color-accent-soft);
  border-color: var(--color-accent-outline);
}

.is-info {
  color: var(--color-info);
  background: var(--color-info-soft);
  border-color: var(--color-info-outline);
}
</style>
