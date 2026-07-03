<script setup lang="ts">
import { computed } from 'vue'

/**
 * StreamingLink - 安全渲染 Markdown 链接。
 * 仅允许 http / https / mailto scheme，其它 scheme 显示为纯文本。
 */

const props = defineProps<{
  node: {
    type: 'link'
    href: string
    title: string | null
    text: string
    children: { type: string; raw: string }[]
    raw: string
  }
}>()

const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:']

const isSafe = computed(() => {
  const href = props.node.href.trim()
  if (!href || !href.trim()) return false
  if (/[\x00-\x1f\x7f]/.test(href)) return false
  const scheme = href.match(/^([A-Za-z][A-Za-z0-9+.-]*):/)
  if (!scheme) return false
  try {
    const url = new URL(href)
    return ALLOWED_SCHEMES.includes(url.protocol.toLowerCase())
  } catch {
    return false
  }
})
</script>

<template>
  <a
    v-if="isSafe"
    :href="props.node.href"
    target="_blank"
    rel="noopener noreferrer"
    class="streaming-link"
  >
    {{ props.node.text }}
  </a>
  <span v-else class="streaming-link streaming-link--unsafe">
    {{ props.node.text }}
  </span>
</template>

<style lang="scss" scoped>
.streaming-link {
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
  word-break: break-word;

  &:hover {
    color: var(--color-primary-strong);
  }
}

.streaming-link--unsafe {
  color: var(--color-text-muted);
  text-decoration: none;
  cursor: default;
}
</style>
