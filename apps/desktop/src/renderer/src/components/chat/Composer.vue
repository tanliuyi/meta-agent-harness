<script setup lang="ts">
/**
 * Composer.vue - 聊天输入容器。
 */

import type { JSONContent } from '@tiptap/vue-3'
import { BaseIconButton } from '@renderer/components/base'
import SendIcon from '@renderer/components/icons/SendIcon.vue'
import StopIcon from '@renderer/components/icons/StopIcon.vue'
import PlainTextEditor from './PlainTextEditor.vue'

const props = withDefaults(
  defineProps<{
    /** Tiptap JSON 草稿。 */
    modelValue: JSONContent
    /** 是否禁用输入。 */
    disabled?: boolean
    /** Agent 是否正在运行。 */
    isRunning?: boolean
    /** 是否允许发送。 */
    canSend?: boolean
    /** 输入提示。 */
    placeholder?: string
  }>(),
  {
    disabled: false,
    isRunning: false,
    canSend: false,
    placeholder: ''
  }
)

const emit = defineEmits<{
  /** 同步 Tiptap JSON 草稿。 */
  'update:modelValue': [value: JSONContent]
  /** 同步纯文本草稿。 */
  'text-change': [value: string]
  /** 发送当前草稿。 */
  submit: []
  /** 中止当前任务。 */
  abort: []
}>()

/**
 * 提交输入内容。
 */
function handleSubmit(): void {
  emit('submit')
}

/**
 * 处理发送/停止图标按钮点击。
 */
function handleActionClick(): void {
  if (props.isRunning) {
    emit('abort')
    return
  }

  emit('submit')
}
</script>

<template>
  <form class="composer" @submit.prevent="handleSubmit">
    <PlainTextEditor
      :model-value="modelValue"
      :disabled="disabled"
      :placeholder="placeholder"
      @update:model-value="emit('update:modelValue', $event)"
      @text-change="emit('text-change', $event)"
      @submit="handleSubmit"
    />
    <div class="composer__actions">
      <BaseIconButton
        type="button"
        size="large"
        class="composer__action"
        :class="{ 'is-stop': isRunning }"
        :label="isRunning ? '停止' : '发送'"
        :disabled="isRunning ? false : !canSend"
        @click="handleActionClick"
      >
        <StopIcon v-if="isRunning" />
        <SendIcon v-else />
      </BaseIconButton>
    </div>
  </form>
</template>

<style lang="scss" scoped>
.composer {
  display: grid;
  gap: var(--space-2);
  margin-top: auto;
  padding: var(--space-3);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}

.composer__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
}

.composer__action {
  color: var(--color-primary-ink);
  background: var(--color-primary);
  border-color: var(--color-primary);

  &:hover:not(:disabled) {
    background: var(--color-primary-strong);
  }

  &.is-stop {
    color: var(--color-danger-ink);
    background: var(--color-danger);
    border-color: var(--color-danger);
  }
}
</style>
