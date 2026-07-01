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
  min-width: 0;
  min-height: 18px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.is-neutral {
  color: var(--color-text-muted);
  background: rgb(255 255 255 / 5%);
  border-color: var(--color-border);
}

.is-success {
  color: var(--color-primary-strong);
  background: rgb(105 210 160 / 10%);
  border-color: rgb(105 210 160 / 34%);
}

.is-warning {
  color: var(--color-accent);
  background: rgb(244 189 79 / 10%);
  border-color: rgb(244 189 79 / 34%);
}

.is-info {
  color: var(--color-info);
  background: rgb(121 169 255 / 10%);
  border-color: rgb(121 169 255 / 34%);
}
</style>
