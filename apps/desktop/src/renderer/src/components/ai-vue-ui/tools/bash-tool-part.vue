<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clipboard,
  ExternalLink,
  LoaderCircle,
  Terminal
} from 'lucide-vue-next'
import { BaseIconButton } from '@renderer/components/base'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'

const props = defineProps<{
  args: unknown
  output: unknown
  state?: string
}>()

type BashState = 'pending' | 'running' | 'complete' | 'error' | 'cancelled'

interface BashArgs {
  command?: string
  cwd?: string
  timeout?: number
  excludeFromContext?: boolean
}

interface BashOutput {
  output?: string
  error?: string
  exitCode?: number
  cancelled?: boolean
  truncated?: boolean
  fullOutputPath?: string
}

const open = ref(false)
const copied = ref(false)
const actionError = ref<string>()
let copyTimer: ReturnType<typeof setTimeout> | undefined

const parsedArgs = computed<BashArgs>(() => {
  const value = parseMaybeJson(props.args)
  if (!isRecord(value)) return {}

  return {
    command: readString(value.command),
    cwd: readString(value.cwd),
    timeout: readNumber(value.timeout),
    excludeFromContext: value.excludeFromContext === true
  }
})

const parsedOutput = computed<BashOutput>(() => normalizeOutput(props.output))
const command = computed(() => parsedArgs.value.command ?? '')
const cwd = computed(() => parsedArgs.value.cwd)
const timeout = computed(() => parsedArgs.value.timeout)
const error = computed(() => parsedOutput.value.error)
const outputText = computed(() => parsedOutput.value.output)
const visibleError = computed(() => Boolean(error.value && !outputText.value))
const exitCode = computed(() => parsedOutput.value.exitCode)
const fullOutputPath = computed(
  () => parsedOutput.value.fullOutputPath ?? extractFullOutputPath(outputText.value)
)
const truncated = computed(
  () => parsedOutput.value.truncated === true || Boolean(fullOutputPath.value)
)
const state = computed<BashState>(() => {
  if (parsedOutput.value.cancelled) return 'cancelled'
  if (props.state === 'error' || props.state === 'output-error') return 'error'
  if (props.state === 'complete' || props.state === 'output-available') {
    if (error.value || (exitCode.value !== undefined && exitCode.value !== 0)) return 'error'
    return 'complete'
  }
  if (props.state === 'input-streaming' || props.state === 'input-available') return 'running'
  if (error.value || (exitCode.value !== undefined && exitCode.value !== 0)) return 'error'
  if (props.output !== undefined) return 'complete'
  return 'running'
})
const hasDetails = computed(() => {
  return Boolean(outputText.value || visibleError.value || fullOutputPath.value)
})
const commandSummary = computed(() => truncateMiddle(command.value || 'bash', 160))
const stateLabel = computed(() => {
  if (state.value === 'running' || state.value === 'pending') return '正在执行'
  if (state.value === 'error') return '执行失败'
  if (state.value === 'cancelled') return '取消执行'
  return '已执行'
})

async function copyCommand(): Promise<void> {
  if (!command.value) return
  actionError.value = undefined
  try {
    await navigator.clipboard.writeText(command.value)
    copied.value = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied.value = false
      copyTimer = undefined
    }, 1400)
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err)
  }
}

async function revealFullOutput(): Promise<void> {
  if (!fullOutputPath.value) return
  actionError.value = undefined
  try {
    await window.api?.codingAgent.revealResourcePath?.({
      path: fullOutputPath.value,
      mode: 'reveal'
    })
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err)
  }
}

function normalizeOutput(value: unknown): BashOutput {
  const parsed = parseMaybeJson(value)
  if (typeof parsed === 'string') {
    return { output: parsed }
  }
  if (!isRecord(parsed)) {
    return {}
  }

  return {
    output: readString(parsed.output),
    error: readString(parsed.error),
    exitCode: readNumber(parsed.exitCode),
    cancelled: parsed.cancelled === true,
    truncated: parsed.truncated === true,
    fullOutputPath: readString(parsed.fullOutputPath)
  }
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return value
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return value
  }
}

function extractFullOutputPath(value: string | undefined): string | undefined {
  return value?.match(/Full output:\s*([^\]\n]+)/)?.[1]?.trim()
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  const headLength = Math.ceil((maxLength - 1) * 0.65)
  const tailLength = maxLength - headLength - 1
  return `${value.slice(0, headLength)}…${value.slice(-tailLength)}`
}
</script>

<template>
  <Collapsible v-model:open="open" class="base-tool-part bash-tool-part" :data-bash-state="state">
    <header class="bash-tool-part__header">
      <CollapsibleTrigger class="bash-tool-part__summary" :disabled="!hasDetails">
        <span class="bash-tool-part__icon" aria-hidden="true">
          <LoaderCircle v-if="state === 'running'" :size="15" class="bash-tool-part__spin" />
          <CircleAlert v-else-if="state === 'error'" :size="15" />
          <CircleCheck v-else-if="state === 'complete'" :size="15" />
          <Terminal v-else :size="15" />
        </span>
        <span class="bash-tool-part__title">{{ stateLabel }}</span>
        <code class="bash-tool-part__command" :title="command">{{ commandSummary }}</code>
        <span v-if="exitCode !== undefined" class="bash-tool-part__meta">exit {{ exitCode }}</span>
        <span v-if="truncated" class="bash-tool-part__badge">已截断</span>
        <ChevronDown class="bash-tool-part__chevron" :size="16" aria-hidden="true" />
      </CollapsibleTrigger>

      <div class="bash-tool-part__actions">
        <BaseIconButton
          :label="copied ? '已复制命令' : '复制命令'"
          size="small"
          :disabled="!command"
          @click.stop="copyCommand"
        >
          <Check v-if="copied" :size="13" />
          <Clipboard v-else :size="13" />
        </BaseIconButton>
        <BaseIconButton
          v-if="fullOutputPath"
          label="显示完整输出"
          size="small"
          @click.stop="revealFullOutput"
        >
          <ExternalLink :size="13" />
        </BaseIconButton>
      </div>
    </header>

    <CollapsibleContent v-if="hasDetails" class="bash-tool-part__body">
      <ScrollArea scrollbars="both" class="bash-tool-part__scroll">
        <div v-if="cwd || timeout || parsedArgs.excludeFromContext" class="bash-tool-part__details">
          <span v-if="cwd" class="bash-tool-part__detail" :title="cwd">cwd {{ cwd }}</span>
          <span v-if="timeout" class="bash-tool-part__detail">timeout {{ timeout }}s</span>
          <span v-if="parsedArgs.excludeFromContext" class="bash-tool-part__detail">
            不加入上下文
          </span>
        </div>

        <div v-if="fullOutputPath || actionError" class="bash-tool-part__notice">
          <span v-if="fullOutputPath" class="bash-tool-part__path" :title="fullOutputPath">
            Full output: {{ fullOutputPath }}
          </span>
          <span v-if="actionError" class="bash-tool-part__error-text">{{ actionError }}</span>
        </div>

        <pre v-if="outputText" class="bash-tool-part__output"><code>{{ outputText }}</code></pre>
        <p v-if="visibleError" class="bash-tool-part__error-text">{{ error }}</p>
      </ScrollArea>
    </CollapsibleContent>
  </Collapsible>
</template>

<style lang="scss" scoped>
.base-tool-part.bash-tool-part {
  overflow: hidden;
  margin: 0;
  border-bottom: 1px solid var(--color-border-muted);
  color: var(--color-text);
  background: transparent;
}

.bash-tool-part__header {
  display: flex;
  align-items: stretch;
  min-width: 0;
  background: transparent;
  transition: background var(--duration-fast) var(--ease-standard);
}

.bash-tool-part__header:hover,
.bash-tool-part__header:focus-within {
  background: var(--color-surface-hover);
}

.bash-tool-part__summary {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  min-width: 0;
  gap: var(--space-1);
  min-height: 28px;
  padding: 2px var(--space-1);
  color: inherit;
  background: transparent;
  border: 0;
  text-align: left;
  cursor: pointer;
}

.bash-tool-part__icon {
  display: inline-grid;
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  place-items: center;
  color: var(--color-text-muted);
}

.bash-tool-part[data-bash-state='complete'] .bash-tool-part__icon {
  color: var(--color-text-subtle);
}

.bash-tool-part[data-bash-state='error'] .bash-tool-part__icon {
  color: var(--color-danger);
}

.bash-tool-part__spin {
  animation: bash-tool-part-spin 0.9s linear infinite;
}

.bash-tool-part__title {
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);
  font-weight: 700;
}

.bash-tool-part__command {
  overflow: hidden;
  flex: 1 1 auto;
  min-width: 40px;
  color: var(--color-text);
  background: transparent;
  font-family: var(--font-mono);
  font-size: var(--font-size-code);
  font-weight: var(--font-weight-code);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bash-tool-part__meta,
.bash-tool-part__badge,
.bash-tool-part__detail {
  flex: 0 0 auto;
  color: var(--color-text-subtle);
  font-size: var(--font-size-ui-xs);
  white-space: nowrap;
}

.bash-tool-part__badge {
  padding: 1px var(--space-1);
  border: 1px solid var(--color-warning, var(--color-border-strong));
  border-radius: var(--radius-sm);
  color: var(--color-warning, var(--color-text-muted));
}

.bash-tool-part__chevron {
  flex: 0 0 auto;
  color: var(--color-text-subtle);
  opacity: 0.72;
  transition: transform var(--duration-fast) var(--ease-standard);
}

.bash-tool-part__summary[data-state='open'] .bash-tool-part__chevron {
  transform: rotate(180deg);
}

.bash-tool-part__actions {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
  padding: 0 var(--space-1) 0 0;
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.bash-tool-part__body {
  overflow: hidden;
  margin-left: 23px;
  border-top: 1px solid var(--color-border-muted);
  border-left: 1px solid var(--color-border-muted);
  transform-origin: top;
}

.bash-tool-part__body[data-state='open'] {
  animation: bash-tool-part-content-open 160ms cubic-bezier(0.33, 0, 0.2, 1);
}

.bash-tool-part__body[data-state='closed'] {
  animation: bash-tool-part-content-close 160ms cubic-bezier(0.33, 0, 0.2, 1);
}

.bash-tool-part__scroll {
  width: 100%;
  min-width: 0;
  max-height: 240px;
}

.bash-tool-part__scroll :deep([data-slot='scroll-area-viewport']) {
  width: 100%;
  min-width: 0;
  max-height: 240px;
}

.bash-tool-part__scroll :deep([data-slot='scroll-area-viewport'] > div) {
  min-width: 100% !important;
}

.bash-tool-part__details,
.bash-tool-part__notice {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--color-border);
}

.bash-tool-part__detail,
.bash-tool-part__path {
  overflow: hidden;
  max-width: 100%;
  text-overflow: ellipsis;
}

.bash-tool-part__path {
  color: var(--color-text-subtle);
  font-family: var(--font-mono);
  font-size: var(--font-size-code);
  white-space: nowrap;
}

.bash-tool-part__output {
  width: max-content;
  min-width: 100%;
  margin: 0;
  padding: var(--space-3);
  color: var(--color-text);
  background: var(--color-canvas);
  font-family: var(--font-mono);
  font-size: var(--font-size-code);
  line-height: 1.5;
  white-space: pre;
}

.bash-tool-part__output + .bash-tool-part__output {
  border-top: 1px solid var(--color-border);
}

.bash-tool-part__error-text {
  padding: var(--space-1) var(--space-2);
  margin: 0;
  color: var(--color-danger);
  font-size: var(--font-size-ui-xs);
}

@keyframes bash-tool-part-content-open {
  from {
    height: 0;
    opacity: 0;
  }

  to {
    height: var(--reka-collapsible-content-height);
    opacity: 1;
  }
}

@keyframes bash-tool-part-content-close {
  from {
    height: var(--reka-collapsible-content-height);
    opacity: 1;
  }

  to {
    height: 0;
    opacity: 0;
  }
}

@keyframes bash-tool-part-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .bash-tool-part__body,
  .bash-tool-part__chevron,
  .bash-tool-part__spin {
    transition: none;
    animation: none;
  }
}

@media (hover: hover) and (pointer: fine) {
  .bash-tool-part__actions {
    opacity: 0;
  }

  .bash-tool-part__header:hover .bash-tool-part__actions,
  .bash-tool-part__header:focus-within .bash-tool-part__actions {
    opacity: 1;
  }
}
</style>
