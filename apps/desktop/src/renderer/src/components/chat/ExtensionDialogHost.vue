<script setup lang="ts">
import { ref, watch } from 'vue'
import { BaseButton } from '@renderer/components/base'
import type { ExtensionDialogRequest } from '@shared/coding-agent/types'

const props = defineProps<{
  request: ExtensionDialogRequest
}>()

const emit = defineEmits<{
  submit: [request: ExtensionDialogRequest, value: string | boolean]
  cancel: [request: ExtensionDialogRequest]
}>()

const draft = ref('')

watch(
  () => props.request,
  (request) => {
    draft.value = request.type === 'editor' ? (request.prefill ?? '') : ''
  },
  { immediate: true }
)

function submitDraft(): void {
  emit('submit', props.request, draft.value)
}
</script>

<template>
  <section
    class="extension-dialog-host"
    role="group"
    :aria-labelledby="`extension-dialog-title-${request.id}`"
    @keydown.esc.stop.prevent="emit('cancel', request)"
  >
    <header class="extension-dialog-host__header">
      <div>
        <strong :id="`extension-dialog-title-${request.id}`">{{ request.title }}</strong>
        <span>{{ request.type }}</span>
      </div>
      <BaseButton type="button" size="sm" variant="ghost" @click="emit('cancel', request)">
        取消
      </BaseButton>
    </header>

    <div class="extension-dialog-host__body">
      <p v-if="request.type === 'confirm'" class="extension-dialog-host__message">
        {{ request.message }}
      </p>

      <div v-else-if="request.type === 'select'" class="extension-dialog-host__options">
        <BaseButton
          v-for="option in request.options"
          :key="option"
          type="button"
          size="sm"
          variant="secondary"
          @click="emit('submit', request, option)"
        >
          {{ option }}
        </BaseButton>
      </div>

      <input
        v-else-if="request.type === 'input'"
        v-model="draft"
        class="extension-dialog-host__input"
        :placeholder="request.placeholder"
        :aria-label="request.title"
        @keydown.enter.prevent="submitDraft"
      />

      <textarea
        v-else-if="request.type === 'editor'"
        v-model="draft"
        class="extension-dialog-host__editor"
        :aria-label="request.title"
      />
    </div>

    <div v-if="request.type !== 'select'" class="extension-dialog-host__actions">
      <BaseButton
        v-if="request.type === 'confirm'"
        type="button"
        size="sm"
        variant="primary"
        @click="emit('submit', request, true)"
      >
        确认
      </BaseButton>
      <BaseButton v-else type="button" size="sm" variant="primary" @click="submitDraft">
        提交
      </BaseButton>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.extension-dialog-host {
  box-sizing: border-box;
  display: grid;
  grid-template-rows: auto auto auto;
  gap: var(--space-3);
  width: 100%;
  min-width: 0;
  min-height: 0;
  padding: var(--space-4);
  overflow: visible;
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
  gap: var(--space-2);
  min-width: 0;
  padding-bottom: var(--space-2);
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 72%, transparent);

  > div {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: var(--color-text);
    font-size: var(--font-size-ui-sm);
    font-weight: 700;
  }

  span {
    flex: 0 0 auto;
    padding: 2px 6px;
    color: var(--color-text-muted);
    background: color-mix(in srgb, var(--color-canvas) 72%, transparent);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-ui-2xs);
    font-weight: 650;
    line-height: 1.2;
    text-transform: uppercase;
  }
}

.extension-dialog-host__body {
  display: grid;
  align-content: start;
  gap: var(--space-3);
  min-width: 0;
  min-height: 0;
  overflow: visible;
}

.extension-dialog-host__message {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-sm);
  line-height: 1.45;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.extension-dialog-host__options,
.extension-dialog-host__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  min-width: 0;
}

.extension-dialog-host__actions {
  justify-content: flex-end;
  padding-top: var(--space-1);
}

.extension-dialog-host__input,
.extension-dialog-host__editor {
  width: 100%;
  min-width: 0;
  color: var(--color-text);
  background: color-mix(in srgb, var(--color-canvas) 88%, transparent);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font: inherit;
  font-size: var(--font-size-ui-sm);
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard);

  &:focus {
    outline: none;
    background: var(--color-canvas);
    border-color: color-mix(in srgb, var(--color-primary) 55%, var(--color-border));
    box-shadow: var(--shadow-focus);
  }
}

.extension-dialog-host__input {
  height: 34px;
  padding: 0 var(--space-2);
}

.extension-dialog-host__editor {
  min-height: 92px;
  padding: var(--space-2);
  resize: vertical;
  line-height: 1.45;
}
</style>
