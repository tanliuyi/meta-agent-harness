<script setup lang="ts">
import { computed, markRaw, shallowRef, watch } from 'vue'
import { useTheme } from '@renderer/composables/useTheme'
import { shikiHighlightService } from '@renderer/components/markdown/shiki-highlight-service'
import type { HighlightTokens } from '@renderer/components/markdown/shiki-highlight.worker'
import BaseTool from './BaseTool.vue'
import {
  getFileName,
  getNumberArg,
  getStringArg,
  getToolArgs,
  getToolResultText,
  getToolStatusLabel,
  isToolError,
  joinSummary,
  type ToolComponentProps
} from './support/tool-message'

const props = defineProps<ToolComponentProps>()
const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const highlightedResult = shallowRef<HighlightTokens>()
const { resolvedTheme } = useTheme()
let highlightRevision = 0

const args = computed(() => getToolArgs(props.toolCall))
const filePath = computed(() => getStringArg(args.value, 'path'))
const fileName = computed(() => getFileName(filePath.value))
const offset = computed(() => getNumberArg(args.value, 'offset'))
const limit = computed(() => getNumberArg(args.value, 'limit'))
const summary = computed(() =>
  joinSummary([
    fileName.value,
    offset.value ? `offset=${offset.value}` : undefined,
    limit.value ? `limit=${limit.value}` : undefined
  ])
)
const result = computed(() => getToolResultText(props.message, props.toolCall))
const highlightLanguage = computed(() => getReadLanguage(filePath.value))
const highlightTheme = computed(() =>
  resolvedTheme.value === 'dark' ? 'github-dark' : 'github-light'
)
const isError = computed(() => isToolError(props.message, props.toolCall))
const status = computed(() => props.toolCall?.status)
const name = computed(() =>
  getToolStatusLabel(status.value, {
    queued: '正在读取',
    running: '正在读取',
    succeeded: '已读取',
    failed: '读取失败',
    cancelled: '取消读取'
  })
)

watch(
  [result, highlightLanguage, highlightTheme],
  async ([nextResult, language, theme]) => {
    const revision = ++highlightRevision
    highlightedResult.value = undefined
    if (!nextResult) return

    const highlighted = await shikiHighlightService.highlight({
      messageId: props.toolCall?.toolCallId ?? 'read-result',
      messageRevision: revision,
      blockIndex: 'read-result',
      lang: language,
      code: nextResult,
      theme
    })
    if (revision === highlightRevision && highlighted) {
      highlightedResult.value = markRaw(highlighted.tokens)
    }
  },
  { immediate: true }
)

function getReadLanguage(path: string | undefined): string {
  const extension = path
    ?.split(/[?#]/, 1)[0]
    ?.match(/\.([^.\\/]+)$/)?.[1]
    ?.toLowerCase()
  const languages: Record<string, string> = {
    bash: 'bash',
    css: 'css',
    diff: 'diff',
    go: 'go',
    htm: 'html',
    html: 'html',
    js: 'javascript',
    jsx: 'jsx',
    json: 'json',
    md: 'markdown',
    mjs: 'javascript',
    py: 'python',
    rs: 'rust',
    scss: 'scss',
    sh: 'shell',
    ts: 'typescript',
    tsx: 'tsx',
    vue: 'vue',
    yaml: 'yaml',
    yml: 'yaml'
  }
  return extension ? (languages[extension] ?? 'text') : 'text'
}
</script>

<template>
  <BaseTool
    :name="name"
    :summary="summary"
    :result="result"
    :status="status"
    :is-error="isError"
    :default-open="props.defaultOpen"
    :open="props.open"
    @update:open="emit('update:open', $event)"
  >
    <template #summary>
      <span v-if="fileName" class="read-tool__path">{{ fileName }}</span>
      <span v-if="offset" class="read-tool__meta">offset={{ offset }}</span>
      <span v-if="limit" class="read-tool__meta">limit={{ limit }}</span>
      <span v-if="!fileName && summary">{{ summary }}</span>
    </template>
    <template #content>
      <div v-if="result" class="tool-message__result read-tool__result">
        <!-- prettier-ignore -->
        <pre v-if="highlightedResult"><code><span v-for="(token, index) in highlightedResult" :key="index" :style="token.style">{{ token.content }}</span></code></pre>
        <pre v-else><code>{{ result }}</code></pre>
      </div>
      <dl v-if="isError" class="tool-message__error">
        <dt>error</dt>
      </dl>
    </template>
  </BaseTool>
</template>

<style lang="scss" scoped>
.read-tool__path {
  color: var(--color-info);
}

.read-tool__meta {
  color: var(--color-text-subtle);
}

.read-tool__path + .read-tool__meta,
.read-tool__meta + .read-tool__meta {
  margin-left: var(--space-1);
}

.read-tool__result pre,
.read-tool__result code {
  background: transparent;
}

.read-tool__result span {
  white-space: pre;
}
</style>
