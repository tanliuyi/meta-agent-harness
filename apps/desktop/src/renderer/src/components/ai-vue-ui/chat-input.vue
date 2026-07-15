<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from 'vue'
import { LoaderCircle, SendHorizontal } from '@lucide/vue'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger
} from '@/components/ui/select'
import { useChatContext } from './use-chat-context'
import type { ChatInputProps, ChatInputRenderProps, ChatSlotContent } from './types'
import type { ThinkingLevel } from '@shared/coding-agent/types'
import BaseIconButton from '../base/BaseIconButton.vue'

const props = withDefaults(defineProps<ChatInputProps>(), {
  placeholder: '输入消息...',
  submitOnEnter: true,
  showProjectSelect: false,
  projectOptions: () => [],
  loadingProjects: false,
  modelOptions: () => [],
  loadingModelOptions: false,
  thinkingLevel: 'medium',
  controlsDisabled: false
})

const emit = defineEmits<{
  /** Emitted when the message is submitted */
  submit: [value: string]
  selectProject: [projectId: string]
  selectModel: [provider: string, modelId: string]
  selectThinkingLevel: [level: ThinkingLevel]
}>()

defineSlots<{
  default?: (props: ChatInputRenderProps) => ChatSlotContent
}>()

// v-model support - defaults to empty string if not provided
const modelValue = defineModel<string>({ default: '' })

const { sendMessage, isLoading, sessionGenerating } = useChatContext()
const textareaRef = useTemplateRef('textareaRef')

const disabled = computed(() => props.disabled || isLoading.value)
const canSubmit = computed(() => !disabled.value && modelValue.value.trim().length > 0)
const controlsDisabled = computed(
  () => props.controlsDisabled || isLoading.value || sessionGenerating.value
)
const projectSelectDisabled = computed(() => isLoading.value || sessionGenerating.value)
const currentProjectLabel = computed(
  () =>
    props.projectOptions.find((project) => project.projectId === props.selectedProjectId)?.name ??
    (props.loadingProjects ? '加载项目...' : '选择 Project')
)
const currentModelValue = computed(() =>
  props.selectedModel ? createModelValue(props.selectedModel.provider, props.selectedModel.id) : ''
)
const currentModelLabel = computed(() => {
  if (props.loadingModelOptions) return '加载模型...'
  if (!props.selectedModel) return '选择模型'
  const option = props.modelOptions.find(
    (item) => item.provider === props.selectedModel?.provider && item.id === props.selectedModel?.id
  )
  return option?.displayName || `${props.selectedModel.provider}/${props.selectedModel.id}`
})
const thinkingOptions: Array<{ label: string; value: ThinkingLevel }> = [
  { label: '关闭', value: 'off' },
  { label: '最低', value: 'minimal' },
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
  { label: '最高', value: 'xhigh' }
]
const currentThinkingLabel = computed(
  () => thinkingOptions.find((option) => option.value === props.thinkingLevel)?.label ?? '中'
)

const handleSubmit = (): void => {
  if (!canSubmit.value) return
  sendMessage(modelValue.value)
  emit('submit', modelValue.value)
  modelValue.value = ''
  void nextTick(resizeTextarea)
}

const handleKeyDown = (e: KeyboardEvent): void => {
  if (props.submitOnEnter && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    handleSubmit()
  }
}

function resizeTextarea(): void {
  const textarea = textareaRef.value
  if (!textarea) return
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(textarea.scrollHeight, 168)}px`
}

function createModelValue(provider: string, modelId: string): string {
  return JSON.stringify([provider, modelId])
}

function handleProjectChange(value: unknown): void {
  if (
    typeof value !== 'string' ||
    !value ||
    value === props.selectedProjectId ||
    !props.projectOptions.some((project) => project.projectId === value && !project.disabled)
  ) {
    return
  }
  emit('selectProject', value)
}

function handleModelChange(value: unknown): void {
  if (typeof value !== 'string' || !value || value === currentModelValue.value) return
  try {
    const parsed = JSON.parse(value) as unknown
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string'
    ) {
      emit('selectModel', parsed[0], parsed[1])
    }
  } catch {
    // Ignore malformed values that did not originate from the model options.
  }
}

function handleThinkingLevelChange(value: unknown): void {
  if (!thinkingOptions.some((option) => option.value === value) || value === props.thinkingLevel) {
    return
  }
  emit('selectThinkingLevel', value as ThinkingLevel)
}

watch(modelValue, () => void nextTick(resizeTextarea), { immediate: true })

const slotProps = computed<ChatInputRenderProps>(() => ({
  value: modelValue.value,
  onSubmit: handleSubmit,
  isLoading: isLoading.value,
  disabled: disabled.value
}))
</script>

<template>
  <slot v-if="$slots['default']" v-bind="slotProps" />

  <form
    v-else
    :class="props.class"
    class="chat-input"
    data-chat-input
    @submit.prevent="handleSubmit"
  >
    <textarea
      ref="textareaRef"
      v-model="modelValue"
      rows="1"
      :placeholder="placeholder"
      :disabled="disabled"
      aria-label="消息"
      data-chat-textarea
      @keydown="handleKeyDown"
      @input="resizeTextarea"
    />

    <div class="chat-input__actions">
      <div class="chat-input__controls">
        <Select
          v-if="showProjectSelect"
          :model-value="selectedProjectId ?? ''"
          :disabled="projectSelectDisabled || loadingProjects || projectOptions.length === 0"
          @update:model-value="handleProjectChange"
        >
          <SelectTrigger
            class="chat-input__select chat-input__project-select"
            size="sm"
            variant="borderless"
            aria-label="选择 Project"
            hide-icon
          >
            <span class="chat-input__select-label">{{ currentProjectLabel }}</span>
          </SelectTrigger>
          <SelectContent class="chat-input__project-content">
            <SelectGroup>
              <SelectItem
                v-for="project in projectOptions"
                :key="project.projectId"
                :value="project.projectId"
                :disabled="project.disabled"
              >
                {{ project.name }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          :model-value="currentModelValue"
          :disabled="controlsDisabled || loadingModelOptions || modelOptions.length === 0"
          @update:model-value="handleModelChange"
        >
          <SelectTrigger
            class="chat-input__select chat-input__model-select"
            size="sm"
            variant="borderless"
            aria-label="选择模型"
            hide-icon
          >
            <span class="chat-input__select-label">{{ currentModelLabel }}</span>
          </SelectTrigger>
          <SelectContent class="chat-input__model-content">
            <SelectGroup>
              <SelectItem
                v-for="model in modelOptions"
                :key="createModelValue(model.provider, model.id)"
                :value="createModelValue(model.provider, model.id)"
              >
                {{ model.displayName || `${model.provider}/${model.id}` }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          :model-value="thinkingLevel"
          :disabled="controlsDisabled"
          @update:model-value="handleThinkingLevelChange"
        >
          <SelectTrigger
            class="chat-input__select chat-input__thinking-select"
            size="sm"
            variant="borderless"
            aria-label="选择 Thinking 强度"
            hide-icon
          >
            <span class="chat-input__select-label">{{ currentThinkingLabel }}</span>
          </SelectTrigger>
          <SelectContent :content-style="{ minWidth: '128px' }">
            <SelectGroup>
              <SelectItem
                v-for="option in thinkingOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <BaseIconButton
        type="submit"
        class="chat-input__submit"
        :disabled="!canSubmit"
        :label="isLoading ? '正在发送' : '发送'"
        :aria-label="isLoading ? '正在发送' : '发送'"
        data-chat-submit
      >
        <LoaderCircle v-if="isLoading" :size="18" class="chat-input__spinner" />
        <SendHorizontal v-else :size="18" />
      </BaseIconButton>
    </div>
  </form>
</template>

<style lang="scss" scoped>
.chat-input {
  display: grid;
  width: 100%;
  min-width: 0;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-5) var(--space-3);
  color: var(--color-text);
  background: color-mix(in srgb, var(--color-surface) 88%, var(--color-surface-raised));
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);
}

.chat-input:focus-within {
  border-color: var(--color-primary-outline);
  box-shadow:
    var(--shadow-sm),
    0 0 0 2px var(--color-primary-soft);
}

.chat-input textarea {
  display: block;
  width: 100%;
  min-width: 0;
  min-height: 32px;
  max-height: 168px;
  padding: 0;
  overflow-y: auto;
  resize: none;
  color: var(--color-text);
  background: transparent;
  border: 0;
  outline: 0;
  font: inherit;
  font-size: var(--font-size-ui);
  line-height: 1.6;
}

.chat-input textarea::placeholder {
  color: var(--color-text-subtle);
}

.chat-input textarea:disabled {
  cursor: not-allowed;
}

.chat-input__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: var(--composer-action-control-height, 30px);
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-border-muted);
}

.chat-input__controls {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: var(--space-1);
  margin-right: var(--space-2);
}

.chat-input__select {
  max-width: 220px;
  min-width: 0;
  height: 24px;
  padding-inline: var(--space-2);
  color: var(--color-text-muted);
  border-radius: var(--radius-sm);
}

.chat-input__project-select {
  max-width: 180px;
}

.chat-input__select:hover:not(:disabled),
.chat-input__select[data-state='open'] {
  color: var(--color-text);
  background: var(--color-surface-hover) !important;
}

.chat-input__select-icon {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  transform: none !important;
}

.chat-input__select-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-input__project-content,
.chat-input__model-content {
  max-width: min(360px, calc(100vw - 32px));
}

.chat-input__status {
  flex: 0 0 auto;
  margin-left: var(--space-2);
  color: var(--color-text-subtle);
  font-size: var(--font-size-ui-xs);
}

.chat-input__submit {
  display: inline-grid;
  place-items: center;
  width: var(--composer-action-control-height, 30px);
  height: var(--composer-action-control-height, 30px);
  padding: 0;
  color: var(--color-text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  cursor: pointer;
}

.chat-input__submit:hover:not(:disabled),
.chat-input__submit:focus-visible {
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
  border-color: var(--color-primary-outline);
}

.chat-input__submit:active:not(:disabled) {
  transform: translateY(1px);
}

.chat-input__submit:disabled {
  color: var(--color-text-subtle);
  cursor: not-allowed;
  opacity: 0.48;
}

.chat-input__spinner {
  animation: chat-input-spin 0.9s linear infinite;
}

@keyframes chat-input-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .chat-input,
  .chat-input__submit,
  .chat-input__spinner {
    transition: none;
    animation: none;
  }
}

@media (max-width: 560px) {
  .chat-input__project-select {
    max-width: 96px;
  }

  .chat-input__model-select {
    max-width: 112px;
  }

  .chat-input__thinking-select {
    max-width: 36px;
  }

  .chat-input__thinking-select .chat-input__select-label {
    display: none;
  }
}
</style>
