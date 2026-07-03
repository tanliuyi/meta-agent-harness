<script setup lang="ts">
/**
 * Composer.vue - 聊天输入容器。
 */

import type { JSONContent } from '@tiptap/vue-3'
import { BaseIconButton } from '@renderer/components/base'
import SendIcon from '@renderer/components/icons/SendIcon.vue'
import StopIcon from '@renderer/components/icons/StopIcon.vue'
import { ImagePlus, X } from 'lucide-vue-next'
import PlainTextEditor from './PlainTextEditor.vue'
import type { ComposerImageAttachment } from '@renderer/stores/workspace-session'
import type { ProjectSummary } from '@shared/coding-agent/types'

const props = withDefaults(
  defineProps<{
    /** Tiptap JSON 草稿。 */
    modelValue: JSONContent
    /** Agent 是否正在运行。 */
    isRunning?: boolean
    /** 是否允许发送。 */
    canSend?: boolean
    /** 当前输入区绑定的 thread ID。 */
    threadId?: string
    /** 当前未绑定 thread 的 Project ID。 */
    projectId?: string
    /** 可选择的已有 Project。 */
    projects?: ProjectSummary[]
    /** 图片附件草稿。 */
    images?: ComposerImageAttachment[]
    /** 图片处理错误。 */
    imageError?: string
    /** 是否正在选择/处理图片。 */
    selectingImages?: boolean
    /** 输入提示。 */
    placeholder?: string
  }>(),
  {
    isRunning: false,
    canSend: false,
    projectId: undefined,
    projects: () => [],
    images: () => [],
    imageError: undefined,
    selectingImages: false,
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
  /** 选择新会话草稿所属 Project。 */
  'select-project': [projectId: string]
  /** 选择图片附件。 */
  'select-images': [threadId?: string]
  /** 粘贴图片附件。 */
  'paste-images': [files: File[], threadId?: string]
  /** 删除图片附件。 */
  'remove-image': [id: string]
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

/**
 * 打开图片选择器。
 */
function openImagePicker(): void {
  emit('select-images', props.threadId)
}

/**
 * 选择新会话草稿所属 Project。
 * @param event - select change 事件。
 */
function handleProjectChange(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement) || !target.value) {
    return
  }
  emit('select-project', target.value)
}

/**
 * 生成图片预览 URL。
 * @param image - 图片附件。
 */
function getImagePreviewSrc(image: ComposerImageAttachment): string {
  return `data:${image.mimeType};base64,${image.data}`
}
</script>

<template>
  <form class="composer" @submit.prevent="handleSubmit">
    <div v-if="!threadId" class="composer__project">
      <label for="composer-project-select">Project</label>
      <select
        id="composer-project-select"
        :value="projectId ?? ''"
        :disabled="isRunning || projects.length === 0"
        @change="handleProjectChange"
      >
        <option value="" disabled>选择已有 Project</option>
        <option
          v-for="project in projects"
          :key="project.projectId"
          :value="project.projectId"
          :disabled="project.status !== 'available'"
        >
          {{ project.name }}
        </option>
      </select>
    </div>

    <div v-if="images.length > 0" class="composer__images">
      <div v-for="image in images" :key="image.id" class="composer__image">
        <img :src="getImagePreviewSrc(image)" :alt="image.name" />
        <button
          type="button"
          class="composer__image-remove"
          :aria-label="`移除 ${image.name}`"
          @click="emit('remove-image', image.id)"
        >
          <X :size="14" />
        </button>
      </div>
    </div>
    <PlainTextEditor
      :model-value="modelValue"
      :placeholder="placeholder"
      @update:model-value="emit('update:modelValue', $event)"
      @text-change="emit('text-change', $event)"
      @paste-images="emit('paste-images', $event, threadId)"
      @submit="handleSubmit"
    />
    <div class="composer__actions">
      <p v-if="imageError" class="composer__image-error" role="alert">{{ imageError }}</p>
      <BaseIconButton
        type="button"
        size="large"
        class="composer__attach"
        label="添加图片"
        :disabled="isRunning || selectingImages"
        @click="openImagePicker"
      >
        <ImagePlus :size="18" />
      </BaseIconButton>
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

.composer__project {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-2);

  label {
    color: var(--color-text-muted);
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
  }

  select {
    min-width: 0;
    height: 30px;
    padding: 0 var(--space-3);
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    outline: none;

    &:focus {
      border-color: var(--color-primary);
    }

    &:disabled {
      color: var(--color-text-muted);
      cursor: not-allowed;
      opacity: 0.72;
    }
  }
}

.composer__image-error {
  min-width: 0;
  margin: 0 auto 0 0;
  color: var(--color-danger);
  font-size: 12px;
  line-height: 1.4;
}

.composer__images {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.composer__image {
  position: relative;
  width: 72px;
  height: 72px;
  overflow: hidden;
  background: var(--color-control-track);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
}

.composer__image-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  color: var(--color-danger-ink);
  background: color-mix(in srgb, var(--color-danger) 88%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-danger) 80%, var(--color-border));
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.composer__attach {
  border-color: var(--color-border);
  background: var(--color-surface);
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
