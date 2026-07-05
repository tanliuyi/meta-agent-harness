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

const slots = useSlots()
const inferredHasContent = computed(() =>
  Boolean(
    props.result || props.isError || slots.default || slots.content || slots.error || slots.result
  )
)
const hasContent = computed(() => props.contentAvailable ?? inferredHasContent.value)
const contentStyle = computed(() => ({ maxHeight: props.maxContentHeight }))
const open = ref(false)
const collapsibleOpen = computed({
  get: () => hasContent.value && open.value,
  set: (value: boolean) => {
    open.value = hasContent.value && value
  }
})

watch(
  [() => props.defaultOpen, hasContent],
  ([defaultOpen, contentReady]) => {
    if (!contentReady) {
      open.value = false
      return
    }
    if (defaultOpen) {
      open.value = true
    }
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

    <CollapsibleContent
      v-if="collapsibleOpen"
      class="tool-message__content"
      :class="contentClass"
      :style="contentStyle"
    >
      <ScrollArea v-if="scrollContent" scrollbars="both" class="tool-message__scroll">
        <slot name="content" :tool-result="result" :tool-status="status" :is-error="isError">
          <slot>
            <div v-if="result || $slots.result" class="tool-message__result" :class="resultClass">
              <slot name="result" :tool-result="result">
                <pre><code>{{ result }}</code></pre>
              </slot>
            </div>
            <dl v-if="isError || $slots.error" class="tool-message__error">
              <slot name="error" :is-error="isError">
                <dt>{{ errorLabel }}</dt>
                <dd>{{ errorText }}</dd>
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
            <dl v-if="isError || $slots.error" class="tool-message__error">
              <slot name="error" :is-error="isError">
                <dt>{{ errorLabel }}</dt>
                <dd>{{ errorText }}</dd>
              </slot>
            </dl>
          </slot>
        </slot>
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>

<style lang="scss" scoped>
.tool-message {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  flex: 1;
  min-width: 0;
  width: min(720px, 100%);
  border-radius: var(--radius-lg);

  & :deep(.tool-message__content) {
    margin: 0;
    overflow: hidden;
    background: var(--color-code-bg);
    border-radius: var(--radius-sm);

    pre {
      margin: 0;
      color: inherit;
      font-family: var(--font-mono);
      font-size: var(--font-size-code);
      font-weight: var(--font-weight-code);
      min-width: 100%;
      width: max-content;
      white-space: pre;
      word-break: normal;
    }
  }

  &[data-state='open'] .tool-message__trigger {
    width: 100%;
    // padding: var(--space-2);
    background: var(--color-canvas);
  }
}

:deep(.tool-message__content) {
  display: flex;
  flex-direction: column;
  max-width: 100%;
  min-height: 0;
}

:deep(.tool-message__scroll) {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  padding: var(--space-2);
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
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui);
}

.tool-message__args,
.tool-message__meta {
  flex: 1;
  min-width: 0;
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
</style>
