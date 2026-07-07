<script setup lang="ts">
defineOptions({
  inheritAttrs: false
})
</script>

<template>
  <div class="compaction-divider" role="separator" aria-label="上下文已压缩">
    <span>上下文已压缩</span>
  </div>
</template>

<style lang="scss" scoped>
.compaction-divider {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  color: var(--color-text-subtle);
  font-family: var(--font-mono) !important;
  font-size: var(--font-size-ui-xs);
  line-height: 1.4;

  &::before,
  &::after {
    content: '';
    min-width: 0;
    height: 1px;
    background: var(--color-border);
  }

  span {
    white-space: nowrap;
  }
}
</style>
