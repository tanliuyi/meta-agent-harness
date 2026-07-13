<script setup lang="ts">
/**
 * Composer.vue - 聊天输入容器。
 */

import type { JSONContent } from '@tiptap/vue-3'
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import { autoUpdate, offset, size, useFloating } from '@floating-ui/vue'
import { onClickOutside } from '@vueuse/core'
import { BaseIconButton } from '@renderer/components/base'
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
import {
  Command as CommandIcon,
  File as FileIcon,
  Folder as FolderIcon,
  LoaderCircle,
  Quote,
  Target,
  X
} from 'lucide-vue-next'
import type { ImagePreviewItem } from '../ImagePreviewDialog.vue'
import Usage from './Usage.vue'
import type { TokenUsage } from './Usage.vue'
import type {
  ComposerFileAttachment,
  ComposerImageAttachment,
  ComposerQuoteAttachment
} from '@renderer/stores/workspace-session'
import {
  getCommandQueryArgs,
  getCommandQueryName
} from '@renderer/components/session/panel/tabs/display/commandDisplay'
import { useToast } from '@renderer/composables/useToast'
import { WORKSPACE_PORTAL_TARGET } from '@renderer/router/workspace-route-host'
import type {
  CommandInfo,
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

type DroppedFile = File & {
  path?: string
}

type SessionModel = NonNullable<ThreadSnapshot['model']>
type SessionModelOption = Pick<SessionModel, 'provider' | 'id' | 'displayName'>

const thinkingOptions: Array<{ label: string; value: ThinkingLevel }> = [
  { label: '关闭', value: 'off' },
  { label: '最低', value: 'minimal' },
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
  { label: '最高', value: 'xhigh' }
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
    /** Assistant 文本引用草稿。 */
    quotes?: ComposerQuoteAttachment[]
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
    /** 是否禁用输入表单。 */
    disabled?: boolean
    /** Agent 运行中提交消息时的交付方式。 */
    runningDelivery?: RunningMessageDelivery
    /** 输入提示。 */
    placeholder?: string
    /** 当前 Composer 的临时模式标签。 */
    modeLabel?: string
    /** 临时模式的提交错误。 */
    modeError?: string
  }>(),
  {
    isRunning: false,
    canSend: false,
    submitting: false,
    projectId: undefined,
    projects: () => [],
    images: () => [],
    files: () => [],
    quotes: () => [],
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
    disabled: false,
    runningDelivery: 'steer',
    placeholder: '',
    modeLabel: undefined,
    modeError: undefined
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
  'add-image-files': [files: File[], threadId?: string]
  /** 通过本地路径添加文件附件。 */
  'add-files': [files: Array<Omit<ComposerFileAttachment, 'id'>>, threadId?: string]
  /** 删除图片附件。 */
  'remove-image': [id: string]
  /** 删除文件附件。 */
  'remove-file': [id: string]
  /** 删除 assistant 文本引用。 */
  'remove-quote': [id: string]
  /** 清空图片附件。 */
  'clear-images': []
  /** 关闭图片处理错误。 */
  'dismiss-image-error': []
  /** 加载 command palette 列表。 */
  'load-commands': []
  /** 运行 command。 */
  'run-command': [command: string, args?: string]
  /** 中止当前任务。 */
  abort: []
  /** 退出当前临时 Composer 模式。 */
  'exit-mode': []
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
const composerPopupRef = ref<HTMLElement>()
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

const isComposerFormDisabled = computed(() => props.disabled)
const isDropTargetActive = computed(() => isDraggingFiles.value && !props.selectingImages)
const hasOpenComposerPopup = computed(
  () =>
    skillReferenceCompletion.value.candidates.length > 0 ||
    fileReferenceCompletion.value.candidates.length > 0 ||
    commandPaletteOpen.value
)
const { floatingStyles: composerPopupStyle, update: updateComposerPopupPosition } = useFloating(
  composerShellRef,
  composerPopupRef,
  {
    placement: 'top',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      size({
        apply({ rects, elements }) {
          Object.assign(elements.floating.style, {
            width: `${rects.reference.width}px`
          })
        }
      })
    ]
  }
)

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
const canOpenCommandPalette = computed(
  () => !props.modeLabel && Boolean(props.threadId || props.projectId)
)

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

watch(hasOpenComposerPopup, (isOpen) => {
  if (isOpen) {
    void nextTick(updateComposerPopupPosition)
  }
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
  if (props.submitting || isComposerFormDisabled.value) {
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
  if (isComposerFormDisabled.value) {
    return
  }
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
  const selectedItem = viewport?.querySelector('.composer__file-completion-item.is-selected')
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
  const selectedItem = viewport?.querySelector('.composer__skill-completion-item.is-selected')
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
  const selectedItem = viewport?.querySelector('.composer__command-item.is-selected')
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
  if (props.submitting || isComposerFormDisabled.value) {
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
  if (!canOpenCommandPalette.value || isComposerFormDisabled.value) {
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
  if (isComposerFormDisabled.value || props.modeLabel) {
    return
  }
  emit('select-images', props.threadId)
}

/**
 * 处理拖入文件。
 * @param event - 拖拽事件。
 */
function handleDragEnter(event: DragEvent): void {
  if (props.modeLabel || !hasDraggedFiles(event)) {
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
  if (props.modeLabel || !hasDraggedFiles(event)) {
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
  if (props.modeLabel || !hasDraggedFiles(event)) {
    return
  }
  event.preventDefault()
  dragDepth.value = 0
  isDraggingFiles.value = false

  const files = Array.from(event.dataTransfer?.files ?? []) as DroppedFile[]
  const localImageFiles: DroppedFile[] = []
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
        localImageFiles.push(file)
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

  if (localImageFiles.length > 0) {
    emit('add-image-files', localImageFiles, props.threadId)
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
    <Teleport :to="WORKSPACE_PORTAL_TARGET">
      <div
        v-if="hasOpenComposerPopup"
        ref="composerPopupRef"
        class="composer__floating-popup"
        :style="composerPopupStyle"
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
                  <small
                    v-if="candidate.description"
                    class="composer__skill-completion-description"
                  >
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
        <div
          v-else-if="commandPaletteOpen"
          ref="commandPaletteRef"
          class="composer__command-palette"
        >
          <header class="composer__command-palette-header">
            <CommandIcon :size="14" />
            <input
              v-if="commandPaletteMode === 'button'"
              ref="commandSearchInputRef"
              v-model="commandSearch"
              type="search"
              placeholder="搜索命令"
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
      </div>
    </Teleport>
    <div class="composer-stack">
      <div v-if="$slots.overlay" class="composer__overlay">
        <slot name="overlay" />
      </div>

      <form
        class="composer"
        :class="{ 'is-disabled': isComposerFormDisabled }"
        :inert="isComposerFormDisabled"
        :aria-disabled="isComposerFormDisabled"
        @submit.prevent="handleSubmit"
      >
        <div
          v-if="
            imagePreviews.length > 0 ||
            fileAttachments.length > 0 ||
            quotes.length > 0 ||
            selectingImages
          "
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
          <div v-if="quotes.length > 0" class="composer__quotes">
            <div
              v-for="quote in quotes"
              :key="quote.id"
              class="composer__quote"
              :class="{ 'is-browser-element': quote.kind === 'browser-element' }"
            >
              <Target v-if="quote.kind === 'browser-element'" :size="14" aria-hidden="true" />
              <Quote v-else :size="14" aria-hidden="true" />
              <span class="composer__quote-label" :title="quote.browserRef || quote.text">
                {{
                  quote.kind === 'browser-element'
                    ? `<${quote.tagName || 'element'}>${quote.label ? ` ${quote.label}` : ''}`
                    : '文本引用'
                }}
              </span>
              <button
                type="button"
                class="composer__quote-remove"
                :aria-label="quote.kind === 'browser-element' ? '移除元素引用' : '移除文本引用'"
                @click="emit('remove-quote', quote.id)"
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
          @paste-images="!modeLabel && emit('paste-images', $event, threadId)"
          @file-reference-completion="handleFileReferenceCompletion"
          @skill-reference-completion="handleSkillReferenceCompletion"
          @focus-change="handleEditorFocusChange"
          @submit="handleSubmit"
        />
        <div class="composer__actions">
          <div v-if="modeError" class="composer__image-error" role="alert">
            <span>{{ modeError }}</span>
          </div>
          <div v-if="imageError" class="composer__image-error" role="alert">
            <span>{{ imageError }}</span>
            <button type="button" aria-label="关闭图片错误" @click="emit('dismiss-image-error')">
              <X :size="12" />
            </button>
          </div>
          <div class="composer__primary-actions">
            <div class="composer__left-actions">
              <BaseIconButton
                v-if="!modeLabel"
                type="button"
                size="medium"
                class="composer__attach"
                label="添加图片"
                :disabled="selectingImages"
                @click="openImagePicker"
              >
                <PlusIcon :size="16" />
              </BaseIconButton>
              <BaseIconButton
                v-if="!modeLabel"
                type="button"
                size="medium"
                class="composer__commands"
                label="命令面板 (⌘K)"
                :active="commandPaletteOpen"
                :disabled="!canOpenCommandPalette"
                @click="toggleCommandPalette"
              >
                <CommandIcon :size="15" />
              </BaseIconButton>
              <div v-if="modeLabel" class="composer__mode-chip">
                <Target :size="13" aria-hidden="true" />
                <span>{{ modeLabel }}</span>
                <button
                  type="button"
                  :aria-label="`退出 ${modeLabel} 模式`"
                  @click="emit('exit-mode')"
                >
                  <X :size="12" />
                </button>
              </div>
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

                <SelectContent
                  class="composer__thinking-select-content"
                  :content-style="{ width: '172px', minWidth: '172px' }"
                >
                  <SelectGroup class="composer__thinking-select-list">
                    <SelectItem
                      v-for="option in thinkingOptions"
                      :key="option.value"
                      :value="option.value"
                      class="composer__thinking-select-item"
                    >
                      <span class="composer__thinking-option-label">{{ option.label }}</span>
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <TooltipContent>思考强度：{{ currentThinkingLabel }}</TooltipContent>
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

      <div v-if="isComposerFormDisabled && isRunning && !canSend" class="composer__floating-stop">
        <BaseIconButton
          type="button"
          size="medium"
          class="composer__action is-stop"
          label="停止"
          @click="emit('abort')"
        >
          <StopIcon :size="20" />
        </BaseIconButton>
      </div>
    </div>

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
          :hide-icon="true"
          aria-label="选择 Project"
        >
          <span class="composer__project-label">
            <FolderIcon :size="14" aria-hidden="true" />
            <span class="composer__project-label-text">
              {{ currentProjectLabel ?? '选择 Project' }}
            </span>
          </span>
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
  width: 100%;
  max-width: 100%;
  min-width: 0;
  container-type: inline-size;
}

.composer-shell {
  position: relative;
  margin-top: auto;

  &.is-drop-target-active .composer::after {
    opacity: 1;
  }
}

.composer-stack {
  position: relative;
  display: grid;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: visible;
  border-radius: var(--radius-lg);
}

.composer {
  position: relative;
  grid-area: 1 / 1;
  display: grid;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-5) var(--space-3);
  background: color-mix(in srgb, var(--color-surface) 88%, var(--color-surface-raised));
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  z-index: 2;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);

  &:focus-within {
    border-color: var(--color-primary-outline);
    box-shadow:
      var(--shadow-sm),
      0 0 0 2px var(--color-primary-soft);
  }

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
    background: color-mix(in srgb, var(--color-primary) 7%, transparent);
    border: 1px dashed var(--color-primary);
    border-radius: inherit;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-fast) var(--ease-standard);
  }

  &.is-disabled {
    color: var(--color-text-muted);
    background: color-mix(in srgb, var(--color-surface-raised) 82%, var(--color-canvas));
    border-color: color-mix(in srgb, var(--color-border) 64%, transparent);
    box-shadow: none;
    filter: saturate(0.62);
    pointer-events: none;
    user-select: none;
  }
}

.composer__floating-stop {
  position: relative;
  z-index: 31;
  grid-area: 1 / 1;
  align-self: end;
  justify-self: end;
  margin: 0 var(--space-4) var(--space-4) 0;
  pointer-events: auto;
}

.composer__floating-popup {
  z-index: 1000;
  min-width: 0;
}

.composer__file-completion {
  width: 100%;
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

.composer__file-completion,
.composer__command-palette {
  background: color-mix(in srgb, var(--color-surface) 92%, transparent);
  border-color: var(--color-border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
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
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  &.is-selected {
    color: var(--color-primary-strong);
    background: var(--composer-selection-bg);
    border-color: var(--color-primary-outline);
  }
}

.composer__file-completion-label {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-ui-sm);
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
  font-size: var(--font-size-ui-sm);
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
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: 100%;
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
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.composer__command-item:hover,
.composer__command-item.is-selected {
  color: var(--color-primary-strong);
  background: var(--composer-selection-bg);
  border-color: var(--color-primary-outline);
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
  width: 100%;
  min-width: 0;
  min-height: var(--composer-action-control-height);
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-border-muted);
}

.composer__primary-actions {
  flex: 0 0 auto;
  margin-right: auto;
}

.composer__left-actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.composer__mode-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: var(--composer-action-control-height);
  padding: 0 5px 0 8px;
  border: 1px solid color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
  border-radius: var(--radius-sm);
  color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  font-size: var(--font-size-ui-sm);
  font-weight: 700;
  letter-spacing: 0.02em;
  min-width: 0;
  max-width: min(240px, 40vw);
  white-space: nowrap;
}

.composer__mode-chip > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.composer__mode-chip button {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.composer__mode-chip button:hover {
  background: color-mix(in srgb, var(--color-accent) 16%, transparent);
}

.composer__project-select,
.composer__model-select {
  min-width: 0;
  flex: 0 1 auto;
  overflow: hidden;
}

.composer__delivery-select {
  min-width: 0;
  flex: 0 0 auto;
}

.composer__project-select,
.composer__model-select,
.composer__thinking-select,
.composer__delivery-select {
  display: inline-flex;
  align-items: center;
  height: var(--composer-action-control-height);
  padding: 0 8px;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);
  letter-spacing: 0.01em;
  line-height: 1;
}

.composer__project-select:hover,
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

.composer__thinking-select-content {
  border-radius: var(--radius-md);
}

.composer__thinking-select-list {
  display: grid;
  gap: 1px;
}

.composer__thinking-select-item {
  min-height: 34px;
  font-size: var(--font-size-ui-xs);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  letter-spacing: 0;

  &[data-state='checked'] {
    color: var(--color-primary-strong);
    background: var(--color-primary-soft);
    border-color: color-mix(in srgb, var(--color-primary-outline) 72%, transparent);
  }

  &:focus,
  &[data-highlighted] {
    border-color: var(--color-border-strong);
  }
}

.composer__thinking-option-label {
  flex: 1 1 auto;
  min-width: 0;
  font-weight: 500;
}

.composer__project-label,
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

.composer__project-label {
  gap: 6px;
  line-height: 1.4;

  svg {
    flex: 0 0 auto;
    color: var(--color-text-muted);
  }
}

.composer__project-label-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer__project-select :deep([data-slot='select-value']),
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
  border: 1px solid transparent;
  border-radius: var(--radius-xs) !important;

  &:hover,
  &.is-active {
    color: var(--color-primary-strong);
    background: var(--color-primary-soft);
    border-color: var(--color-primary-outline);
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
  display: flex;
  flex-flow: row wrap;
  align-items: flex-start;
  gap: var(--space-2);
  min-width: 0;
}

.composer__images {
  display: flex;
  flex: 0 0 100%;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-width: 0;
}

.composer__quotes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-width: 0;
}

.composer__quote {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  height: 28px;
  padding: 0 var(--space-1) 0 var(--space-2);
  color: var(--color-text);
  font-size: var(--font-size-ui-sm);
  background: var(--color-control-track);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
}

.composer__quote-label {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer__quote-remove {
  display: grid;
  width: 16px;
  height: 16px;
  place-items: center;
  padding: 0;
  color: var(--color-text-muted);
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs);
  cursor: pointer;

  &:hover {
    color: var(--color-danger-ink);
    background: var(--color-danger);
    outline: none;
  }
}

.composer__files {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-width: 0;
}

.composer__file {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  max-width: min(320px, 100%);
  height: 28px;
  padding: 0 var(--space-1) 0 var(--space-2);
  color: var(--color-text);
  background: var(--color-control-track);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
}

.composer__file-icon {
  flex: 0 0 auto;
  color: var(--color-text-muted);
}

.composer__file-meta {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
  min-width: 0;
  white-space: nowrap;

  strong {
    min-width: 0;
    overflow: hidden;
    font-size: var(--font-size-ui-sm);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    flex: 0 0 auto;
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-xs);
    white-space: nowrap;
  }
}

.composer__file-remove {
  display: grid;
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  place-items: center;
  padding: 0;
  color: var(--color-text-muted);
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs);
  cursor: pointer;

  &:hover {
    color: var(--color-danger-ink);
    background: var(--color-danger);
    outline: none;
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
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  cursor: zoom-in;

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
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
  border-radius: var(--radius-xs);
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

.composer__overlay {
  position: relative;
  z-index: 32;
  box-sizing: border-box;
  grid-area: 1 / 1;
  align-self: end;
  display: grid;
  min-width: 0;
  overflow: visible;
  background: color-mix(in srgb, var(--color-canvas) 36%, transparent);
  pointer-events: none;
}

.composer__action {
  color: var(--color-primary-ink);
  background: var(--color-primary) !important;
  border-color: var(--color-primary-strong);
  border-radius: var(--radius-xs);
  box-shadow: 2px 2px 0 color-mix(in srgb, var(--color-primary) 24%, transparent);

  &:hover:not(:disabled) {
    color: var(--color-primary-ink);
    background: var(--color-primary-strong);
    transform: translate(-1px, -1px);
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

@container (width <= 520px) {
  .composer {
    gap: var(--space-1);
    padding: var(--space-3);
  }

  .composer__actions {
    gap: var(--space-1);
  }

  .composer__model-select {
    padding-inline: var(--space-1);
  }

  .composer__thinking-select,
  .composer__delivery-select {
    padding-inline: var(--space-1);
  }
}

@keyframes composer-action-spin {
  to {
    transform: rotate(360deg);
  }
}

.composer-footer {
  background: var(--color-surface-raised);
  margin-top: -16px;
  padding-top: 10px;
  padding-bottom: var(--space-1);
  padding-left: var(--space-2);
  border: 1px solid var(--color-border-muted);
  border-top: 0;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
}
</style>
