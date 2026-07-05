<script setup lang="ts">
import { computed, ref } from 'vue'
import { BaseButton } from '@renderer/components/base'
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
} from './tool-message'

const props = defineProps<ToolComponentProps>()
const actionError = ref<string>()

const args = computed(() => getToolArgs(props.toolCall))
const details = computed(() => getToolDetails(props.toolCall))
const command = computed(() => truncateSummary(getStringArg(args.value, 'command'), 96))
const timeout = computed(() => getNumberArg(args.value, 'timeout'))
const summary = computed(() =>
  joinSummary([command.value, timeout.value ? `timeout=${timeout.value}s` : undefined])
)
const result = computed(() => getToolResultText(props.message, props.toolCall))
const isError = computed(() => isToolError(props.message, props.toolCall))
const status = computed(() => props.toolCall?.status)
const name = computed(() =>
  getToolStatusLabel(status.value, {
    queued: '准备执行',
    running: '正在执行',
    succeeded: '已执行',
    failed: '执行失败',
    cancelled: '已取消执行'
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

async function openFullOutput(): Promise<void> {
  await revealFullOutput('open')
}

async function showFullOutput(): Promise<void> {
  await revealFullOutput('reveal')
}

async function revealFullOutput(mode: 'open' | 'reveal'): Promise<void> {
  const path = fullOutputPath.value
  if (!path) {
    return
  }
  actionError.value = undefined
  try {
    await window.api.codingAgent.revealResourcePath({ path, mode })
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : String(error)
  }
}

function getTruncationLabel(value: Record<string, unknown> | undefined): string {
  if (!value) {
    return '输出已截断'
  }

  const totalLines = readNumber(value.totalLines)
  const outputLines = readNumber(value.outputLines)
  const outputBytes = readNumber(value.outputBytes)
  const truncatedBy = readString(value.truncatedBy)

  if (totalLines !== undefined && outputLines !== undefined && outputLines > 0) {
    const startLine = Math.max(1, totalLines - outputLines + 1)
    return `显示 ${startLine}-${totalLines} / ${totalLines} 行`
  }

  if (outputBytes !== undefined) {
    return `${formatBytes(outputBytes)} 输出片段`
  }

  if (truncatedBy) {
    return `按 ${truncatedBy} 截断`
  }

  return '输出已截断'
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`
  }
  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`
  }
  return `${value} B`
}

function extractFullOutputPath(value: string | undefined): string | undefined {
  return value?.match(/Full output:\s*([^\]\n]+)/)?.[1]?.trim()
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

function readString(value: unknown, key?: string): string | undefined {
  const raw = key ? readRecord(value)?.[key] : value
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readBoolean(value: unknown): boolean {
  return value === true
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
  >
    <template #icon>
      <TerminalIcon :size="14" />
    </template>
    <template #summary>
      <span class="bash-tool__summary">
        <span v-if="command" class="bash-tool__command" :title="command">{{ command }}</span>
        <span v-if="timeout" class="bash-tool__meta">timeout={{ timeout }}s</span>
        <span v-if="summary && !command" class="bash-tool__fallback">{{ summary }}</span>
        <span v-if="isTruncated" class="bash-tool__truncated">已截断</span>
      </span>
    </template>
    <template #content>
      <div v-if="isTruncated || fullOutputPath || actionError" class="bash-tool__notice">
        <div class="bash-tool__notice-copy">
          <span v-if="isTruncated">{{ truncationLabel }}</span>
          <span v-if="fullOutputPath" class="bash-tool__path">{{ fullOutputPath }}</span>
          <span v-if="actionError" class="bash-tool__error">{{ actionError }}</span>
        </div>
        <div v-if="fullOutputPath" class="bash-tool__actions">
          <BaseButton size="sm" variant="ghost" @click.stop="openFullOutput">打开</BaseButton>
          <BaseButton size="sm" variant="ghost" @click.stop="showFullOutput">显示</BaseButton>
        </div>
      </div>
      <div v-if="result" class="tool-message__result">
        <pre><code>{{ result }}</code></pre>
      </div>
      <dl v-if="isError" class="tool-message__error">
        <dt>error</dt>
        <dd>true</dd>
      </dl>
    </template>
  </BaseTool>
</template>

<style lang="scss" scoped>
.bash-tool__summary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

.bash-tool__command,
.bash-tool__fallback {
  min-width: 0;
  overflow: hidden;
  color: var(--color-info);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bash-tool__command {
  flex: 1 1 auto;
}

.bash-tool__fallback {
  flex: 0 1 auto;
}

.bash-tool__meta {
  flex: 0 0 auto;
  color: var(--color-text-subtle);
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
  font-family: var(--font-mono);
  font-size: var(--font-size-code);
  font-weight: var(--font-weight-code);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bash-tool__error {
  color: var(--color-danger);
}

.bash-tool__actions {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-1);
}
</style>
