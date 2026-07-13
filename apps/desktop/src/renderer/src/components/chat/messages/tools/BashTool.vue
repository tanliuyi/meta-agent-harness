<script setup lang="ts">
import { computed, markRaw, ref, shallowRef, watch } from 'vue'
import { BaseButton } from '@renderer/components/base'
import { useTheme } from '@renderer/composables/useTheme'
import { shikiHighlightService } from '@renderer/components/markdown/shiki-highlight-service'
import type { HighlightTokens } from '@renderer/components/markdown/shiki-highlight.worker'
import BaseTool from './BaseTool.vue'
import TerminalIcon from '@renderer/components/icons/TerminalIcon.vue'
import {
  getNumberArg,
  getStringArg,
  getToolDetails,
  getToolArgs,
  getToolResultText,
  getToolStatusLabel,
  isToolError,
  joinSummary,
  truncateSummary,
  type ToolComponentProps
} from './support/tool-message'
import {
  extractFullOutputPath,
  getTruncationLabel,
  readBoolean,
  readRecord,
  readString
} from './display/bashToolDisplay'

const props = defineProps<ToolComponentProps>()
const emit = defineEmits<{
  'update:open': [open: boolean]
}>()
const actionError = ref<string>()
const highlightedResult = shallowRef<HighlightTokens>()
const { resolvedTheme } = useTheme()
let highlightRevision = 0

const args = computed(() => getToolArgs(props.toolCall))
const details = computed(() => getToolDetails(props.toolCall))
const command = computed(() => truncateSummary(getStringArg(args.value, 'command'), 96))
const timeout = computed(() => getNumberArg(args.value, 'timeout'))
const summary = computed(() =>
  joinSummary([command.value, timeout.value ? `timeout=${timeout.value}s` : undefined])
)
const result = computed(() => getToolResultText(props.message, props.toolCall))
const highlightLanguage = computed(() =>
  /(?:^|[;&|\s])git\s+(?:--[^\s]+\s+)*diff(?:\s|$)/.test(command.value ?? '') ? 'diff' : 'shell'
)
const highlightTheme = computed(() =>
  resolvedTheme.value === 'dark' ? 'github-dark' : 'github-light'
)
const isError = computed(() => isToolError(props.message, props.toolCall))
const status = computed(() => props.toolCall?.status)
const name = computed(() =>
  getToolStatusLabel(status.value, {
    queued: '正在执行',
    running: '正在执行',
    succeeded: '已执行',
    failed: '执行失败',
    cancelled: '取消执行'
  })
)
const truncation = computed(() => readRecord(details.value.truncation))
const isTruncated = computed(
  () => readBoolean(details.value.truncated) || truncation.value !== undefined
)
const fullOutputPath = computed(
  () =>
    readString(details.value.fullOutputPath) ??
    readString(props.toolCall?.result, 'fullOutputPath') ??
    extractFullOutputPath(result.value)
)
const hasContent = computed(() =>
  Boolean(
    result.value || isError.value || isTruncated.value || fullOutputPath.value || actionError.value
  )
)
const truncationLabel = computed(() => getTruncationLabel(truncation.value))

watch(
  [result, highlightLanguage, highlightTheme],
  async ([nextResult, language, theme]) => {
    const revision = ++highlightRevision
    highlightedResult.value = undefined
    if (!nextResult) return

    const highlighted = await shikiHighlightService.highlight({
      messageId: props.toolCall?.toolCallId ?? 'bash-result',
      messageRevision: revision,
      blockIndex: 'bash-result',
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

async function showFullOutput(): Promise<void> {
  await revealFullOutput()
}

async function revealFullOutput(): Promise<void> {
  const path = fullOutputPath.value
  if (!path) {
    return
  }
  actionError.value = undefined
  try {
    await window.api.codingAgent.revealResourcePath({ path, mode: 'reveal' })
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : String(error)
  }
}
</script>

<template>
  <BaseTool
    :name="name"
    :summary="summary"
    :result="result"
    :status="status"
    :is-error="isError"
    :content-available="hasContent"
    :default-open="props.defaultOpen"
    :open="props.open"
    @update:open="emit('update:open', $event)"
  >
    <template #icon>
      <TerminalIcon :size="14" />
    </template>
    <template #summary>
      <span v-if="command" class="bash-tool__command" :title="command">{{ command }}</span>
      <span v-if="timeout" class="bash-tool__meta">timeout={{ timeout }}s</span>
      <span v-if="summary && !command" class="bash-tool__fallback">{{ summary }}</span>
      <span v-if="isTruncated" class="bash-tool__truncated">已截断</span>
    </template>
    <template #content>
      <div v-if="isTruncated || fullOutputPath || actionError" class="bash-tool__notice">
        <div class="bash-tool__notice-copy">
          <span v-if="isTruncated">{{ truncationLabel }}</span>
          <span v-if="fullOutputPath" class="bash-tool__path">{{ fullOutputPath }}</span>
          <span v-if="actionError" class="bash-tool__error">{{ actionError }}</span>
        </div>
        <div v-if="fullOutputPath" class="bash-tool__actions">
          <BaseButton size="sm" variant="ghost" @click.stop="showFullOutput">显示</BaseButton>
        </div>
      </div>
      <div v-if="result" class="tool-message__result bash-tool__result">
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
.bash-tool__command,
.bash-tool__fallback {
  color: var(--color-info);
}

.bash-tool__meta {
  color: var(--color-text-subtle);
}

.bash-tool__command + .bash-tool__meta,
.bash-tool__fallback + .bash-tool__meta,
.bash-tool__command + .bash-tool__truncated,
.bash-tool__meta + .bash-tool__truncated {
  margin-left: var(--space-1);
}

.bash-tool__truncated {
  display: inline-flex;
  align-items: center;
  min-height: 18px;
  padding: 0 var(--space-1);
  border: 1px solid var(--color-warning, var(--color-border));
  border-radius: var(--radius-md);
  color: var(--color-warning, var(--color-text-muted));
  font-size: var(--font-size-ui-xs);
  font-family: var(--font-sans);
  line-height: 1;
}

.bash-tool__notice {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);
}

.bash-tool__notice-copy {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.bash-tool__path {
  overflow: hidden;
  color: var(--color-text-subtle);
  font-family: var(--font-mono) !important;
  font-size: var(--font-size-code);
  font-weight: var(--font-weight-code);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bash-tool__error {
  color: var(--color-danger);
}

.bash-tool__result pre,
.bash-tool__result code {
  background: transparent;
}

.bash-tool__result span {
  white-space: pre;
}

.bash-tool__actions {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-1);
}
</style>
