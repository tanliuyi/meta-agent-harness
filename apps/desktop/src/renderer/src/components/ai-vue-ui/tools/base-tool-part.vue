<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clipboard,
  LoaderCircle,
  Wrench
} from 'lucide-vue-next'
import { BaseIconButton } from '@renderer/components/base'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'
import { parseMaybeJson, readString, toRecord, type ToolState } from './tool-part-support'

const props = withDefaults(
  defineProps<{
    label: string
    summary?: string
    meta?: string[]
    output: unknown
    state?: string
    error?: boolean
    copyLabel?: string
  }>(),
  {
    meta: () => [],
    copyLabel: '复制结果'
  }
)

const open = ref(false)
const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | undefined

const outputValue = computed(() => parseMaybeJson(props.output))
const outputRecord = computed(() => toRecord(outputValue.value))
const contentItems = computed(() => readContentItems(outputRecord.value?.content))
const textOutput = computed(() => extractTextOutput(outputValue.value, contentItems.value))
const imageOutput = computed(() => contentItems.value.find((item) => item.type === 'image'))
const details = computed(() => outputRecord.value?.details)
const detailsText = computed(() => formatDetails(details.value))
const errorText = computed(() => readString(outputRecord.value?.error))
const normalizedState = computed<ToolState>(() => {
  if (props.error || props.state === 'error' || props.state === 'output-error' || errorText.value)
    return 'error'
  if (props.state === 'complete' || props.state === 'output-available') return 'complete'
  if (props.state === 'input-streaming' || props.state === 'input-available') return 'running'
  if (props.output !== undefined) return 'complete'
  return 'running'
})
const isError = computed(() => normalizedState.value === 'error')
const hasDetails = computed(() =>
  Boolean(textOutput.value || imageOutput.value || errorText.value || detailsText.value)
)
const copyText = computed(() => textOutput.value || detailsText.value || '')

async function copyResult(): Promise<void> {
  if (!copyText.value) return
  await navigator.clipboard.writeText(copyText.value)
  copied.value = true
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copied.value = false
    copyTimer = undefined
  }, 1400)
}

function readContentItems(
  value: unknown
): Array<{ type: string; text?: string; data?: string; mimeType?: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const record = toRecord(item)
    if (!record || typeof record.type !== 'string') return []
    return [
      {
        type: record.type,
        text: readString(record.text),
        data: readString(record.data),
        mimeType: readString(record.mimeType)
      }
    ]
  })
}

function extractTextOutput(
  value: unknown,
  items: Array<{ type: string; text?: string }>
): string | undefined {
  if (typeof value === 'string') return value
  const itemText = items
    .filter((item) => item.type === 'text' && item.text)
    .map((item) => item.text)
    .join('\n')
  if (itemText) return itemText
  const record = toRecord(value)
  return readString(record?.output) ?? readString(record?.text) ?? readString(record?.message)
}

function formatDetails(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}
</script>

<template>
  <Collapsible v-model:open="open" class="base-tool-part" :data-tool-state="normalizedState">
    <header class="base-tool-part__header">
      <CollapsibleTrigger class="base-tool-part__summary" :disabled="!hasDetails">
        <span class="base-tool-part__icon" aria-hidden="true">
          <LoaderCircle
            v-if="normalizedState === 'running'"
            :size="15"
            class="base-tool-part__spin"
          />
          <CircleAlert v-else-if="isError" :size="15" />
          <CircleCheck v-else-if="normalizedState === 'complete'" :size="15" />
          <slot v-else name="icon"><Wrench :size="15" /></slot>
        </span>
        <span class="base-tool-part__label">{{ label }}</span>
        <code v-if="summary" class="base-tool-part__summary-text" :title="summary">{{
          summary
        }}</code>
        <span v-for="item in meta" :key="item" class="base-tool-part__meta">{{ item }}</span>
        <ChevronDown class="base-tool-part__chevron" :size="16" aria-hidden="true" />
      </CollapsibleTrigger>

      <div class="base-tool-part__actions">
        <BaseIconButton
          :label="copied ? '已复制结果' : copyLabel"
          size="small"
          :disabled="!copyText"
          @click.stop="copyResult"
        >
          <Check v-if="copied" :size="13" />
          <Clipboard v-else :size="13" />
        </BaseIconButton>
        <slot name="actions" />
      </div>
    </header>

    <CollapsibleContent v-if="hasDetails" class="base-tool-part__body">
      <ScrollArea scrollbars="both" class="base-tool-part__scroll">
        <slot name="before-content" />
        <img
          v-if="imageOutput?.data && imageOutput.mimeType"
          class="base-tool-part__image"
          :src="`data:${imageOutput.mimeType};base64,${imageOutput.data}`"
          alt="Tool result image"
        />
        <pre v-if="textOutput" class="base-tool-part__output"><code>{{ textOutput }}</code></pre>
        <p v-if="errorText && !textOutput" class="base-tool-part__error">{{ errorText }}</p>
        <details v-if="detailsText" class="base-tool-part__details">
          <summary>details</summary>
          <pre><code>{{ detailsText }}</code></pre>
        </details>
      </ScrollArea>
    </CollapsibleContent>
  </Collapsible>
</template>

<style lang="scss" scoped>
.base-tool-part {
  overflow: hidden;
  margin: 0;
  border-bottom: 1px solid var(--color-border-muted);
  color: var(--color-text);
  background: transparent;
}

.base-tool-part__header {
  display: flex;
  align-items: stretch;
  min-width: 0;
  background: transparent;
  transition: background var(--duration-fast) var(--ease-standard);
}

.base-tool-part__header:hover,
.base-tool-part__header:focus-within {
  background: var(--color-surface-hover);
}

.base-tool-part__summary {
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

.base-tool-part__summary:disabled {
  cursor: default;
}

.base-tool-part__icon {
  display: inline-grid;
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  place-items: center;
  color: var(--color-text-muted);
}

.base-tool-part[data-tool-state='complete'] .base-tool-part__icon {
  color: var(--color-text-subtle);
}

.base-tool-part[data-tool-state='error'] .base-tool-part__icon {
  color: var(--color-danger);
}

.base-tool-part__spin {
  animation: base-tool-part-spin 0.9s linear infinite;
}

.base-tool-part__label {
  flex: 0 0 auto;
  color: var(--color-text-subtle);
  font-size: var(--font-size-ui-xs);
  font-weight: 600;
}

.base-tool-part__summary-text {
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

.base-tool-part__meta {
  flex: 0 0 auto;
  color: var(--color-text-subtle);
  font-size: var(--font-size-ui-xs);
  white-space: nowrap;
}

.base-tool-part__chevron {
  flex: 0 0 auto;
  color: var(--color-text-subtle);
  opacity: 0.72;
  transition: transform var(--duration-fast) var(--ease-standard);
}

.base-tool-part__summary[data-state='open'] .base-tool-part__chevron {
  transform: rotate(180deg);
}

.base-tool-part__actions {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
  padding: 0 var(--space-1) 0 0;
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.base-tool-part__body {
  overflow: hidden;
  margin-left: 23px;
  border-top: 1px solid var(--color-border-muted);
  border-left: 1px solid var(--color-border-muted);
  transform-origin: top;
}

.base-tool-part__body[data-state='open'] {
  animation: base-tool-part-content-open 160ms cubic-bezier(0.33, 0, 0.2, 1);
}

.base-tool-part__body[data-state='closed'] {
  animation: base-tool-part-content-close 160ms cubic-bezier(0.33, 0, 0.2, 1);
}

.base-tool-part__scroll {
  width: 100%;
  min-width: 0;
  max-height: 260px;
}

.base-tool-part__scroll :deep([data-slot='scroll-area-viewport']) {
  width: 100%;
  min-width: 0;
  max-height: 260px;
}

.base-tool-part__scroll :deep([data-slot='scroll-area-viewport'] > div) {
  min-width: 100% !important;
}

.base-tool-part__output,
.base-tool-part__details pre {
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

.base-tool-part__image {
  display: block;
  max-width: 100%;
  max-height: 220px;
  margin: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.base-tool-part__error {
  padding: var(--space-2);
  margin: 0;
  color: var(--color-danger);
  font-size: var(--font-size-ui-xs);
}

.base-tool-part__details {
  border-top: 1px solid var(--color-border);
}

.base-tool-part__details summary {
  padding: var(--space-1) var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);
  cursor: pointer;
}

@keyframes base-tool-part-content-open {
  from {
    height: 0;
    opacity: 0;
  }

  to {
    height: var(--reka-collapsible-content-height);
    opacity: 1;
  }
}

@keyframes base-tool-part-content-close {
  from {
    height: var(--reka-collapsible-content-height);
    opacity: 1;
  }

  to {
    height: 0;
    opacity: 0;
  }
}

@keyframes base-tool-part-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .base-tool-part__body,
  .base-tool-part__chevron,
  .base-tool-part__spin {
    transition: none;
    animation: none;
  }
}

@media (hover: hover) and (pointer: fine) {
  .base-tool-part__actions {
    opacity: 0;
  }

  .base-tool-part__header:hover .base-tool-part__actions,
  .base-tool-part__header:focus-within .base-tool-part__actions {
    opacity: 1;
  }
}
</style>
