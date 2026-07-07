<script setup lang="ts">
/**
 * Composer.vue - 聊天输入容器。
 */

import type { JSONContent } from '@tiptap/vue-3'
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { BaseButton, BaseIconButton } from '@renderer/components/base'
import ExtensionWidget from '@renderer/components/extension/ExtensionWidget.vue'
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
import { useSelectContentWidth } from '@renderer/components/ui/select/composables/useSelectContentWidth'
import StopIcon from '@renderer/components/icons/StopIcon.vue'
import { Command as CommandIcon, File as FileIcon, LoaderCircle, X } from 'lucide-vue-next'
import type { ImagePreviewItem } from '../ImagePreviewDialog.vue'
import Usage from './Usage.vue'
import type { TokenUsage } from './Usage.vue'
import type {
  ComposerFileAttachment,
  ComposerImageAttachment
} from '@renderer/stores/workspace-session'
import {
  getCommandQueryArgs,
  getCommandQueryName
} from '@renderer/components/session/panel/tabs/display/commandDisplay'
import { useToast } from '@renderer/composables/useToast'
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

type SkillReferenceCompletionCandidate = {
  name: string
  label: string
  description?: string
}

type SkillReferenceCompletionState = {
  candidates: SkillReferenceCompletionCandidate[]
  selectedIndex: number
}

type RunningMessageDelivery = 'steer' | 'followUp'

type ComposerImagePreview = ComposerImageAttachment & {
  previewSrc: string
}

type ComposerExtensionWidget = {
  lines: string[]
  placement: 'aboveEditor' | 'belowEditor'
}

type DroppedFile = File & {
  path?: string
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

const supportedImageMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp'
])
const supportedImageExtensions = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'])
const maxDroppedImageFileBytes = 20 * 1024 * 1024

const PlainTextEditor = defineAsyncComponent(() => import('./PlainTextEditor.vue'))
const ImagePreviewDialog = defineAsyncComponent({
  loader: () => import('../ImagePreviewDialog.vue'),
  suspensible: false
})
const NameCommandDialog = defineAsyncComponent({
  loader: () => import('./dialogs/NameCommandDialog.vue'),
  suspensible: false
})
const VirtualSelectItems = defineAsyncComponent({
  loader: () => import('./select/VirtualSelectItems.vue'),
  suspensible: false
})
const VIRTUAL_SELECT_THRESHOLD = 24
const toast = useToast()

const props = withDefaults(
  defineProps<{
    /** Tiptap JSON 草稿。 */
    modelValue: JSONContent
    /** Agent 是否正在运行。 */
    isRunning?: boolean
    /** 是否允许发送。 */
    canSend?: boolean
    /** 当前是否正在提交发送。 */
    submitting?: boolean
    /** 当前输入区绑定的 thread ID。 */
    threadId?: string
    /** 当前未绑定 thread 的 Project ID。 */
    projectId?: string
    /** 可选择的已有 Project。 */
    projects?: ProjectSummary[]
    /** 图片附件草稿。 */
    images?: ComposerImageAttachment[]
    /** 文件路径附件草稿。 */
    files?: ComposerFileAttachment[]
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
    submitting: false,
    projectId: undefined,
    projects: () => [],
    images: () => [],
    files: () => [],
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
  /** 通过本地路径添加图片附件。 */
  'add-image-paths': [paths: string[], threadId?: string]
  /** 通过本地路径添加文件附件。 */
  'add-files': [files: Array<Omit<ComposerFileAttachment, 'id'>>, threadId?: string]
  /** 删除图片附件。 */
  'remove-image': [id: string]
  /** 删除文件附件。 */
  'remove-file': [id: string]
  /** 清空图片附件。 */
  'clear-images': []
  /** 关闭图片处理错误。 */
  'dismiss-image-error': []
  /** 加载 command palette 列表。 */
  'load-commands': []
  /** 运行 command。 */
  'run-command': [command: string, args?: string]
  /** 响应 extension UI 请求。 */
  'respond-extension-request': [request: ExtensionUiRequest, value?: string | boolean]
  /** 取消 extension UI 请求。 */
  'cancel-extension-request': [request: ExtensionUiRequest]
  /** 中止当前任务。 */
  abort: []
}>()

const editorRef = ref<{
  closeFileReferenceCompletion(): void
  closeSkillReferenceCompletion(): void
  focusEditor(): void
  insertFileReferences(paths: string[]): void
  selectFileReferenceCompletion(candidate: PromptFileReferenceCandidate | undefined): void
  selectSkillReferenceCompletion(candidate: SkillReferenceCompletionCandidate | undefined): void
  setFileReferenceCompletionIndex(index: number): void
  setSkillReferenceCompletionIndex(index: number): void
}>()
const fileCompletionScrollRef = ref<{
  getViewport(): HTMLElement | undefined
}>()
const commandPaletteScrollRef = ref<ScrollAreaInstance | null>(null)
const composerShellRef = ref<HTMLElement>()
const commandSearchInputRef = ref<HTMLInputElement>()
const commandPaletteRef = ref<HTMLElement>()
const isEditorFocused = ref(false)
const commandPaletteOpen = ref(false)
const commandPaletteMode = ref<'button' | 'slash'>('button')
const commandSearch = ref('')
const draftText = ref('')
const selectedCommandIndex = ref(0)
const dragDepth = ref(0)
const isDraggingFiles = ref(false)
const nameCommandDialogOpen = ref(false)
const nameCommandDraft = ref('')
const extensionDrafts = ref<Record<string, string>>({})
const fileReferenceCompletion = ref<FileReferenceCompletionState>({
  candidates: [],
  selectedIndex: 0
})
const skillReferenceCompletion = ref<SkillReferenceCompletionState>({
  candidates: [],
  selectedIndex: 0
})

const imagePreviews = computed<ComposerImagePreview[]>(() =>
  props.images.map((image) => ({
    ...image,
    previewSrc: `data:${image.mimeType};base64,${image.data}`
  }))
)
const fileAttachments = computed(() => props.files)
const imagePreviewDialogOpen = ref(false)
const imagePreviewInitialIndex = ref(0)
const imagePreviewItems = computed<ImagePreviewItem[]>(() =>
  imagePreviews.value.map((image) => ({
    src: image.previewSrc,
    alt: image.name,
    title: image.name,
    meta: `${formatFileSize(image.size)} · ${getImageHintLabel(image)}`
  }))
)

const extensionWidgetEntries = computed(() => Object.entries(props.extensionWidgets))
const widgetsAboveEditor = computed(() =>
  extensionWidgetEntries.value.filter(([, widget]) => widget.placement !== 'belowEditor')
)
const widgetsBelowEditor = computed(() =>
  extensionWidgetEntries.value.filter(([, widget]) => widget.placement === 'belowEditor')
)
const extensionRequestEntries = computed(() => Object.values(props.extensionRequests))
const isDropTargetActive = computed(() => isDraggingFiles.value && !props.selectingImages)

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
const modelSelectItems = computed(() =>
  props.modelOptions.map((model) => ({
    key: createModelValue(model.provider, model.id),
    label: formatModelLabel(model),
    value: createModelValue(model.provider, model.id)
  }))
)
const shouldVirtualizeModelSelect = computed(
  () => props.modelOptions.length >= VIRTUAL_SELECT_THRESHOLD
)
const modelSelectContentWidth = useSelectContentWidth({
  labels: modelSelectLabels
})
function handleModelSelectOpenChange(open: boolean): void {
  if (open) {
    modelSelectContentWidth.scheduleMeasureContentWidth()
  }
}
const currentProjectLabel = computed(
  () => props.projects.find((project) => project.projectId === props.projectId)?.name
)
const projectSelectLabels = computed(() => props.projects.map((project) => project.name))
const projectSelectItems = computed(() =>
  props.projects.map((project) => ({
    key: project.projectId,
    label: project.name,
    value: project.projectId,
    disabled: project.status !== 'available'
  }))
)
const shouldVirtualizeProjectSelect = computed(
  () => props.projects.length >= VIRTUAL_SELECT_THRESHOLD
)
const projectSelectContentWidth = useSelectContentWidth({
  labels: projectSelectLabels
})
function handleProjectSelectOpenChange(open: boolean): void {
  if (open) {
    projectSelectContentWidth.scheduleMeasureContentWidth()
  }
}

/** 当前 thinking level 展示文本。 */
const currentThinkingLabel = computed(
  () =>
    thinkingOptions.find((option) => option.value === props.currentThinkingLevel)?.label ??
    props.currentThinkingLevel
)

/** command palette 是否可用。 */
const canOpenCommandPalette = computed(() => Boolean(props.threadId || props.projectId))

/** command palette 过滤结果。 */
const filteredCommands = computed(() => {
  const query = getCommandQueryName(activeCommandQuery.value).toLowerCase()
  const runnableCommands = props.commands.filter((command) => command.source !== 'skill')
  if (!query) {
    return runnableCommands
  }
  return runnableCommands.filter((command) =>
    [command.name, command.description, command.source]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query)
  )
})

const activeCommandQuery = computed(() =>
  commandPaletteMode.value === 'slash' ? draftText.value : commandSearch.value
)
const hasSkillCommands = computed(() =>
  props.commands.some((command) => command.source === 'skill' && command.name.startsWith('skill:'))
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

watch(
  () => [
    skillReferenceCompletion.value.selectedIndex,
    skillReferenceCompletion.value.candidates.length
  ],
  () => {
    void nextTick(scrollSelectedSkillReferenceIntoView)
  }
)

watch(commandPaletteOpen, (isOpen) => {
  if (!isOpen) {
    commandSearch.value = ''
    commandPaletteMode.value = 'button'
    selectedCommandIndex.value = 0
    return
  }
  selectedCommandIndex.value = 0
  if (commandPaletteMode.value === 'button') {
    void nextTick(() => {
      commandSearchInputRef.value?.focus()
    })
  }
})

watch(commandSearch, () => {
  selectedCommandIndex.value = 0
})

watch(
  () => [selectedCommandIndex.value, filteredCommands.value.length, commandPaletteOpen.value],
  () => {
    void nextTick(scrollSelectedCommandIntoView)
  }
)

watch(draftText, (value) => {
  if (
    isSkillReferenceDraft(value) &&
    canOpenCommandPalette.value &&
    !hasSkillCommands.value &&
    !props.loadingCommands
  ) {
    emit('load-commands')
  }
  if (!isSlashCommandDraft(value)) {
    if (commandPaletteMode.value === 'slash') {
      closeCommandPalette()
    }
    return
  }
  if (!canOpenCommandPalette.value) {
    return
  }
  const wasSlashPaletteOpen = commandPaletteOpen.value && commandPaletteMode.value === 'slash'
  commandPaletteMode.value = 'slash'
  commandPaletteOpen.value = true
  selectedCommandIndex.value = 0
  if (!wasSlashPaletteOpen) {
    emit('load-commands')
  }
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
  if (props.submitting) {
    return
  }
  emit('submit')
}

/**
 * 创建空 Composer 内容。
 * @returns 空 Tiptap JSON。
 */
function createEmptyComposerValue(): JSONContent {
  return {
    type: 'doc',
    content: [{ type: 'paragraph' }]
  }
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
 * 同步编辑器技能补全候选。
 * @param state - 补全展示状态。
 */
function handleSkillReferenceCompletion(state: SkillReferenceCompletionState): void {
  const shouldRestoreFocus = isEditorFocused.value
  skillReferenceCompletion.value = state
  if (shouldRestoreFocus) {
    void nextTick(() => {
      editorRef.value?.focusEditor()
    })
  }
}

/**
 * 同步编辑器文本，并在输入 slash command 时打开命令面板。
 * @param value - 编辑器纯文本。
 */
function handleEditorTextChange(value: string): void {
  draftText.value = value
  emit('text-change', value)
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
 * 选择技能补全候选。
 * @param candidate - 技能候选。
 */
function selectSkillReferenceCandidate(candidate: SkillReferenceCompletionCandidate): void {
  editorRef.value?.selectSkillReferenceCompletion(candidate)
}

/**
 * 获取 skill 候选列表展示名，隐藏内部 command 前缀。
 * @param label - skill command label。
 * @returns 裸 skill 名。
 */
function getSkillReferenceDisplayName(label: string): string {
  return label.replace(/^skill:/, '')
}

/**
 * 高亮当前鼠标所在的技能补全候选。
 * @param index - 候选索引。
 */
function highlightSkillReferenceCandidate(index: number): void {
  skillReferenceCompletion.value = {
    ...skillReferenceCompletion.value,
    selectedIndex: index
  }
  editorRef.value?.setSkillReferenceCompletionIndex(index)
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
 * 在技能补全打开时统一处理键盘选择，避免焦点变化吞掉编辑器按键。
 * @param event - 键盘事件。
 */
function handleSkillReferenceKeyDown(event: KeyboardEvent): void {
  const candidates = skillReferenceCompletion.value.candidates
  if (event.isComposing || candidates.length === 0) {
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    event.stopPropagation()
    const nextIndex = (skillReferenceCompletion.value.selectedIndex + 1) % candidates.length
    highlightSkillReferenceCandidate(nextIndex)
    void nextTick(scrollSelectedSkillReferenceIntoView)
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    event.stopPropagation()
    const nextIndex =
      (skillReferenceCompletion.value.selectedIndex - 1 + candidates.length) % candidates.length
    highlightSkillReferenceCandidate(nextIndex)
    void nextTick(scrollSelectedSkillReferenceIntoView)
    return
  }

  if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault()
    event.stopPropagation()
    editorRef.value?.selectSkillReferenceCompletion(
      candidates[skillReferenceCompletion.value.selectedIndex]
    )
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    editorRef.value?.closeSkillReferenceCompletion()
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
 * 保证键盘高亮的技能候选项处于可视区域。
 */
function scrollSelectedSkillReferenceIntoView(): void {
  const viewport = fileCompletionScrollRef.value?.getViewport()
  const selectedItem = composerShellRef.value?.querySelector(
    '.composer__skill-completion-item.is-selected'
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
 * 保证键盘高亮的命令项处于可视区域。
 */
function scrollSelectedCommandIntoView(): void {
  const viewport = commandPaletteScrollRef.value?.getViewport()
  const selectedItem = commandPaletteRef.value?.querySelector('.composer__command-item.is-selected')
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
  if (props.submitting) {
    return
  }
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
  commandPaletteMode.value = 'button'
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
  const shouldClearSlashDraft = commandPaletteMode.value === 'slash'
  const commandArgs = getCommandQueryArgs(activeCommandQuery.value, command)
  if (command.trim().replace(/^\/+/, '') === 'name') {
    openNameCommandDialog(commandArgs)
    if (shouldClearSlashDraft) {
      clearComposerSlashDraft()
    }
    closeCommandPalette()
    return
  }
  emit('run-command', command, commandArgs)
  if (shouldClearSlashDraft) {
    clearComposerSlashDraft()
  }
  closeCommandPalette()
}

/**
 * 运行当前高亮的 command。
 */
function runSelectedPaletteCommand(): void {
  const command = filteredCommands.value[selectedCommandIndex.value]
  if (command) {
    runPaletteCommand(command.name)
  }
}

/**
 * 清空 slash command 草稿。
 */
function clearComposerSlashDraft(): void {
  draftText.value = ''
  emit('update:modelValue', createEmptyComposerValue())
  emit('text-change', '')
}

/**
 * 打开 /name 命令命名弹层。
 * @param initialValue - 初始会话名称。
 */
function openNameCommandDialog(initialValue?: string): void {
  nameCommandDraft.value = initialValue?.trim() ?? ''
  nameCommandDialogOpen.value = true
}

/**
 * 提交 /name 命令命名弹层。
 */
function submitNameCommandDialog(): void {
  const nextName = nameCommandDraft.value.trim()
  if (!nextName) {
    return
  }
  emit('run-command', 'name', nextName)
  nameCommandDialogOpen.value = false
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
  if (event.key === 'Enter') {
    event.preventDefault()
    runSelectedPaletteCommand()
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
  }
}

/**
 * 在编辑器焦点内处理 slash command 面板快捷键。
 * @param event - 键盘事件。
 */
function handleSlashCommandPaletteKeyDown(event: KeyboardEvent): void {
  if (!commandPaletteOpen.value || commandPaletteMode.value !== 'slash') {
    return
  }
  if (
    event.key !== 'Escape' &&
    event.key !== 'Enter' &&
    event.key !== 'ArrowDown' &&
    event.key !== 'ArrowUp'
  ) {
    return
  }
  handleCommandPaletteKeyDown(event)
  if (event.defaultPrevented) {
    event.stopPropagation()
  }
}

/**
 * 判断当前草稿是否正在输入 slash command。
 * @param value - 编辑器纯文本。
 * @returns 是否应显示 slash command 面板。
 */
function isSlashCommandDraft(value: string): boolean {
  const normalized = value.trimStart()
  return normalized.startsWith('/') && !normalized.includes('\n')
}

/**
 * 判断当前草稿是否正在输入 skill 引用。
 * @param value - 编辑器纯文本。
 * @returns 是否应加载 skill 命令。
 */
function isSkillReferenceDraft(value: string): boolean {
  return /(^|[\s([{（【])\$[^\s$]*$/.test(value)
}

/**
 * 处理 Composer 范围内的快捷键。
 * @param event - 键盘事件。
 */
function handleComposerKeyDown(event: KeyboardEvent): void {
  handleSkillReferenceKeyDown(event)
  if (event.defaultPrevented || event.isComposing) {
    return
  }
  handleFileReferenceKeyDown(event)
  if (event.defaultPrevented || event.isComposing) {
    return
  }
  handleSlashCommandPaletteKeyDown(event)
  if (event.defaultPrevented) {
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
 * 处理拖入文件。
 * @param event - 拖拽事件。
 */
function handleDragEnter(event: DragEvent): void {
  if (!hasDraggedFiles(event)) {
    return
  }
  event.preventDefault()
  dragDepth.value += 1
  isDraggingFiles.value = true
}

/**
 * 允许拖拽文件落入 Composer。
 * @param event - 拖拽事件。
 */
function handleDragOver(event: DragEvent): void {
  if (!hasDraggedFiles(event)) {
    return
  }
  event.preventDefault()
  event.dataTransfer!.dropEffect = 'copy'
  isDraggingFiles.value = true
}

/**
 * 同步文件拖出 Composer 状态。
 * @param event - 拖拽事件。
 */
function handleDragLeave(event: DragEvent): void {
  if (!hasDraggedFiles(event)) {
    return
  }
  dragDepth.value = Math.max(0, dragDepth.value - 1)
  if (dragDepth.value === 0) {
    isDraggingFiles.value = false
  }
}

/**
 * 处理拖拽添加附件；图片走图片链路，其他本地文件退化为路径附件。
 * @param event - 拖拽事件。
 */
function handleDrop(event: DragEvent): void {
  if (!hasDraggedFiles(event)) {
    return
  }
  event.preventDefault()
  dragDepth.value = 0
  isDraggingFiles.value = false

  const files = Array.from(event.dataTransfer?.files ?? []) as DroppedFile[]
  const imagePaths: string[] = []
  const inlineImageFiles: DroppedFile[] = []
  const fileAttachments: Array<Omit<ComposerFileAttachment, 'id'>> = []
  const rejections: string[] = []

  for (const file of files) {
    const localPath = getDroppedLocalPath(file)
    if (isSupportedImageFile(file)) {
      if (file.size > maxDroppedImageFileBytes) {
        rejections.push(`${file.name} 超过 ${formatFileSize(maxDroppedImageFileBytes)}`)
        continue
      }
      if (localPath) {
        imagePaths.push(localPath)
      } else {
        inlineImageFiles.push(file)
      }
      continue
    }

    if (!localPath) {
      rejections.push(`${file.name} 无法获取本地路径`)
      continue
    }
    fileAttachments.push({
      path: localPath,
      name: file.name,
      size: file.size
    })
  }

  if (imagePaths.length > 0) {
    emit('add-image-paths', imagePaths, props.threadId)
  }
  if (inlineImageFiles.length > 0) {
    emit('paste-images', inlineImageFiles, props.threadId)
  }
  if (fileAttachments.length > 0) {
    emit('add-files', fileAttachments, props.threadId)
  }
  showDroppedFileRejections(rejections)
}

/**
 * 判断当前拖拽是否包含文件。
 * @param event - 拖拽事件。
 * @returns 是否包含文件。
 */
function hasDraggedFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

/**
 * 判断文件是否是 Composer 支持的图片附件。
 * @param file - 浏览器 File。
 * @returns 是否支持。
 */
function isSupportedImageFile(file: File): boolean {
  if (supportedImageMimeTypes.has(file.type.toLowerCase())) {
    return true
  }
  const extension = getFileExtension(file.name)
  return extension ? supportedImageExtensions.has(extension) : false
}

/**
 * 获取 Electron 暴露的拖拽文件本地路径。
 * @param file - 拖拽文件。
 * @returns 本地路径。
 */
function getDroppedLocalPath(file: DroppedFile): string {
  return window.api.fileSystem.getPathForFile(file) || file.path || ''
}

/**
 * 展示拖拽文件拒绝提示。
 * @param rejections - 拒绝原因列表。
 */
function showDroppedFileRejections(rejections: string[]): void {
  if (rejections.length === 0) {
    return
  }
  const visible = rejections.slice(0, 3).join('；')
  const suffix = rejections.length > 3 ? ` 等 ${rejections.length} 个文件` : ''
  toast.warning('部分文件未添加', `${visible}${suffix}`)
}

/**
 * 获取文件扩展名。
 * @param name - 文件名。
 * @returns 小写扩展名。
 */
function getFileExtension(name: string): string | undefined {
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index + 1).toLowerCase() : undefined
}

function openImagePreview(index: number): void {
  imagePreviewInitialIndex.value = index
  imagePreviewDialogOpen.value = true
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
  <div
    ref="composerShellRef"
    class="composer-shell"
    :class="{ 'is-drop-target-active': isDropTargetActive }"
    @keydown.capture="handleComposerKeyDown"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <Command
      v-if="skillReferenceCompletion.candidates.length > 0"
      class="composer__file-completion composer__skill-completion"
    >
      <ScrollArea ref="fileCompletionScrollRef" class="composer__file-completion-scroll">
        <div class="composer__file-completion-list" role="listbox">
          <button
            v-for="(candidate, index) in skillReferenceCompletion.candidates"
            :key="candidate.name"
            type="button"
            tabindex="-1"
            class="composer__file-completion-item composer__skill-completion-item"
            :class="{ 'is-selected': index === skillReferenceCompletion.selectedIndex }"
            role="option"
            :aria-selected="index === skillReferenceCompletion.selectedIndex"
            @mousedown.prevent="selectSkillReferenceCandidate(candidate)"
            @mouseenter="highlightSkillReferenceCandidate(index)"
          >
            <span class="composer__skill-completion-row">
              <span class="composer__skill-completion-name">
                {{ getSkillReferenceDisplayName(candidate.label) }}
              </span>
              <small v-if="candidate.description" class="composer__skill-completion-description">
                {{ candidate.description }}
              </small>
            </span>
          </button>
        </div>
      </ScrollArea>
    </Command>
    <Command
      v-else-if="fileReferenceCompletion.candidates.length > 0"
      class="composer__file-completion"
    >
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
          v-if="commandPaletteMode === 'button'"
          ref="commandSearchInputRef"
          v-model="commandSearch"
          type="search"
          placeholder="Search commands"
          @keydown="handleCommandPaletteKeyDown"
        />
        <div v-else class="composer__command-query">
          {{ activeCommandQuery || '/' }}
        </div>
      </header>
      <ScrollArea ref="commandPaletteScrollRef" class="composer__command-palette-scroll">
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
          <BaseButton
            type="button"
            size="sm"
            variant="ghost"
            @click="cancelExtensionRequest(request)"
          >
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
            type="button"
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
          :aria-label="getExtensionRequestTitle(request)"
          @input="setExtensionDraft(request.id, ($event.target as HTMLInputElement).value)"
          @keydown.enter.prevent="submitExtensionRequest(request)"
        />

        <textarea
          v-if="request.type === 'editor'"
          class="composer__extension-request-editor"
          :value="getExtensionDraft(request)"
          :aria-label="getExtensionRequestTitle(request)"
          @input="setExtensionDraft(request.id, ($event.target as HTMLTextAreaElement).value)"
        />

        <div
          v-if="request.type === 'confirm' || request.type === 'input' || request.type === 'editor'"
          class="composer__extension-request-actions"
        >
          <BaseButton
            v-if="request.type === 'confirm'"
            type="button"
            size="sm"
            variant="primary"
            @click="submitExtensionRequest(request, true)"
          >
            确认
          </BaseButton>
          <BaseButton
            v-else
            type="button"
            size="sm"
            variant="primary"
            @click="submitExtensionRequest(request)"
          >
            提交
          </BaseButton>
        </div>
      </article>
    </div>

    <div v-if="widgetsAboveEditor.length > 0" class="composer__extension-widgets is-above">
      <ExtensionWidget
        v-for="[key, widget] in widgetsAboveEditor"
        :key="key"
        :title="key"
        :lines="widget.lines"
        variant="compact"
      />
    </div>

    <div v-if="widgetsBelowEditor.length > 0" class="composer__extension-widgets is-below">
      <ExtensionWidget
        v-for="[key, widget] in widgetsBelowEditor"
        :key="key"
        :title="key"
        :lines="widget.lines"
        variant="compact"
      />
    </div>

    <form class="composer" @submit.prevent="handleSubmit">
      <div
        v-if="imagePreviews.length > 0 || fileAttachments.length > 0 || selectingImages"
        class="composer__attachments"
      >
        <div v-if="imagePreviews.length > 0" class="composer__images">
          <div v-for="(image, index) in imagePreviews" :key="image.id" class="composer__image">
            <button
              class="composer__image-preview"
              type="button"
              :aria-label="`预览 ${image.name}`"
              @click="openImagePreview(index)"
            >
              <img :src="image.previewSrc" :alt="image.name" />
            </button>
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
        <div v-if="fileAttachments.length > 0" class="composer__files">
          <div v-for="file in fileAttachments" :key="file.id" class="composer__file">
            <FileIcon :size="15" class="composer__file-icon" />
            <div class="composer__file-meta">
              <strong :title="file.path">{{ file.name }}</strong>
              <span>{{ formatFileSize(file.size) }}</span>
            </div>
            <button
              type="button"
              class="composer__file-remove"
              :aria-label="`移除 ${file.name}`"
              @click="emit('remove-file', file.id)"
            >
              <X :size="10" />
            </button>
          </div>
        </div>
      </div>
      <PlainTextEditor
        ref="editorRef"
        :model-value="modelValue"
        :placeholder="placeholder"
        :thread-id="threadId"
        :project-id="projectId"
        :commands="commands"
        @update:model-value="emit('update:modelValue', $event)"
        @text-change="handleEditorTextChange"
        @paste-images="emit('paste-images', $event, threadId)"
        @file-reference-completion="handleFileReferenceCompletion"
        @skill-reference-completion="handleSkillReferenceCompletion"
        @focus-change="handleEditorFocusChange"
        @submit="handleSubmit"
      />
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
          @update:open="handleModelSelectOpenChange"
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
            <VirtualSelectItems
              v-if="shouldVirtualizeModelSelect"
              :items="modelSelectItems"
              scroll-class="composer__model-select-scroll"
              size-class="composer__model-select-size"
              item-class="composer__model-select-item"
            />
            <ScrollArea v-else class="composer__model-select-scroll">
              <SelectGroup class="composer__model-select-list">
                <SelectItem v-for="item in modelSelectItems" :key="item.key" :value="item.value">
                  {{ item.label }}
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

              <SelectContent :content-style="{ width: '128px', minWidth: '128px' }">
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
            variant="borderless"
            size="sm"
            :hide-icon="true"
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

        <ImagePreviewDialog
          v-if="imagePreviewDialogOpen"
          v-model:open="imagePreviewDialogOpen"
          :images="imagePreviewItems"
          :initial-index="imagePreviewInitialIndex"
        />

        <BaseIconButton
          type="button"
          size="medium"
          class="composer__action"
          :class="{ 'is-stop': isRunning && !canSend, 'is-loading': submitting }"
          :label="
            submitting
              ? '发送中'
              : isRunning && !canSend
                ? '停止'
                : isRunning
                  ? '发送到队列'
                  : '发送'
          "
          :disabled="submitting || (!isRunning && !canSend)"
          @click="handleActionClick"
        >
          <LoaderCircle v-if="submitting" :size="18" />
          <StopIcon v-else-if="isRunning && !canSend" :size="20" />
          <SendIcon v-else :size="20" />
        </BaseIconButton>
      </div>
    </form>

    <div v-if="!threadId" class="composer-footer">
      <Select
        :model-value="projectId ?? ''"
        :disabled="isRunning || projects.length === 0"
        @update:model-value="handleProjectChange"
        @update:open="handleProjectSelectOpenChange"
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
          <VirtualSelectItems
            v-if="shouldVirtualizeProjectSelect"
            :items="projectSelectItems"
            scroll-class="composer__project-select-scroll"
            size-class="composer__project-select-size"
            item-class="composer__project-select-item"
          />
          <ScrollArea v-else class="composer__project-select-scroll">
            <SelectGroup class="composer__project-select-list">
              <SelectItem
                v-for="item in projectSelectItems"
                :key="item.key"
                :disabled="item.disabled"
                :value="item.value"
              >
                {{ item.label }}
              </SelectItem>
            </SelectGroup>
          </ScrollArea>
        </SelectContent>
      </Select>
    </div>

    <NameCommandDialog
      v-if="nameCommandDialogOpen"
      v-model:open="nameCommandDialogOpen"
      v-model="nameCommandDraft"
      @submit="submitNameCommandDialog"
    />
  </div>
</template>

<style lang="scss" scoped>
.composer-shell {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.composer-shell {
  position: relative;
  margin-top: auto;

  &.is-drop-target-active .composer::after {
    opacity: 1;
  }
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

  &::after {
    position: absolute;
    inset: 0;
    z-index: 14;
    display: grid;
    place-items: center;
    color: var(--color-primary);
    font-size: var(--font-size-ui-sm);
    font-weight: 650;
    content: '释放以添加附件';
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
    border: 1px dashed var(--color-primary);
    border-radius: 18px;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-fast) var(--ease-standard);
  }
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

.composer__skill-completion {
  height: min(280px, calc(100vh - 260px));
  min-height: 184px;
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
  min-height: 32px;
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

.composer__file-completion-description {
  display: block;
  min-width: 0;
  margin-top: 2px;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer__skill-completion-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  white-space: nowrap;
}

.composer__skill-completion-name {
  flex: 0 0 auto;
  max-width: 42%;
  min-width: 0;
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
}

.composer__skill-completion-description {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);
  text-overflow: ellipsis;
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

.composer__command-query {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--font-size-ui-sm);
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer__command-palette-scroll {
  min-width: 0;
  min-height: 0;
}

.composer__command-palette-scroll :deep([data-slot='scroll-area-viewport']) {
  height: 100%;
  padding-right: 12px;
}

.composer__command-list {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 6px;
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
  min-width: 0;
  flex: 0 0 auto;
}

.composer__model-select,
.composer__thinking-select,
.composer__delivery-select {
  display: inline-flex;
  align-items: center;
  height: var(--composer-action-control-height);
  padding: 0 8px;
  line-height: 1;
}

.composer__model-select {
  flex: 0 1 auto;
}

.composer__model-select:hover,
.composer__thinking-select:hover,
.composer__delivery-select:hover {
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
  flex: 0 0 auto;
}

.composer__model-label,
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
.composer__thinking-select :deep([data-slot='select-value']),
.composer__delivery-select :deep([data-slot='select-value']) {
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

.composer__images {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-width: 0;
}

.composer__files {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-width: 0;
}

.composer__file {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: flex-start;
  gap: var(--space-2);
  min-width: 180px;
  max-width: min(320px, 100%);
  height: 40px;
  padding: var(--space-1) var(--space-4) var(--space-1) var(--space-2);
  color: var(--color-text);
  background: var(--color-control-track);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.composer__file-icon {
  color: var(--color-text-muted);
}

.composer__file-meta {
  display: grid;
  gap: 1px;
  min-width: 0;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: var(--font-size-ui-xs);
    font-weight: 650;
  }

  span {
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-2xs);
  }
}

.composer__file-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 14px;
  height: 14px;
  padding: 0;
  color: var(--color-text);
  background: var(--composer-image-remove-bg);
  border: 1px solid var(--color-border);
  border-radius: 50%;
  box-shadow: var(--shadow-sm);
  cursor: pointer;
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

.composer__image {
  position: relative;
  min-width: 0;
  width: 56px;
  height: 56px;

  &:hover {
    .composer__image-remove {
      opacity: 1;
    }
  }
}

.composer__image-preview {
  display: block;
  width: 56px;
  height: 56px;
  padding: 0;
  overflow: hidden;
  background: var(--color-control-track);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: zoom-in;

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  &:focus-visible {
    outline: 2px solid var(--color-primary-outline);
    outline-offset: 2px;
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
  position: absolute;
  top: 2px;
  right: 2px;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 14px;
  height: 14px;
  padding: 0;
  color: var(--color-text);
  background: var(--composer-image-remove-bg);
  border: 1px solid var(--color-border);
  border-radius: 50%;
  box-shadow: var(--shadow-sm);
  cursor: pointer;
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
}

.composer__extension-request {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-3);
  color: var(--color-text);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
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
  overflow-wrap: anywhere;
  white-space: pre-wrap;
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

  &.is-loading {
    cursor: wait;

    :deep(svg) {
      animation: composer-action-spin 0.8s linear infinite;
    }
  }
}

@keyframes composer-action-spin {
  to {
    transform: rotate(360deg);
  }
}

.composer-footer {
  background: var(--color-surface-raised);
  margin-top: -22px;
  padding-top: 10px;
  padding-bottom: 4px;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
}
</style>
