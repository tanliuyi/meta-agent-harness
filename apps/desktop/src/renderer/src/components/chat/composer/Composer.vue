<script setup lang="ts">
/**
 * Composer.vue - 聊天输入容器。
 */

import type { JSONContent } from '@tiptap/vue-3'
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { onClickOutside } from '@vueuse/core'
import { BaseButton, BaseIconButton } from '@renderer/components/base'
import SendIcon from '@renderer/components/icons/SendIcon.vue'
import { Command } from '@renderer/components/ui/command'
import ScrollArea from '@renderer/components/ui/scroll-area/ScrollArea.vue'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useSelectContentWidth } from '@renderer/components/ui/select/useSelectContentWidth'
import StopIcon from '@renderer/components/icons/StopIcon.vue'
import { Command as CommandIcon, X } from 'lucide-vue-next'
import PlainTextEditor from './PlainTextEditor.vue'
import Usage from './Usage.vue'
import type { TokenUsage } from './Usage.vue'
import type { ComposerImageAttachment } from '@renderer/stores/workspace-session'
import type {
  CommandInfo,
  ExtensionUiRequest,
  ProjectSummary,
  PromptFileReferenceCandidate,
  ThinkingLevel,
  ThreadSnapshot
} from '@shared/coding-agent/types'
import PlusIcon from '@/components/icons/PlusIcon.vue'

type ScrollAreaInstance = InstanceType<typeof ScrollArea>

type FileReferenceCompletionState = {
  candidates: PromptFileReferenceCandidate[]
  selectedIndex: number
}

type RunningMessageDelivery = 'steer' | 'followUp'

type ComposerImagePreview = ComposerImageAttachment & {
  previewSrc: string
}

type ComposerExtensionWidget = {
  lines: string[]
  placement?: 'aboveEditor' | 'belowEditor'
}

type SessionModel = NonNullable<ThreadSnapshot['model']>
type SessionModelOption = Pick<SessionModel, 'provider' | 'id' | 'displayName'>

const thinkingOptions: Array<{ label: string; value: ThinkingLevel }> = [
  { label: 'Off', value: 'off' },
  { label: 'Minimal', value: 'minimal' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'XHigh', value: 'xhigh' }
]

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
    /** 当前会话的 token usage 信息。 */
    usage?: TokenUsage
    /** 当前会话模型。 */
    currentModel?: SessionModel
    /** 当前会话可切换模型。 */
    modelOptions?: SessionModelOption[]
    /** 是否正在加载模型列表。 */
    loadingModelOptions?: boolean
    /** 是否禁用模型选择。 */
    modelSelectDisabled?: boolean
    /** 当前会话 thinking level。 */
    currentThinkingLevel?: ThinkingLevel
    /** 是否禁用 thinking 选择。 */
    thinkingSelectDisabled?: boolean
    /** 当前会话可用 commands。 */
    commands?: CommandInfo[]
    /** 是否正在加载 commands。 */
    loadingCommands?: boolean
    /** 扩展注入到 Composer 附近的小组件。 */
    extensionWidgets?: Record<string, ComposerExtensionWidget>
    /** 待响应的 extension UI 请求。 */
    extensionRequests?: Record<string, ExtensionUiRequest>
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
    usage: undefined,
    currentModel: undefined,
    modelOptions: () => [],
    loadingModelOptions: false,
    modelSelectDisabled: false,
    currentThinkingLevel: 'medium',
    thinkingSelectDisabled: false,
    commands: () => [],
    loadingCommands: false,
    extensionWidgets: () => ({}),
    extensionRequests: () => ({}),
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
  /** 选择当前会话模型。 */
  'select-model': [provider: string, modelId: string]
  /** 选择当前会话 thinking level。 */
  'select-thinking-level': [level: ThinkingLevel]
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
  /** 清空图片附件。 */
  'clear-images': []
  /** 关闭图片处理错误。 */
  'dismiss-image-error': []
  /** 加载 command palette 列表。 */
  'load-commands': []
  /** 运行 command。 */
  'run-command': [command: string]
  /** 响应 extension UI 请求。 */
  'respond-extension-request': [request: ExtensionUiRequest, value?: string | boolean]
  /** 取消 extension UI 请求。 */
  'cancel-extension-request': [request: ExtensionUiRequest]
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
const commandSearchInputRef = ref<HTMLInputElement>()
const commandPaletteRef = ref<HTMLElement>()
const isEditorFocused = ref(false)
const commandPaletteOpen = ref(false)
const commandSearch = ref('')
const selectedCommandIndex = ref(0)
const extensionDrafts = ref<Record<string, string>>({})
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

/** 图片附件总大小。 */
const imageTotalSizeLabel = computed(() =>
  formatFileSize(props.images.reduce((total, image) => total + image.size, 0))
)

/** 图片附件状态摘要。 */
const imageAttachmentSummary = computed(() => {
  if (props.selectingImages) {
    return '正在处理图片'
  }
  if (props.images.length === 0) {
    return ''
  }
  return `${props.images.length} 张图片 · ${imageTotalSizeLabel.value}`
})

const extensionWidgetEntries = computed(() => Object.entries(props.extensionWidgets))
const widgetsAboveEditor = computed(() =>
  extensionWidgetEntries.value.filter(([, widget]) => widget.placement === 'aboveEditor')
)
const widgetsBelowEditor = computed(() =>
  extensionWidgetEntries.value.filter(([, widget]) => widget.placement !== 'aboveEditor')
)
const extensionRequestEntries = computed(() => Object.values(props.extensionRequests))

/** 当前模型选择器值。 */
const currentModelValue = computed(() =>
  props.currentModel ? createModelValue(props.currentModel.provider, props.currentModel.id) : ''
)

/** 当前模型展示文本。 */
const currentModelLabel = computed(() => {
  if (!props.currentModel) {
    return props.loadingModelOptions ? '加载模型...' : '选择模型'
  }
  return formatModelLabel(props.currentModel)
})

/** 模型选择器是否禁用。 */
const isModelSelectDisabled = computed(
  () => props.modelSelectDisabled || props.loadingModelOptions || props.modelOptions.length === 0
)
const modelSelectLabels = computed(() => props.modelOptions.map((model) => formatModelLabel(model)))
const modelSelectContentWidth = useSelectContentWidth({
  labels: modelSelectLabels
})
const modelSelectScrollAreaRef = ref<ScrollAreaInstance | null>(null)
const modelSelectVirtualizer = useVirtualizer(
  computed(() => ({
    count: props.modelOptions.length,
    getScrollElement: () => modelSelectScrollAreaRef.value?.getViewport() ?? null,
    estimateSize: () => 32,
    overscan: 8
  }))
)
const virtualModelItems = computed(() => modelSelectVirtualizer.value.getVirtualItems())
const virtualModelTotalSize = computed(() => modelSelectVirtualizer.value.getTotalSize())
function measureModelSelectItem(refValue: Element | ComponentPublicInstance | null): void {
  const element = refValue instanceof Element ? refValue : refValue?.$el
  if (element instanceof Element) {
    modelSelectVirtualizer.value.measureElement(element)
  }
}
const projectSelectScrollAreaRef = ref<ScrollAreaInstance | null>(null)
const projectSelectVirtualizer = useVirtualizer(
  computed(() => ({
    count: props.projects.length,
    getScrollElement: () => projectSelectScrollAreaRef.value?.getViewport() ?? null,
    estimateSize: () => 32,
    overscan: 8
  }))
)
const virtualProjectItems = computed(() => projectSelectVirtualizer.value.getVirtualItems())
const virtualProjectTotalSize = computed(() => projectSelectVirtualizer.value.getTotalSize())
function measureProjectSelectItem(refValue: Element | ComponentPublicInstance | null): void {
  const element = refValue instanceof Element ? refValue : refValue?.$el
  if (element instanceof Element) {
    projectSelectVirtualizer.value.measureElement(element)
  }
}
const currentProjectLabel = computed(
  () => props.projects.find((project) => project.projectId === props.projectId)?.name
)
const projectSelectLabels = computed(() => props.projects.map((project) => project.name))
const projectSelectContentWidth = useSelectContentWidth({
  labels: projectSelectLabels
})

/** 当前 thinking level 展示文本。 */
const currentThinkingLabel = computed(
  () =>
    thinkingOptions.find((option) => option.value === props.currentThinkingLevel)?.label ??
    props.currentThinkingLevel
)

/** command palette 是否可用。 */
const canOpenCommandPalette = computed(() => Boolean(props.threadId))

/** command palette 过滤结果。 */
const filteredCommands = computed(() => {
  const query = commandSearch.value.trim().toLowerCase()
  if (!query) {
    return props.commands
  }
  return props.commands.filter((command) =>
    [command.name, command.description, command.source]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query)
  )
})

watch(
  () => [
    fileReferenceCompletion.value.selectedIndex,
    fileReferenceCompletion.value.candidates.length
  ],
  () => {
    void nextTick(scrollSelectedFileReferenceIntoView)
  }
)

watch(commandPaletteOpen, (isOpen) => {
  if (!isOpen) {
    commandSearch.value = ''
    selectedCommandIndex.value = 0
    return
  }
  selectedCommandIndex.value = 0
  void nextTick(() => {
    commandSearchInputRef.value?.focus()
  })
})

watch(commandSearch, () => {
  selectedCommandIndex.value = 0
})

watch(
  () => filteredCommands.value.length,
  (length) => {
    if (length === 0) {
      selectedCommandIndex.value = 0
      return
    }
    selectedCommandIndex.value = Math.min(selectedCommandIndex.value, length - 1)
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
 * 切换 command palette。
 */
function toggleCommandPalette(): void {
  if (!canOpenCommandPalette.value) {
    return
  }
  commandPaletteOpen.value = !commandPaletteOpen.value
  if (commandPaletteOpen.value) {
    emit('load-commands')
  }
}

/**
 * 关闭 command palette。
 */
function closeCommandPalette(): void {
  commandPaletteOpen.value = false
}

onClickOutside(commandPaletteRef, closeCommandPalette, {
  ignore: ['.composer__commands']
})

/**
 * 高亮 command palette 项。
 * @param index - command index。
 */
function highlightPaletteCommand(index: number): void {
  selectedCommandIndex.value = index
}

/**
 * 运行 command palette 中的命令。
 * @param command - command 名称。
 */
function runPaletteCommand(command: string): void {
  emit('run-command', command)
  closeCommandPalette()
}

/**
 * 运行当前高亮的 command。
 */
function runSelectedPaletteCommand(): void {
  const command = filteredCommands.value[selectedCommandIndex.value]
  if (!command) {
    return
  }
  runPaletteCommand(command.name)
}

/**
 * 处理 command palette 键盘导航。
 * @param event - 键盘事件。
 */
function handleCommandPaletteKeyDown(event: KeyboardEvent): void {
  if (event.isComposing) {
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeCommandPalette()
    return
  }
  if (filteredCommands.value.length === 0) {
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    selectedCommandIndex.value = (selectedCommandIndex.value + 1) % filteredCommands.value.length
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    selectedCommandIndex.value =
      (selectedCommandIndex.value - 1 + filteredCommands.value.length) %
      filteredCommands.value.length
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    runSelectedPaletteCommand()
  }
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
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    event.stopPropagation()
    toggleCommandPalette()
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
 * 处理会话模型变化。
 * @param value - Select value。
 */
function handleModelChange(value: unknown): void {
  if (typeof value !== 'string' || !value || value === currentModelValue.value) {
    return
  }
  const parsed = parseModelValue(value)
  if (!parsed) {
    return
  }
  emit('select-model', parsed.provider, parsed.modelId)
}

/**
 * 处理会话 thinking level 变化。
 * @param value - Select value。
 */
function handleThinkingLevelChange(value: unknown): void {
  if (
    value !== 'off' &&
    value !== 'minimal' &&
    value !== 'low' &&
    value !== 'medium' &&
    value !== 'high' &&
    value !== 'xhigh'
  ) {
    return
  }
  if (value === props.currentThinkingLevel) {
    return
  }
  emit('select-thinking-level', value)
}

/**
 * 打开图片选择器。
 */
function openImagePicker(): void {
  emit('select-images', props.threadId)
}

/**
 * 格式化附件文件大小。
 * @param bytes - 字节数。
 * @returns 展示文本。
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

/**
 * 获取图片附件的处理提示。
 * @param image - 图片附件。
 * @returns 提示文本。
 */
function getImageHintLabel(image: ComposerImageAttachment): string {
  return image.hints.length > 0 ? image.hints.join(' · ') : '原图已暂存'
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

/**
 * 创建模型选择器 value。
 * @param provider - provider。
 * @param modelId - 模型 ID。
 * @returns Select value。
 */
function createModelValue(provider: string, modelId: string): string {
  return JSON.stringify([provider, modelId])
}

/**
 * 解析模型选择器 value。
 * @param value - Select value。
 * @returns provider 和 modelId。
 */
function parseModelValue(value: string): { provider: string; modelId: string } | undefined {
  try {
    const parsed = JSON.parse(value) as unknown
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string'
    ) {
      return { provider: parsed[0], modelId: parsed[1] }
    }
  } catch {
    return undefined
  }
  return undefined
}

/**
 * 格式化模型展示文本。
 * @param model - 模型。
 * @returns 展示文本。
 */
function formatModelLabel(model: Pick<SessionModel, 'provider' | 'id'>): string {
  return `${model.provider}/${model.id}`
}

function getExtensionRequestTitle(request: ExtensionUiRequest): string {
  return 'title' in request ? request.title : request.type
}

function getExtensionDraft(request: ExtensionUiRequest): string {
  if (extensionDrafts.value[request.id] === undefined) {
    extensionDrafts.value[request.id] = request.type === 'editor' ? (request.prefill ?? '') : ''
  }
  return extensionDrafts.value[request.id]
}

function setExtensionDraft(id: string, value: string): void {
  extensionDrafts.value = {
    ...extensionDrafts.value,
    [id]: value
  }
}

function submitExtensionRequest(request: ExtensionUiRequest, value?: string | boolean): void {
  emit(
    'respond-extension-request',
    request,
    typeof value === 'string' || typeof value === 'boolean' ? value : getExtensionDraft(request)
  )
  clearExtensionDraft(request.id)
}

function cancelExtensionRequest(request: ExtensionUiRequest): void {
  emit('cancel-extension-request', request)
  clearExtensionDraft(request.id)
}

function clearExtensionDraft(id: string): void {
  const next = { ...extensionDrafts.value }
  delete next[id]
  extensionDrafts.value = next
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
    <div v-if="commandPaletteOpen" ref="commandPaletteRef" class="composer__command-palette">
      <header class="composer__command-palette-header">
        <CommandIcon :size="14" />
        <input
          ref="commandSearchInputRef"
          v-model="commandSearch"
          type="search"
          placeholder="Search commands"
          @keydown="handleCommandPaletteKeyDown"
        />
      </header>
      <ScrollArea class="composer__command-palette-scroll">
        <div v-if="loadingCommands" class="composer__command-empty">Loading commands...</div>
        <div v-else-if="filteredCommands.length === 0" class="composer__command-empty">
          No commands
        </div>
        <div v-else class="composer__command-list">
          <button
            v-for="(command, index) in filteredCommands"
            :key="`${command.source}:${command.name}`"
            type="button"
            class="composer__command-item"
            :class="{ 'is-selected': index === selectedCommandIndex }"
            @mouseenter="highlightPaletteCommand(index)"
            @click="runPaletteCommand(command.name)"
          >
            <span>/{{ command.name }}</span>
            <small>{{ command.description || command.source }}</small>
          </button>
        </div>
      </ScrollArea>
    </div>
    <form class="composer" @submit.prevent="handleSubmit">
      <div v-if="extensionRequestEntries.length > 0" class="composer__extension-requests">
        <article
          v-for="request in extensionRequestEntries"
          :key="request.id"
          class="composer__extension-request"
        >
          <header class="composer__extension-request-header">
            <div>
              <strong>{{ getExtensionRequestTitle(request) }}</strong>
              <span>{{ request.type }}</span>
            </div>
            <BaseButton size="sm" variant="ghost" @click="cancelExtensionRequest(request)">
              取消
            </BaseButton>
          </header>

          <p v-if="request.type === 'confirm'" class="composer__extension-request-message">
            {{ request.message }}
          </p>

          <div v-if="request.type === 'select'" class="composer__extension-request-options">
            <BaseButton
              v-for="option in request.options"
              :key="option"
              size="sm"
              variant="secondary"
              @click="submitExtensionRequest(request, option)"
            >
              {{ option }}
            </BaseButton>
          </div>

          <input
            v-if="request.type === 'input'"
            class="composer__extension-request-input"
            :value="getExtensionDraft(request)"
            :placeholder="request.placeholder"
            @input="setExtensionDraft(request.id, ($event.target as HTMLInputElement).value)"
            @keydown.enter.prevent="submitExtensionRequest(request)"
          />

          <textarea
            v-if="request.type === 'editor'"
            class="composer__extension-request-editor"
            :value="getExtensionDraft(request)"
            @input="setExtensionDraft(request.id, ($event.target as HTMLTextAreaElement).value)"
          />

          <div
            v-if="
              request.type === 'confirm' || request.type === 'input' || request.type === 'editor'
            "
            class="composer__extension-request-actions"
          >
            <BaseButton
              v-if="request.type === 'confirm'"
              size="sm"
              variant="primary"
              @click="submitExtensionRequest(request, true)"
            >
              确认
            </BaseButton>
            <BaseButton v-else size="sm" variant="primary" @click="submitExtensionRequest(request)">
              提交
            </BaseButton>
          </div>
        </article>
      </div>

      <div v-if="imagePreviews.length > 0 || selectingImages" class="composer__attachments">
        <div class="composer__attachments-header">
          <span>{{ imageAttachmentSummary }}</span>
          <button v-if="imagePreviews.length > 0" type="button" @click="emit('clear-images')">
            清空
          </button>
        </div>
        <div v-if="imagePreviews.length > 0" class="composer__images">
          <div v-for="image in imagePreviews" :key="image.id" class="composer__image">
            <img :src="image.previewSrc" :alt="image.name" />
            <div class="composer__image-meta">
              <strong>{{ image.name }}</strong>
              <span>{{ formatFileSize(image.size) }} · {{ getImageHintLabel(image) }}</span>
            </div>
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
      </div>
      <div v-if="widgetsAboveEditor.length > 0" class="composer__extension-widgets is-above">
        <article
          v-for="[key, widget] in widgetsAboveEditor"
          :key="key"
          class="composer__extension-widget"
        >
          <strong>{{ key }}</strong>
          <span>{{ widget.lines.join(' · ') }}</span>
        </article>
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
      <div v-if="widgetsBelowEditor.length > 0" class="composer__extension-widgets is-below">
        <article
          v-for="[key, widget] in widgetsBelowEditor"
          :key="key"
          class="composer__extension-widget"
        >
          <strong>{{ key }}</strong>
          <span>{{ widget.lines.join(' · ') }}</span>
        </article>
      </div>
      <div class="composer__actions">
        <div v-if="imageError" class="composer__image-error" role="alert">
          <span>{{ imageError }}</span>
          <button type="button" aria-label="关闭图片错误" @click="emit('dismiss-image-error')">
            <X :size="12" />
          </button>
        </div>
        <div style="margin-right: auto">
          <div class="composer__left-actions">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <BaseIconButton
                    type="button"
                    size="medium"
                    class="composer__attach"
                    label="添加图片"
                    :disabled="selectingImages"
                    @click="openImagePicker"
                  >
                    <PlusIcon :size="16" />
                  </BaseIconButton>
                </TooltipTrigger>
                <TooltipContent>添加图片</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <BaseIconButton
                    type="button"
                    size="medium"
                    class="composer__commands"
                    label="打开命令面板"
                    :active="commandPaletteOpen"
                    :disabled="!canOpenCommandPalette"
                    @click="toggleCommandPalette"
                  >
                    <CommandIcon :size="15" />
                  </BaseIconButton>
                </TooltipTrigger>
                <TooltipContent>命令面板 (⌘K)</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        <Select
          :model-value="currentModelValue"
          :disabled="isModelSelectDisabled"
          @update:model-value="handleModelChange"
        >
          <SelectTrigger
            :ref="modelSelectContentWidth.setTriggerRef"
            class="composer__model-select"
            variant="borderless"
            size="sm"
            :hide-icon="true"
            aria-label="选择当前会话模型"
          >
            <span class="composer__model-label">{{ currentModelLabel }}</span>
          </SelectTrigger>
          <SelectContent
            class="composer__model-select-content"
            :content-style="modelSelectContentWidth.contentStyle.value"
          >
            <ScrollArea ref="modelSelectScrollAreaRef" class="composer__model-select-scroll">
              <SelectGroup
                class="composer__model-select-size"
                :style="{ height: `${virtualModelTotalSize}px` }"
              >
                <SelectItem
                  v-for="virtualItem in virtualModelItems"
                  :key="`${modelOptions[virtualItem.index]?.provider}:${modelOptions[virtualItem.index]?.id}`"
                  :ref="measureModelSelectItem"
                  :data-index="virtualItem.index"
                  class="composer__model-select-item"
                  :style="{ transform: `translateY(${virtualItem.start}px)` }"
                  :value="
                    createModelValue(
                      modelOptions[virtualItem.index]?.provider ?? '',
                      modelOptions[virtualItem.index]?.id ?? ''
                    )
                  "
                >
                  {{ modelOptions[virtualItem.index] ? formatModelLabel(modelOptions[virtualItem.index]) : '' }}
                </SelectItem>
              </SelectGroup>
            </ScrollArea>
          </SelectContent>
        </Select>

        <TooltipProvider>
          <Tooltip>
            <Select
              :model-value="currentThinkingLevel"
              :disabled="thinkingSelectDisabled"
              @update:model-value="handleThinkingLevelChange"
            >
              <TooltipTrigger as="span" class="composer__thinking-tooltip-trigger">
                <SelectTrigger
                  class="composer__thinking-select"
                  variant="borderless"
                  size="sm"
                  :hide-icon="true"
                  aria-label="选择当前会话 Thinking level"
                >
                  <span class="composer__thinking-label">{{ currentThinkingLabel }}</span>
                </SelectTrigger>
              </TooltipTrigger>

              <SelectContent>
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
            <TooltipContent>Thinking level: {{ currentThinkingLabel }}</TooltipContent>
          </Tooltip>
        </TooltipProvider>

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

        <Usage v-if="usage" :usage="usage" />

        <BaseIconButton
          type="button"
          size="medium"
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

    <div class="composer-footer">
      <Select
        v-if="!threadId"
        :model-value="projectId ?? ''"
        :disabled="isRunning || projects.length === 0"
        @update:model-value="handleProjectChange"
      >
        <SelectTrigger
          :ref="projectSelectContentWidth.setTriggerRef"
          class="composer__project-select"
          variant="borderless"
          size="sm"
          aria-label="选择 Project"
        >
          <SelectValue v-if="currentProjectLabel" placeholder="选择 Project">
            {{ currentProjectLabel }}
          </SelectValue>
          <SelectValue v-else placeholder="选择 Project" />
        </SelectTrigger>

        <SelectContent
          class="composer__project-select-content"
          :content-style="projectSelectContentWidth.contentStyle.value"
        >
          <ScrollArea ref="projectSelectScrollAreaRef" class="composer__project-select-scroll">
            <SelectGroup
              class="composer__project-select-size"
              :style="{ height: `${virtualProjectTotalSize}px` }"
            >
              <SelectItem
                v-for="virtualItem in virtualProjectItems"
                :key="projects[virtualItem.index]?.projectId"
                :ref="measureProjectSelectItem"
                :data-index="virtualItem.index"
                class="composer__project-select-item"
                :style="{ transform: `translateY(${virtualItem.start}px)` }"
                :value="projects[virtualItem.index]?.projectId"
                :disabled="projects[virtualItem.index]?.status !== 'available'"
              >
                {{ projects[virtualItem.index]?.name }}
              </SelectItem>
            </SelectGroup>
          </ScrollArea>
        </SelectContent>
      </Select>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.composer-shell {
  position: relative;
  margin-top: auto;
}

.composer {
  position: relative;
  display: grid;
  gap: var(--space-2);
  padding: var(--space-4);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: 18px;
  box-shadow: var(--shadow-sm);
  z-index: 2;
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
  border-radius: var(--radius-md);
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
  border-radius: var(--radius-md);
  cursor: pointer;

  &.is-selected {
    background: var(--composer-selection-bg);
  }
}

.composer__file-completion-label {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer__command-palette {
  position: absolute;
  right: 0;
  bottom: calc(100% + var(--space-2));
  left: 0;
  z-index: 13;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 240px;
  min-width: 0;
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}

.composer__command-palette-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: 8px;
  border-bottom: 1px solid var(--color-border);
}

.composer__command-palette-header svg {
  flex: 0 0 auto;
  color: var(--color-text-muted);
}

.composer__command-palette-header input {
  width: 100%;
  min-width: 0;
  height: 28px;
  padding: 0;
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-ui-sm);
  background: transparent;
  border: 0;
  outline: 0;
}

.composer__command-palette-header input:focus-visible {
  box-shadow: none;
}

.composer__command-palette-scroll {
  min-width: 0;
  min-height: 0;
}

.composer__command-palette-scroll :deep([data-slot='scroll-area-viewport']) {
  height: 100%;
  padding: 6px;
}

.composer__command-list {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.composer__command-item {
  display: grid;
  gap: 2px;
  width: 100%;
  min-width: 0;
  padding: 7px 8px;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--radius-md);
  cursor: pointer;
}

.composer__command-item:hover,
.composer__command-item.is-selected {
  background: var(--composer-selection-bg);
}

.composer__command-item span,
.composer__command-item small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer__command-item span {
  color: var(--color-text);
  font-size: var(--font-size-ui-sm);
  font-weight: 650;
}

.composer__command-item small,
.composer__command-empty {
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);
}

.composer__command-empty {
  padding: 8px;
}

.composer__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  min-height: var(--composer-action-control-height);
}

.composer__left-actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.composer__project-select {
  min-width: 0;
  flex: 0 1 auto;
}

.composer__delivery-select {
  width: 128px;
  min-width: 0;
  flex: 0 1 128px;
}

.composer__model-select {
  display: inline-flex;
  align-items: center;
  flex: 0 1 auto;
  height: var(--composer-action-control-height);
  padding: 0 8px;
  line-height: 1;
}

.composer__model-select:hover {
  background: var(--color-surface-hover) !important;
}

.composer__model-select-scroll,
.composer__project-select-scroll {
  width: 100%;
  max-width: calc(100vw - 32px);
}

.composer__model-select-scroll,
.composer__project-select-scroll {
  max-height: min(320px, var(--reka-select-content-available-height, 320px));
}

.composer__model-select-scroll :deep([data-slot='scroll-area-viewport']),
.composer__project-select-scroll :deep([data-slot='scroll-area-viewport']) {
  max-height: inherit;
}

.composer__model-select-size,
.composer__project-select-size {
  position: relative;
  width: 100%;
}

.composer__model-select-item,
.composer__project-select-item {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
}

.composer__thinking-tooltip-trigger {
  display: inline-flex;
  flex: 0 0 auto;
}

.composer__thinking-select {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  height: var(--composer-action-control-height);
  padding: 0 8px;
  line-height: 1;
}

.composer__thinking-select:hover {
  background: var(--color-surface-hover) !important;
}

.composer__model-label {
  display: inline-flex;
  align-items: center;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-ui-sm);
  line-height: 1;
}

.composer__thinking-label {
  display: inline-flex;
  align-items: center;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-ui-sm);
  line-height: 1;
}

.composer__model-select :deep([data-slot='select-value']),
.composer__thinking-select :deep([data-slot='select-value']) {
  display: inline-flex;
  align-items: center;
  height: 100%;
  line-height: 1;
}

.composer__attach,
.composer__commands,
.composer__action {
  width: var(--composer-action-control-height) !important;
  height: var(--composer-action-control-height) !important;
  line-height: 1 !important;

  &:hover,
  &.is-active {
    background: var(--color-surface-hover);
  }
}

.composer__image-error {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  margin: 0 auto 0 0;
  color: var(--color-danger);
  font-size: var(--font-size-ui-sm);
  line-height: 1.4;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button {
    display: grid;
    flex: 0 0 auto;
    width: 20px;
    height: 20px;
    place-items: center;
    padding: 0;
    color: inherit;
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;

    &:hover {
      background: color-mix(in srgb, var(--color-danger) 12%, transparent);
    }
  }
}

.composer__attachments {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.composer__attachments-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button {
    flex: 0 0 auto;
    height: 22px;
    padding: 0 var(--space-2);
    color: var(--color-text-muted);
    font: inherit;
    font-size: var(--font-size-ui-2xs);
    font-weight: 650;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    cursor: pointer;

    &:hover {
      color: var(--color-text);
      background: var(--color-surface-hover);
      border-color: var(--color-border);
    }
  }
}

.composer__images {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(184px, 1fr));
  gap: var(--space-2);
  min-width: 0;
}

.composer__image {
  position: relative;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 18px;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
  min-height: 56px;
  padding: 5px 6px;
  overflow: hidden;
  background: var(--color-control-track);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);

  img {
    display: block;
    width: 44px;
    height: 44px;
    object-fit: cover;
    border-radius: calc(var(--radius-md) - 2px);
  }
}

.composer__image-meta {
  display: grid;
  gap: 2px;
  min-width: 0;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: var(--color-text);
    font-size: var(--font-size-ui-xs);
    font-weight: 650;
  }

  span {
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-2xs);
  }
}

.composer__image-remove {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  color: var(--color-text);
  background: var(--composer-image-remove-bg);
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

.composer__extension-requests {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  margin-bottom: var(--space-2);
}

.composer__extension-request {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2);
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.composer__extension-request-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;

  > div {
    display: flex;
    flex: 1 1 auto;
    align-items: baseline;
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
    color: var(--color-text-subtle);
    font-size: var(--font-size-ui-xs);
  }
}

.composer__extension-request-message {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-sm);
  line-height: 1.35;
}

.composer__extension-request-options,
.composer__extension-request-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  min-width: 0;
}

.composer__extension-request-input,
.composer__extension-request-editor {
  width: 100%;
  min-width: 0;
  color: var(--color-text);
  background: var(--color-canvas);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font: inherit;
  font-size: var(--font-size-ui-sm);

  &:focus {
    outline: none;
    box-shadow: var(--shadow-focus);
  }
}

.composer__extension-request-input {
  height: 30px;
  padding: 0 var(--space-2);
}

.composer__extension-request-editor {
  min-height: 84px;
  max-height: 160px;
  padding: var(--space-2);
  resize: vertical;
  line-height: 1.45;
}

.composer__extension-widgets {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.composer__extension-widget {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  min-height: 26px;
  padding: 0 var(--space-2);
  color: var(--color-text-muted);
  background: var(--color-surface);
  border: 1px solid var(--color-border-muted);
  border-radius: var(--radius-md);

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-ui-xs);
  }

  strong {
    flex: 0 0 auto;
    color: var(--color-text);
    font-weight: 700;
  }

  span {
    flex: 1 1 auto;
  }
}

.composer__action {
  color: var(--color-primary-ink);
  background: var(--color-primary) !important;
  border-color: var(--color-primary);
  border-radius: 50%;

  &:hover:not(:disabled) {
    background: var(--color-primary-strong);
  }

  &.is-stop {
    color: var(--color-danger-ink);
    background: var(--color-danger);

    &:hover:not(:disabled) {
      background: var(--composer-stop-hover-bg);
    }
  }
}

.composer-footer {
  background: var(--color-canvas);
  margin-top: -8px;
  padding-top: 8px;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
}
</style>
