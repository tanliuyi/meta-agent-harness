<script setup lang="ts">
import { computed } from 'vue'

const fileReferenceMarker = 'meta-agent-file-ref:'

defineOptions({
  inheritAttrs: false
})

const props = defineProps<{
  node: {
    type: 'inline_code'
    code: string
    raw: string
  }
}>()

const fileArg = computed(() => parseFileReferenceMarker(props.node.code))
const fileLabel = computed(() => getFileReferenceDisplayName(fileArg.value ?? ''))
const inlineCodeText = computed(() => props.node.code || props.node.raw || '')

function parseFileReferenceMarker(value: string): string | undefined {
  if (!value.startsWith(fileReferenceMarker)) {
    return undefined
  }
  const encoded = value.slice(fileReferenceMarker.length)
  try {
    return decodeURIComponent(encoded)
  } catch {
    return encoded
  }
}

function getFileReferenceDisplayName(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
  const separatorIndex = normalized.lastIndexOf('/')
  return separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized
}
</script>

<template>
  <span v-if="fileArg" class="file-reference-node" :title="fileArg">
    <span class="file-reference-node__icon">@</span>
    <span class="file-reference-node__label">{{ fileLabel }}</span>
  </span>
  <code v-else class="streaming-inline-code">{{ inlineCodeText }}</code>
</template>

<style lang="scss" scoped>
@use '../chat/file-reference-node';

.file-reference-node {
  @include file-reference-node.file-reference-node;
}

.file-reference-node__icon {
  @include file-reference-node.file-reference-node-icon;
}

.file-reference-node__label {
  @include file-reference-node.file-reference-node-label;
}

.streaming-inline-code {
  display: inline;
  padding: 2px 5px;
  font-family: var(--font-mono) !important;
  font-size: var(--font-size-code);
  font-weight: var(--font-weight-code);
  line-height: 1.5;
  color: var(--markdown-inline-code-text);
  white-space: normal;
  overflow-wrap: break-word;
  word-break: break-word;
  background: var(--markdown-inline-code-bg);
  border-radius: var(--radius-xs);
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
</style>
