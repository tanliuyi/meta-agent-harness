<script setup lang="ts">
import { computed, useSlots } from 'vue'
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
    errorText: 'true'
  }
)

const slots = useSlots()
const hasContent = computed(() =>
  Boolean(
    props.result || props.isError || slots.default || slots.content || slots.error || slots.result
  )
)
const contentStyle = computed(() => ({ maxHeight: props.maxContentHeight }))
</script>

<template>
  <Collapsible
    :default-open="defaultOpen"
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
    <CollapsibleTrigger class="tool-message__trigger">
      <slot
        name="header"
        :tool-name="name"
        :tool-summary="summary"
        :tool-status="status"
        :is-error="isError"
      >
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
      v-if="hasContent"
      class="tool-message__content"
      :class="contentClass"
      :style="contentStyle"
    >
      <ScrollArea v-if="scrollContent" style="height: 100%">
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
  flex: 1;
  min-width: 0;
  width: min(720px, 100%);
  border-radius: var(--radius-md);

  & :deep(.tool-message__content) {
    margin: 0;
    overflow: hidden;
    background: var(--color-canvas);
    border-radius: 0 0 var(--radius-md) var(--radius-md);

    .tool-message__result,
    .tool-message__content-inner {
      padding: var(--space-2);
    }

    pre {
      margin: 0;
      color: inherit;
      font-family: var(--font-mono);
      font-size: 11px;
      white-space: pre-wrap;
      word-break: break-word;
    }
  }

  &[data-state='open'] .tool-message__trigger {
    width: 100%;
    padding: var(--space-2);
    background: var(--color-canvas);
    border-bottom: 1px solid var(--color-border);
  }
}

.tool-message--compact {
  .tool-message__trigger {
    gap: var(--space-1);
  }

  &[data-state='open'] .tool-message__trigger {
    padding: var(--space-1) var(--space-2);
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

  &:focus-visible {
    outline: none;
    box-shadow: inset var(--shadow-focus);
  }

  &[data-state='open'] {
    border-bottom-right-radius: 0;
    border-bottom-left-radius: 0;
  }
}

.tool-message__name {
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font-size: 13px;
}

.tool-message__args,
.tool-message__meta {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-message__status {
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font-size: 11px;
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
  font-size: 12px;

  dt,
  dd {
    margin: 0;
  }
}
</style>
