<script setup lang="ts">
/**
 * StreamingImage - 图片占位组件。
 * 本期不渲染远程 Markdown 图片，仅显示 alt 文本或 src 占位。
 */

const props = defineProps<{
  node: {
    type: 'image'
    src: string
    alt: string
    title: string | null
    raw: string
  }
}>()
</script>

<template>
  <span class="streaming-image-fallback" :title="props.node.alt || undefined">
    [图片: {{ props.node.alt || props.node.src }}]
  </span>
</template>

<style lang="scss" scoped>
.streaming-image-fallback {
  color: var(--color-text-muted);
  font-size: 0.92em;
  word-break: break-word;
}
</style>
