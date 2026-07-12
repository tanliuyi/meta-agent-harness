<script setup lang="ts">
import { computed, ref, useSlots, watch } from 'vue'
import ToolIcon from '@renderer/components/icons/ToolIcon.vue'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'

type ToolTone = 'default' | 'muted' | 'danger'
type ToolStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

const props = withDefaults(
  defineProps<{
    name: string
    summary?: string
    result?: string
    status?: ToolStatus
    isError?: boolean
    defaultOpen?: boolean
    open?: boolean
    tone?: ToolTone
    compact?: boolean
    showStatus?: boolean
    scrollContent?: boolean
    maxContentHeight?: string
    contentClass?: string
    resultClass?: string
    errorLabel?: string
    errorText?: string
    contentAvailable?: boolean
  }>(),
  {
    summary: '',
    result: undefined,
    status: undefined,
    isError: false,
    defaultOpen: false,
    open: undefined,
    tone: 'default',
    compact: false,
    showStatus: false,
    scrollContent: true,
    maxContentHeight: '240px',
    contentClass: '',
    resultClass: '',
    errorLabel: 'error',
    errorText: 'true',
    contentAvailable: undefined
  }
)

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const slots = useSlots()
const inferredHasContent = computed(() =>
  Boolean(
    props.result || props.isError || slots.default || slots.content || slots.error || slots.result
  )
)
const hasContent = computed(() => props.contentAvailable ?? inferredHasContent.value)
const contentStyle = computed(() => ({ maxHeight: props.maxContentHeight }))
const localOpen = ref(props.defaultOpen)
const collapsibleOpen = computed({
  get: () => hasContent.value && (props.open ?? localOpen.value),
  set: (value: boolean) => {
    const nextOpen = hasContent.value && value
    if (props.open === undefined) {
      localOpen.value = nextOpen
    }
    emit('update:open', nextOpen)
  }
})

watch(
  [() => props.defaultOpen, hasContent],
  ([defaultOpen, contentReady]) => {
    if (props.open !== undefined) {
      return
    }
    if (!contentReady) {
      localOpen.value = false
      return
    }
    if (defaultOpen) {
      localOpen.value = true
      return
    }
    localOpen.value = false
  },
  { immediate: true }
)
</script>

<template>
  <Collapsible
    v-model:open="collapsibleOpen"
    class="tool-message"
    :class="[
      `tool-message--${tone}`,
      {
        'tool-message--compact': compact,
        'tool-message--error': isError
      }
    ]"
    :data-status="status"
  >
    <CollapsibleTrigger
      class="tool-message__trigger"
      :disabled="!hasContent"
      :data-clickable="hasContent"
    >
      <slot
        name="header"
        :tool-name="name"
        :tool-summary="summary"
        :tool-status="status"
        :is-error="isError"
      >
        <span class="tool-message__icon">
          <slot name="icon"><ToolIcon :size="14" /></slot>
        </span>
        <span class="tool-message__name">
          <slot name="name" :tool-name="name">{{ name }}</slot>
        </span>
        <span v-if="summary || $slots.summary" class="tool-message__args">
          <slot name="summary" :tool-summary="summary">{{ summary }}</slot>
        </span>
        <span v-if="showStatus && status" class="tool-message__status">
          <slot name="status" :tool-status="status">{{ status }}</slot>
        </span>
        <span v-if="$slots.meta" class="tool-message__meta">
          <slot name="meta" :tool-status="status" :is-error="isError" />
        </span>
        <span v-if="$slots.actions" class="tool-message__actions">
          <slot name="actions" />
        </span>
      </slot>
    </CollapsibleTrigger>

    <CollapsibleContent class="tool-message__content" :class="contentClass">
      <div class="tool-message__clip" :style="contentStyle">
        <ScrollArea v-if="scrollContent" scrollbars="both" class="tool-message__scroll">
          <slot name="content" :tool-result="result" :tool-status="status" :is-error="isError">
            <slot>
              <div v-if="result || $slots.result" class="tool-message__result" :class="resultClass">
                <slot name="result" :tool-result="result">
                  <pre><code>{{ result }}</code></pre>
                </slot>
              </div>
              <dl v-if="$slots.error || (isError && !result)" class="tool-message__error">
                <slot name="error" :is-error="isError">
                  <dt>{{ errorLabel }}</dt>
                  <dd v-if="errorText">{{ errorText }}</dd>
                </slot>
              </dl>
            </slot>
          </slot>
        </ScrollArea>

        <div v-else class="tool-message__content-inner">
          <slot name="content" :tool-result="result" :tool-status="status" :is-error="isError">
            <slot>
              <div v-if="result || $slots.result" class="tool-message__result" :class="resultClass">
                <slot name="result" :tool-result="result">
                  <pre><code>{{ result }}</code></pre>
                </slot>
              </div>
              <dl v-if="$slots.error || (isError && !result)" class="tool-message__error">
                <slot name="error" :is-error="isError">
                  <dt>{{ errorLabel }}</dt>
                  <dd v-if="errorText">{{ errorText }}</dd>
                </slot>
              </dl>
            </slot>
          </slot>
        </div>
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>

<style lang="scss" scoped>
.tool-message {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  width: min(720px, 100%);
  border-radius: var(--radius-lg);

  & :deep(.tool-message__content) {
    margin: 0;
    overflow: hidden;
    background: transparent;
    border-radius: var(--radius-sm);

    pre {
      margin: 0;
      color: inherit;
      font-family: var(--font-mono) !important;
      font-size: var(--font-size-code);
      font-weight: var(--font-weight-code);
      line-height: var(--markdown-code-line-height);
      min-width: 100%;
      width: max-content;
      white-space: pre;
      word-break: normal;

      code {
        font-family: inherit;
        font-size: inherit;
        font-weight: inherit;
      }
    }
  }

  &[data-state='open'] .tool-message__trigger {
    width: fit-content;
    // padding: var(--space-2);
    // background: var(--color-canvas);
  }
}

:deep(.tool-message__content) {
  display: grid;
  grid-template-rows: 0fr;
  max-width: 100%;
  min-height: 0;
  margin-top: 0;
  transform-origin: top;

  &[data-state='open'] {
    grid-template-rows: 1fr;
    animation: tool-message-content-open 160ms cubic-bezier(0.33, 0, 0.2, 1);
  }

  &[data-state='closed'] {
    animation: tool-message-content-close 160ms cubic-bezier(0.33, 0, 0.2, 1);
  }
}

.tool-message__clip {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

:deep(.tool-message__scroll),
.tool-message__content-inner {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  margin-top: var(--space-1);
  padding: var(--space-2);
  overflow: hidden;
  background: var(--color-code-bg);
  border-radius: var(--radius-sm);
}

:deep(.tool-message__scroll [data-slot='scroll-area-viewport']) {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
}

.tool-message--compact {
  .tool-message__trigger {
    gap: var(--space-1);
  }

  &[data-state='open'] .tool-message__trigger {
    padding: var(--space-1) 0;
  }
}

.tool-message--muted {
  color: var(--color-text-muted);
}

.tool-message--danger,
.tool-message--error {
  .tool-message__name,
  .tool-message__status {
    color: var(--color-danger);
  }
}

.tool-message[data-status='queued'],
.tool-message[data-status='running'] {
  &:not(.tool-message--error) {
    .tool-message__name::after,
    .tool-message__status::after {
      content: '';
      position: absolute;
      inset: -1px 0;
      pointer-events: none;
      animation: tool-message-text-shimmer 1.8s linear infinite;
      background: repeating-linear-gradient(
        110deg,
        transparent 0,
        transparent 48px,
        color-mix(in srgb, var(--color-info) 6%, transparent) 64px,
        color-mix(in srgb, var(--color-info) 20%, transparent) 78px,
        color-mix(in srgb, var(--color-text) 16%, transparent) 88px,
        color-mix(in srgb, var(--color-info) 10%, transparent) 100px,
        transparent 118px,
        transparent 220px
      );
      background-size: 220px 100%;
      filter: blur(0.8px);
      mask-image:
        linear-gradient(to right, transparent 0%, #000 12%, #000 88%, transparent 100%),
        linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%);
      mask-composite: intersect;
      opacity: 0.38;
    }
  }
}

.tool-message__trigger {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--space-2);
  max-width: 100%;
  width: fit-content;
  padding: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: inherit;
  cursor: pointer;

  &:hover {
    color: var(--color-hover);
  }

  &:disabled {
    cursor: default;
  }

  &:disabled:hover {
    color: inherit;
  }

  &:focus-visible {
    outline: none;
    box-shadow: inset var(--shadow-focus);
  }

  &[data-state='open'] {
    border-bottom-right-radius: 0;
    border-bottom-left-radius: 0;
  }
}

.tool-message__icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
}

.tool-message__name {
  position: relative;
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui);
}

.tool-message__args,
.tool-message__meta {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-message__args {
  color: var(--color-text-subtle);
  font-family: var(--font-sans);
  font-size: var(--font-size-ui);
}

.tool-message__status {
  position: relative;
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);
}

.tool-message__actions {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-1);
}

.tool-message__error {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-1) var(--space-2);
  margin: 0;
  padding: 0 var(--space-2) var(--space-2);
  color: var(--color-danger);
  font-size: var(--font-size-ui-sm);

  dt,
  dd {
    margin: 0;
  }
}

@keyframes tool-message-content-open {
  from {
    grid-template-rows: 0fr;
    opacity: 0.6;
  }

  to {
    grid-template-rows: 1fr;
    opacity: 1;
  }
}

@keyframes tool-message-content-close {
  from {
    grid-template-rows: 1fr;
    opacity: 1;
  }

  to {
    grid-template-rows: 0fr;
    opacity: 0.6;
  }
}

@keyframes tool-message-text-shimmer {
  from {
    background-position: -220px 0;
  }

  to {
    background-position: 0 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  :deep(.tool-message__content) {
    animation: none;
  }

  .tool-message[data-status='queued'],
  .tool-message[data-status='running'] {
    .tool-message__name::after,
    .tool-message__status::after {
      animation: none;
      background: none;
    }
  }
}
</style>
