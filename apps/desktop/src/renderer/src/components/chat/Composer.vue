<script setup lang="ts">
/**
 * Composer.vue - 聊天输入容器。
 */

import type { JSONContent } from '@tiptap/vue-3'
import { computed, nextTick, ref, watch } from 'vue'
import { BaseIconButton } from '@renderer/components/base'
import SendIcon from '@renderer/components/icons/SendIcon.vue'
import { Command } from '@renderer/components/ui/command'
import ScrollArea from '@renderer/components/ui/scroll-area/ScrollArea.vue'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import StopIcon from '@renderer/components/icons/StopIcon.vue'
import { ImagePlus, X } from 'lucide-vue-next'
import PlainTextEditor from './PlainTextEditor.vue'
import type { ComposerImageAttachment } from '@renderer/stores/workspace-session'
import type { ProjectSummary, PromptFileReferenceCandidate } from '@shared/coding-agent/types'

type FileReferenceCompletionState = {
  candidates: PromptFileReferenceCandidate[]
  selectedIndex: number
}

type RunningMessageDelivery = 'steer' | 'followUp'

type ComposerImagePreview = ComposerImageAttachment & {
  previewSrc: string
}

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
    /** Agent 运行中提交消息时的交付方式。 */
    runningDelivery?: RunningMessageDelivery
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
    runningDelivery: 'steer',
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
  /** 同步运行中消息交付方式。 */
  'update:runningDelivery': [value: RunningMessageDelivery]
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

const editorRef = ref<{
  closeFileReferenceCompletion(): void
  focusEditor(): void
  selectFileReferenceCompletion(candidate: PromptFileReferenceCandidate | undefined): void
  setFileReferenceCompletionIndex(index: number): void
}>()
const fileCompletionScrollRef = ref<{
  getViewport(): HTMLElement | undefined
}>()
const composerShellRef = ref<HTMLElement>()
const isEditorFocused = ref(false)
const fileReferenceCompletion = ref<FileReferenceCompletionState>({
  candidates: [],
  selectedIndex: 0
})

const imagePreviews = computed<ComposerImagePreview[]>(() =>
  props.images.map((image) => ({
    ...image,
    previewSrc: `data:${image.mimeType};base64,${image.data}`
  }))
)

watch(
  () => [
    fileReferenceCompletion.value.selectedIndex,
    fileReferenceCompletion.value.candidates.length
  ],
  () => {
    void nextTick(scrollSelectedFileReferenceIntoView)
  }
)

/**
 * 提交输入内容。
 */
function handleSubmit(): void {
  emit('submit')
}

/**
 * 同步编辑器文件补全候选。
 * @param state - 补全展示状态。
 */
function handleFileReferenceCompletion(state: FileReferenceCompletionState): void {
  const shouldRestoreFocus = isEditorFocused.value
  fileReferenceCompletion.value = state
  if (shouldRestoreFocus) {
    void nextTick(() => {
      editorRef.value?.focusEditor()
    })
  }
}

/**
 * 选择文件补全候选。
 * @param candidate - 文件候选。
 */
function selectFileReferenceCandidate(candidate: PromptFileReferenceCandidate): void {
  editorRef.value?.selectFileReferenceCompletion(candidate)
}

/**
 * 高亮当前鼠标所在的文件补全候选。
 * @param index - 候选索引。
 */
function highlightFileReferenceCandidate(index: number): void {
  fileReferenceCompletion.value = {
    ...fileReferenceCompletion.value,
    selectedIndex: index
  }
  editorRef.value?.setFileReferenceCompletionIndex(index)
}

/**
 * 同步编辑器焦点状态。
 * @param focused - 是否聚焦。
 */
function handleEditorFocusChange(focused: boolean): void {
  isEditorFocused.value = focused
}

/**
 * 在补全打开时统一处理键盘选择，避免 Command/Listbox 或焦点变化吞掉编辑器按键。
 * @param event - 键盘事件。
 */
function handleFileReferenceKeyDown(event: KeyboardEvent): void {
  const candidates = fileReferenceCompletion.value.candidates
  if (event.isComposing || candidates.length === 0) {
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    event.stopPropagation()
    const nextIndex = (fileReferenceCompletion.value.selectedIndex + 1) % candidates.length
    highlightFileReferenceCandidate(nextIndex)
    void nextTick(scrollSelectedFileReferenceIntoView)
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    event.stopPropagation()
    const nextIndex =
      (fileReferenceCompletion.value.selectedIndex - 1 + candidates.length) % candidates.length
    highlightFileReferenceCandidate(nextIndex)
    void nextTick(scrollSelectedFileReferenceIntoView)
    return
  }

  if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault()
    event.stopPropagation()
    editorRef.value?.selectFileReferenceCompletion(
      candidates[fileReferenceCompletion.value.selectedIndex]
    )
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    editorRef.value?.closeFileReferenceCompletion()
  }
}

/**
 * 保证键盘高亮的文件候选项处于可视区域。
 */
function scrollSelectedFileReferenceIntoView(): void {
  const viewport = fileCompletionScrollRef.value?.getViewport()
  const selectedItem = composerShellRef.value?.querySelector(
    '.composer__file-completion-item.is-selected'
  )
  if (!viewport || !(selectedItem instanceof HTMLElement)) {
    return
  }
  const viewportRect = viewport.getBoundingClientRect()
  const itemRect = selectedItem.getBoundingClientRect()
  if (itemRect.top < viewportRect.top) {
    viewport.scrollTop -= viewportRect.top - itemRect.top
    return
  }
  if (itemRect.bottom > viewportRect.bottom) {
    viewport.scrollTop += itemRect.bottom - viewportRect.bottom
  }
}

/**
 * 处理发送/停止图标按钮点击。
 */
function handleActionClick(): void {
  if (props.isRunning && !props.canSend) {
    emit('abort')
    return
  }
  emit('submit')
}

/**
 * 处理 Composer 范围内的快捷键。
 * @param event - 键盘事件。
 */
function handleComposerKeyDown(event: KeyboardEvent): void {
  handleFileReferenceKeyDown(event)
  if (event.defaultPrevented || event.isComposing) {
    return
  }
  if (event.key === 'Escape' && props.isRunning && isEditorFocused.value) {
    event.preventDefault()
    event.stopPropagation()
    emit('abort')
  }
}

/**
 * 处理运行中消息交付方式变化。
 * @param value - 交付方式。
 */
function handleRunningDeliveryChange(value: unknown): void {
  if (value === 'steer' || value === 'followUp') {
    emit('update:runningDelivery', value)
  }
}

/**
 * 打开图片选择器。
 */
function openImagePicker(): void {
  emit('select-images', props.threadId)
}

/**
 * 选择新会话草稿所属 Project。
 * @param value - Project ID。
 */
function handleProjectChange(value: unknown): void {
  if (typeof value !== 'string' || !value) {
    return
  }
  emit('select-project', value)
}

</script>

<template>
  <div ref="composerShellRef" class="composer-shell" @keydown.capture="handleComposerKeyDown">
    <Command v-if="fileReferenceCompletion.candidates.length > 0" class="composer__file-completion">
      <ScrollArea ref="fileCompletionScrollRef" class="composer__file-completion-scroll">
        <div class="composer__file-completion-list" role="listbox">
          <button
            v-for="(candidate, index) in fileReferenceCompletion.candidates"
            :key="candidate.absolutePath"
            type="button"
            tabindex="-1"
            class="composer__file-completion-item"
            :class="{ 'is-selected': index === fileReferenceCompletion.selectedIndex }"
            role="option"
            :aria-selected="index === fileReferenceCompletion.selectedIndex"
            @mousedown.prevent="selectFileReferenceCandidate(candidate)"
            @mouseenter="highlightFileReferenceCandidate(index)"
          >
            <span class="composer__file-completion-label">{{ candidate.label }}</span>
          </button>
        </div>
      </ScrollArea>
    </Command>
    <form class="composer" @submit.prevent="handleSubmit">
      <div v-if="imagePreviews.length > 0" class="composer__images">
        <div v-for="image in imagePreviews" :key="image.id" class="composer__image">
          <img :src="image.previewSrc" :alt="image.name" />
          <button
            type="button"
            class="composer__image-remove"
            :aria-label="`移除 ${image.name}`"
            @click="emit('remove-image', image.id)"
          >
            <X :size="10" />
          </button>
        </div>
      </div>
      <PlainTextEditor
        ref="editorRef"
        :model-value="modelValue"
        :placeholder="placeholder"
        :thread-id="threadId"
        :project-id="projectId"
        @update:model-value="emit('update:modelValue', $event)"
        @text-change="emit('text-change', $event)"
        @paste-images="emit('paste-images', $event, threadId)"
        @file-reference-completion="handleFileReferenceCompletion"
        @focus-change="handleEditorFocusChange"
        @submit="handleSubmit"
      />
      <div class="composer__actions">
        <p v-if="imageError" class="composer__image-error" role="alert">{{ imageError }}</p>
        <Select
          v-if="!threadId"
          :model-value="projectId ?? ''"
          :disabled="isRunning || projects.length === 0"
          @update:model-value="handleProjectChange"
        >
          <SelectTrigger class="composer__project-select" size="sm" aria-label="选择 Project">
            <SelectValue placeholder="选择 Project" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem
                v-for="project in projects"
                :key="project.projectId"
                :value="project.projectId"
                :disabled="project.status !== 'available'"
              >
                {{ project.name }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          v-if="isRunning && canSend"
          :model-value="runningDelivery"
          @update:model-value="handleRunningDeliveryChange"
        >
          <SelectTrigger
            class="composer__delivery-select"
            size="sm"
            aria-label="运行中消息交付方式"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="steer">Steer</SelectItem>
              <SelectItem value="followUp">Follow-up</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <BaseIconButton
          type="button"
          size="large"
          class="composer__attach"
          label="添加图片"
          :disabled="selectingImages"
          @click="openImagePicker"
        >
          <ImagePlus :size="18" />
        </BaseIconButton>
        <BaseIconButton
          type="button"
          size="large"
          class="composer__action"
          :class="{ 'is-stop': isRunning && !canSend }"
          :label="isRunning && !canSend ? '停止' : isRunning ? '发送到队列' : '发送'"
          :disabled="!isRunning && !canSend"
          @click="handleActionClick"
        >
          <StopIcon v-if="isRunning && !canSend" :size="20" />
          <SendIcon v-else :size="20" />
        </BaseIconButton>
      </div>
    </form>
  </div>
</template>

<style lang="scss" scoped>
.composer-shell {
  position: relative;
  margin-top: auto;
}

.composer {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}

.composer__file-completion {
  position: absolute;
  right: 0;
  bottom: calc(100% + var(--space-2));
  left: 0;
  z-index: 12;
  height: 112px;
  padding: 6px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
  overflow: hidden;
}

.composer__file-completion-scroll {
  width: 100%;
  height: 100%;
}

.composer__file-completion-scroll :deep([data-slot='scroll-area-viewport']) {
  height: 100%;
  padding-right: 12px;
}

.composer__file-completion-scroll :deep([data-slot='scroll-area-scrollbar']) {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  height: auto;
}

.composer__file-completion-list {
  display: grid;
  gap: 1px;
  min-width: 0;
}

.composer__file-completion-item {
  min-width: 0;
  width: 100%;
  padding: 7px 8px;
  color: var(--color-text);
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;

  &.is-selected {
    background: color-mix(in srgb, var(--color-primary) 16%, transparent);
  }
}

.composer__file-completion-label {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
}

.composer__project-select {
  width: 160px;
  min-width: 0;
  flex: 0 1 160px;
}

.composer__delivery-select {
  width: 128px;
  min-width: 0;
  flex: 0 1 128px;
}

.composer__image-error {
  min-width: 0;
  margin: 0 auto 0 0;
  color: var(--color-danger);
  font-size: var(--font-size-ui-sm);
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
  top: 2px;
  right: 2px;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  padding: 0;
  color: var(--color-text);
  background: color-mix(in srgb, var(--color-surface) 86%, transparent);
  border: 1px solid var(--color-border);
  border-radius: 50%;
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  opacity: 0.7;
  transition:
    opacity var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);

  &:hover {
    opacity: 1;
    color: var(--color-danger-ink);
    background: var(--color-danger);
    border-color: var(--color-danger);
  }
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

    &:hover:not(:disabled) {
      background: color-mix(in srgb, var(--color-danger) 88%, black);
    }
  }
}
</style>
