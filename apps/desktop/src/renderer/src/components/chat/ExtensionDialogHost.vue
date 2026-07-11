<script setup lang="ts">
import ExtensionRequestForm from '@renderer/components/extension/ExtensionRequestForm.vue'
import type { ExtensionDialogRequest } from '@shared/coding-agent/types'

withDefaults(
  defineProps<{
    request: ExtensionDialogRequest
    draft?: string
    responding?: boolean
    error?: string
  }>(),
  {
    draft: '',
    responding: false,
    error: undefined
  }
)

const emit = defineEmits<{
  submit: [request: ExtensionDialogRequest, value: string | boolean]
  cancel: [request: ExtensionDialogRequest]
  'update:draft': [request: ExtensionDialogRequest, value: string]
}>()

function forwardSubmit(request: ExtensionDialogRequest, value: string | boolean): void {
  emit('submit', request, value)
}

function forwardDraft(request: ExtensionDialogRequest, value: string): void {
  emit('update:draft', request, value)
}
</script>

<template>
  <section
    class="extension-dialog-host"
    role="dialog"
    :aria-labelledby="`extension-dialog-title-${request.id}`"
  >
    <header class="extension-dialog-host__header">
      <strong :id="`extension-dialog-title-${request.id}`">{{ request.title }}</strong>
    </header>

    <ExtensionRequestForm
      :request="request"
      :draft="draft"
      :responding="responding"
      :error="error"
      @submit="forwardSubmit"
      @cancel="emit('cancel', $event)"
      @update:draft="forwardDraft"
    />
  </section>
</template>

<style lang="scss" scoped>
.extension-dialog-host {
  box-sizing: border-box;
  display: grid;
  gap: var(--space-3);
  width: 100%;
  min-width: 0;
  min-height: 0;
  max-height: min(520px, calc(100vh - 96px));
  padding: var(--space-4);
  overflow: auto;
  color: var(--color-text);
  background: color-mix(in srgb, var(--color-surface-raised) 98%, var(--color-canvas));
  border: 1px solid color-mix(in srgb, var(--color-primary) 42%, var(--color-border));
  border-radius: var(--radius-lg);
  box-shadow:
    var(--shadow-md),
    0 18px 48px color-mix(in srgb, var(--color-canvas) 36%, transparent);
  pointer-events: auto;
  backdrop-filter: blur(18px);
}

.extension-dialog-host__header {
  display: flex;
  align-items: center;
  min-width: 0;
  padding-bottom: var(--space-2);
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 72%, transparent);

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--color-text);
    font-size: var(--font-size-ui-sm);
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
