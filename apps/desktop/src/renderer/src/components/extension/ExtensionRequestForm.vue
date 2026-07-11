<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { BaseButton } from '@renderer/components/base'
import type { ExtensionDialogRequest } from '@shared/coding-agent/types'

const props = withDefaults(
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

const rootRef = ref<HTMLElement>()

watch(
  () => props.request.id,
  async () => {
    await nextTick()
    rootRef.value?.querySelector<HTMLElement>('[data-extension-request-focus]')?.focus()
  },
  { immediate: true, flush: 'post' }
)

function updateDraft(event: Event): void {
  emit(
    'update:draft',
    props.request,
    (event.target as HTMLInputElement | HTMLTextAreaElement).value
  )
}

function submitDraft(event?: KeyboardEvent): void {
  if (event?.isComposing || props.responding) {
    return
  }
  event?.preventDefault()
  emit('submit', props.request, props.draft)
}

function cancel(): void {
  if (!props.responding) {
    emit('cancel', props.request)
  }
}

function handleOptionKeydown(event: KeyboardEvent, index: number): void {
  if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
    return
  }
  const options = Array.from(
    rootRef.value?.querySelectorAll<HTMLButtonElement>('[data-extension-request-option]') ?? []
  )
  if (!options.length) {
    return
  }
  event.preventDefault()
  const nextIndex =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : event.key === 'ArrowDown' || event.key === 'ArrowRight'
          ? (index + 1) % options.length
          : (index - 1 + options.length) % options.length
  options[nextIndex]?.focus()
}
</script>

<template>
  <div
    ref="rootRef"
    class="extension-request-form"
    :aria-busy="responding"
    @keydown.esc.stop.prevent="cancel"
  >
    <p v-if="request.type === 'confirm'" class="extension-request-form__message">
      {{ request.message }}
    </p>

    <div
      v-else-if="request.type === 'select'"
      class="extension-request-form__options"
      role="group"
      :aria-label="request.title"
    >
      <BaseButton
        v-for="(option, index) in request.options"
        :key="`${request.id}:${index}`"
        type="button"
        size="sm"
        variant="secondary"
        :disabled="responding"
        data-extension-request-option
        :data-extension-request-focus="index === 0 ? '' : undefined"
        @keydown="handleOptionKeydown($event, index)"
        @click="emit('submit', request, option)"
      >
        {{ option }}
      </BaseButton>
    </div>

    <input
      v-else-if="request.type === 'input'"
      :value="draft"
      class="extension-request-form__input"
      :placeholder="request.placeholder"
      :aria-label="request.title"
      :disabled="responding"
      data-extension-request-focus
      @input="updateDraft"
      @keydown.enter="submitDraft"
    />

    <textarea
      v-else-if="request.type === 'editor'"
      :value="draft"
      class="extension-request-form__editor"
      :aria-label="request.title"
      :disabled="responding"
      data-extension-request-focus
      @input="updateDraft"
      @keydown.meta.enter="submitDraft"
      @keydown.ctrl.enter="submitDraft"
    />

    <p v-if="error" class="extension-request-form__error" role="alert">{{ error }}</p>

    <div class="extension-request-form__actions">
      <BaseButton type="button" size="sm" variant="ghost" :disabled="responding" @click="cancel">
        取消
      </BaseButton>
      <BaseButton
        v-if="request.type === 'confirm'"
        type="button"
        size="sm"
        variant="primary"
        :disabled="responding"
        data-extension-request-focus
        @click="emit('submit', request, true)"
      >
        {{ responding ? '提交中' : '确认' }}
      </BaseButton>
      <BaseButton
        v-else-if="request.type !== 'select'"
        type="button"
        size="sm"
        variant="primary"
        :disabled="responding"
        @click="submitDraft()"
      >
        {{ responding ? '提交中' : '提交' }}
      </BaseButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
.extension-request-form {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.extension-request-form__message,
.extension-request-form__error {
  margin: 0;
  font-size: var(--font-size-ui-sm);
  line-height: 1.45;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.extension-request-form__message {
  color: var(--color-text-muted);
}

.extension-request-form__error {
  color: var(--color-danger);
}

.extension-request-form__options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  max-height: min(240px, 32vh);
  min-width: 0;
  padding: 1px;
  overflow: auto;
}

.extension-request-form__input,
.extension-request-form__editor {
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

  &:disabled {
    cursor: wait;
    opacity: 0.68;
  }
}

.extension-request-form__input {
  height: 34px;
  padding: 0 var(--space-2);
}

.extension-request-form__editor {
  min-height: 104px;
  max-height: min(320px, 38vh);
  padding: var(--space-2);
  resize: vertical;
  line-height: 1.45;
}

.extension-request-form__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-1);
  min-width: 0;
  padding-top: var(--space-1);
}
</style>
