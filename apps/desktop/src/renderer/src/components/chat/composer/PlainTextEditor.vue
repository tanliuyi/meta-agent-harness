<script setup lang="ts">
/**
 * PlainTextEditor.vue - 基于 Tiptap 的纯文本 JSON 编辑器。
 */

import StarterKit from '@tiptap/starter-kit'
import { Node, mergeAttributes } from '@tiptap/core'
import { EditorContent, useEditor, type JSONContent } from '@tiptap/vue-3'
import { computed, ref, watch } from 'vue'
import ScrollArea from '@renderer/components/ui/scroll-area/ScrollArea.vue'
import type {
  CommandInfo,
  FileReferenceCompletionResult,
  PromptFileReferenceCandidate
} from '@shared/coding-agent/types'
import { formatFileArgForInsertion } from '@shared/coding-agent/file-reference-format'
import { isSamePlainTextEditorDocument } from './plainTextEditorDocument'

export interface FileReferenceCompletionState {
  candidates: PromptFileReferenceCandidate[]
  selectedIndex: number
}

export interface SkillReferenceCompletionCandidate {
  name: string
  label: string
  description?: string
  path?: string
  baseDir?: string
}

export interface SkillReferenceCompletionState {
  candidates: SkillReferenceCompletionCandidate[]
  selectedIndex: number
}

const emptyDocument: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph'
    }
  ]
}

const props = withDefaults(
  defineProps<{
    /** Tiptap JSON 内容。 */
    modelValue?: JSONContent
    /** 空内容提示。 */
    placeholder?: string
    /** 当前输入区绑定的 thread ID。 */
    threadId?: string
    /** 当前未绑定 thread 的 Project ID。 */
    projectId?: string
    /** 可插入的 skill command。 */
    commands?: CommandInfo[]
  }>(),
  {
    modelValue: () => ({
      type: 'doc',
      content: [
        {
          type: 'paragraph'
        }
      ]
    }),
    placeholder: '',
    threadId: undefined,
    projectId: undefined,
    commands: () => []
  }
)

const emit = defineEmits<{
  /** 同步 Tiptap JSON 内容。 */
  'update:modelValue': [value: JSONContent]
  /** 同步纯文本内容。 */
  'text-change': [value: string]
  /** 粘贴图片文件。 */
  'paste-images': [files: File[]]
  /** 同步文件引用补全候选。 */
  'file-reference-completion': [value: FileReferenceCompletionState]
  /** 同步技能引用补全候选。 */
  'skill-reference-completion': [value: SkillReferenceCompletionState]
  /** 同步编辑器焦点状态。 */
  'focus-change': [value: boolean]
  /** 触发提交快捷键。 */
  submit: [value: { json: JSONContent; text: string }]
}>()

const isApplyingExternalContent = ref(false)
const isFocused = ref(false)
const currentText = ref('')
const completion = ref<FileReferenceCompletionResult | undefined>()
const selectedCompletionIndex = ref(0)
const skillCompletion = ref<{ from: number; candidates: SkillReferenceCompletionCandidate[] }>()
const selectedSkillCompletionIndex = ref(0)
let completionTimer: ReturnType<typeof setTimeout> | undefined
let completionRequestId = 0
let lastEmittedContent: JSONContent | undefined

const completionCandidates = computed(() => completion.value?.candidates ?? [])
const skillCompletionCandidates = computed(() => skillCompletion.value?.candidates ?? [])

const FileReferenceNode = Node.create({
  name: 'fileReference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      fileArg: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-file-arg') ?? '',
        renderHTML: (attributes) => ({
          'data-file-arg': attributes.fileArg
        })
      },
      label: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-label') ?? '',
        renderHTML: (attributes) => ({
          'data-label': attributes.label
        })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-file-reference]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = getFileReferenceDisplayName(String(node.attrs.label || node.attrs.fileArg || ''))
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-file-reference': '',
        class: 'file-reference-node'
      }),
      ['span', { class: 'file-reference-node__icon' }, '@'],
      ['span', { class: 'file-reference-node__label' }, label]
    ]
  }
})

const SkillReferenceNode = Node.create({
  name: 'skillReference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      name: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-skill-name') ?? '',
        renderHTML: (attributes) => ({
          'data-skill-name': attributes.name
        })
      },
      label: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-label') ?? '',
        renderHTML: (attributes) => ({
          'data-label': attributes.label
        })
      },
      path: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-skill-path') ?? '',
        renderHTML: (attributes) => ({
          'data-skill-path': attributes.path
        })
      },
      baseDir: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-skill-base-dir') ?? '',
        renderHTML: (attributes) => ({
          'data-skill-base-dir': attributes.baseDir
        })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-skill-reference]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const name = String(node.attrs.name || '')
    const label = String(node.attrs.label || `skill:${name}`)
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-skill-reference': '',
        class: 'file-reference-node skill-reference-node'
      }),
      ['span', { class: 'file-reference-node__icon' }, '$'],
      ['span', { class: 'file-reference-node__label' }, label]
    ]
  }
})

/**
 * 获取文件引用在编辑器 chip 中展示的末级名称。
 * @param value - 文件路径或 label。
 * @returns 末级文件/文件夹名。
 */
function getFileReferenceDisplayName(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
  const separatorIndex = normalized.lastIndexOf('/')
  return separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized
}

const editor = useEditor({
  content: props.modelValue,
  editable: true,
  extensions: [
    StarterKit.configure({
      blockquote: false,
      bold: false,
      bulletList: false,
      code: false,
      codeBlock: false,
      dropcursor: false,
      gapcursor: false,
      hardBreak: {},
      heading: false,
      horizontalRule: false,
      italic: false,
      listItem: false,
      listKeymap: false,
      link: false,
      orderedList: false,
      strike: false,
      underline: false,
      trailingNode: false
    }),
    FileReferenceNode,
    SkillReferenceNode
  ],
  editorProps: {
    handlePaste(view, event) {
      const text = event.clipboardData?.getData('text/plain') ?? ''
      const imageFiles = getClipboardImageFiles(event.clipboardData)

      event.preventDefault()
      if (imageFiles.length > 0) {
        emit('paste-images', imageFiles)
      }
      if (text) {
        view.dispatch(view.state.tr.insertText(text))
      }
      return true
    },
    handleKeyDown(_view, event) {
      if (event.isComposing) {
        return false
      }
      if (skillCompletionCandidates.value.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          selectedSkillCompletionIndex.value =
            (selectedSkillCompletionIndex.value + 1) % skillCompletionCandidates.value.length
          emitSkillCompletionState()
          return true
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          selectedSkillCompletionIndex.value =
            (selectedSkillCompletionIndex.value - 1 + skillCompletionCandidates.value.length) %
            skillCompletionCandidates.value.length
          emitSkillCompletionState()
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault()
          selectSkillCompletion(skillCompletionCandidates.value[selectedSkillCompletionIndex.value])
          return true
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          closeSkillCompletion()
          return true
        }
      }
      if (completionCandidates.value.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          selectedCompletionIndex.value =
            (selectedCompletionIndex.value + 1) % completionCandidates.value.length
          emitCompletionState()
          return true
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          selectedCompletionIndex.value =
            (selectedCompletionIndex.value - 1 + completionCandidates.value.length) %
            completionCandidates.value.length
          emitCompletionState()
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault()
          selectCompletion(completionCandidates.value[selectedCompletionIndex.value])
          return true
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          closeCompletion()
          return true
        }
      }
      if (event.key !== 'Enter') {
        return false
      }

      event.preventDefault()
      if (event.shiftKey) {
        editor.value?.commands.setHardBreak()
        return true
      }

      submitContent()
      return true
    }
  },
  onUpdate({ editor: currentEditor }) {
    if (isApplyingExternalContent.value) {
      return
    }

    const nextContent = currentEditor.getJSON()
    lastEmittedContent = nextContent
    currentText.value = getPlainText(nextContent)
    emit('update:modelValue', nextContent)
    emit('text-change', currentText.value)
    refreshSkillReferenceCompletion()
    scheduleFileReferenceCompletion()
  },
  onCreate({ editor: currentEditor }) {
    const content = currentEditor.getJSON()
    currentText.value = getPlainText(content)
    emit('text-change', currentText.value)
    refreshSkillReferenceCompletion()
    scheduleFileReferenceCompletion()
  },
  onFocus() {
    isFocused.value = true
    emit('focus-change', true)
  },
  onBlur() {
    isFocused.value = false
    emit('focus-change', false)
  }
})

watch(
  () => props.modelValue,
  (value) => {
    const currentEditor = editor.value

    if (!currentEditor) {
      return
    }

    const nextContent = value ?? emptyDocument
    const nextText = getPlainText(nextContent)

    if (
      nextContent === lastEmittedContent ||
      isSamePlainTextEditorDocument(nextContent, currentEditor.getJSON())
    ) {
      return
    }

    isApplyingExternalContent.value = true
    currentEditor.commands.setContent(nextContent, { emitUpdate: false })
    currentText.value = nextText
    emit('text-change', currentText.value)
    isApplyingExternalContent.value = false
  }
)

watch(
  () => [props.threadId, props.projectId],
  () => {
    closeCompletion()
    closeSkillCompletion()
  }
)

watch(
  () => props.commands,
  () => {
    refreshSkillReferenceCompletion()
  }
)

/**
 * 提交当前编辑器内容。
 */
function submitContent(): void {
  const currentEditor = editor.value

  if (!currentEditor) {
    return
  }

  const content = currentEditor.getJSON()
  emit('submit', {
    json: content,
    text: getPlainText(content)
  })
}

/**
 * 延迟请求文件引用补全。
 */
function scheduleFileReferenceCompletion(): void {
  if (completionTimer) {
    clearTimeout(completionTimer)
  }
  completionTimer = setTimeout(() => {
    void refreshFileReferenceCompletion()
  }, 120)
}

/**
 * 刷新 $skill 引用候选。
 */
function refreshSkillReferenceCompletion(): void {
  const currentEditor = editor.value
  if (!currentEditor) {
    closeSkillCompletion()
    return
  }
  const { state } = currentEditor
  const textBeforeCursor = state.doc.textBetween(0, state.selection.from, '\n', '\n')
  const token = findSkillReferenceToken(textBeforeCursor)
  if (!token) {
    closeSkillCompletion()
    return
  }
  const query = token.query.toLowerCase()
  const candidates = props.commands
    .filter((command) => command.source === 'skill' && command.name.startsWith('skill:'))
    .filter((command) => {
      if (!query) {
        return true
      }
      return [command.name, command.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
    .slice(0, 12)
    .map((command) => ({
      name: command.name,
      label: command.name,
      description: command.description,
      path: command.sourceInfo.path,
      baseDir: command.sourceInfo.baseDir
    }))
  skillCompletion.value = candidates.length > 0 ? { from: token.from, candidates } : undefined
  selectedSkillCompletionIndex.value = 0
  emitSkillCompletionState()
}

/**
 * 查找光标前正在输入的 $skill token。
 * @param textBeforeCursor - 光标前纯文本。
 * @returns token 信息。
 */
function findSkillReferenceToken(
  textBeforeCursor: string
): { from: number; query: string } | undefined {
  const match = textBeforeCursor.match(/(^|[\s([{（【])\$([^\s$]*)$/)
  if (!match || match.index === undefined) {
    return undefined
  }
  return {
    from: match.index + match[1].length,
    query: match[2] ?? ''
  }
}

/**
 * 刷新 Pi @file 文件引用候选。
 */
async function refreshFileReferenceCompletion(): Promise<void> {
  const currentEditor = editor.value
  if (!currentEditor || (!props.threadId && !props.projectId)) {
    closeCompletion()
    return
  }
  const requestId = ++completionRequestId
  const { state } = currentEditor
  const textBeforeCursor = state.doc.textBetween(0, state.selection.from, '\n', '\n')
  if (!textBeforeCursor.includes('@')) {
    closeCompletion()
    return
  }
  const result = await window.api.codingAgent
    .completeFileReference({
      threadId: props.threadId,
      projectId: props.projectId,
      textBeforeCursor,
      limit: 12
    })
    .catch(() => undefined)
  if (requestId !== completionRequestId) {
    return
  }
  if (!result) {
    closeCompletion()
    return
  }
  completion.value = result.candidates.length > 0 ? result : undefined
  selectedCompletionIndex.value = 0
  emitCompletionState()
}

/**
 * 选择文件补全候选。
 * @param candidate - 候选。
 */
function selectCompletion(candidate: PromptFileReferenceCandidate | undefined): void {
  const currentEditor = editor.value
  const currentCompletion = completion.value
  if (!candidate || !currentEditor || currentCompletion?.from === undefined) {
    return
  }
  const insertion = {
    type: 'fileReference',
    attrs: {
      fileArg: candidate.fileArg,
      label: candidate.label
    }
  }
  const textBeforeCursor = currentEditor.state.doc.textBetween(
    0,
    currentEditor.state.selection.from,
    '\n',
    '\n'
  )
  const tokenTextLength = textBeforeCursor.length - currentCompletion.from
  const from = Math.max(1, currentEditor.state.selection.from - tokenTextLength)
  currentEditor.commands.insertContentAt({ from, to: currentEditor.state.selection.from }, [
    insertion,
    { type: 'text', text: ' ' }
  ])
  closeCompletion()
}

/**
 * 选择技能补全候选。
 * @param candidate - 候选。
 */
function selectSkillCompletion(candidate: SkillReferenceCompletionCandidate | undefined): void {
  const currentEditor = editor.value
  const currentCompletion = skillCompletion.value
  if (!candidate || !currentEditor || currentCompletion?.from === undefined) {
    return
  }
  const insertion = {
    type: 'skillReference',
    attrs: {
      name: candidate.name,
      label: candidate.label,
      path: candidate.path,
      baseDir: candidate.baseDir
    }
  }
  const textBeforeCursor = currentEditor.state.doc.textBetween(
    0,
    currentEditor.state.selection.from,
    '\n',
    '\n'
  )
  const tokenTextLength = textBeforeCursor.length - currentCompletion.from
  const from = Math.max(1, currentEditor.state.selection.from - tokenTextLength)
  currentEditor.commands.insertContentAt({ from, to: currentEditor.state.selection.from }, [
    insertion,
    { type: 'text', text: ' ' }
  ])
  closeSkillCompletion()
}

/**
 * 从外层 Composer 选择当前文件补全候选。
 * @param candidate - 候选。
 */
function selectFileReferenceCompletion(candidate: PromptFileReferenceCandidate | undefined): void {
  selectCompletion(candidate)
}

/**
 * 从外层 Composer 选择当前技能补全候选。
 * @param candidate - 候选。
 */
function selectSkillReferenceCompletion(
  candidate: SkillReferenceCompletionCandidate | undefined
): void {
  selectSkillCompletion(candidate)
}

/**
 * 在当前光标位置插入文件引用。
 * @param paths - 文件路径列表。
 */
function insertFileReferences(paths: string[]): void {
  const currentEditor = editor.value
  const filePaths = paths.map((path) => path.trim()).filter(Boolean)
  if (!currentEditor || filePaths.length === 0) {
    return
  }

  currentEditor.commands.focus()
  currentEditor.commands.insertContent(
    filePaths.flatMap((path) => [
      {
        type: 'fileReference',
        attrs: {
          fileArg: path,
          label: path
        }
      },
      { type: 'text', text: ' ' }
    ])
  )
  closeCompletion()
}

/**
 * 从外层 Composer 同步当前高亮候选。
 * @param index - 候选索引。
 */
function setFileReferenceCompletionIndex(index: number): void {
  if (index < 0 || index >= completionCandidates.value.length) {
    return
  }
  selectedCompletionIndex.value = index
  emitCompletionState()
}

/**
 * 从外层 Composer 同步当前技能高亮候选。
 * @param index - 候选索引。
 */
function setSkillReferenceCompletionIndex(index: number): void {
  if (index < 0 || index >= skillCompletionCandidates.value.length) {
    return
  }
  selectedSkillCompletionIndex.value = index
  emitSkillCompletionState()
}

/**
 * 关闭文件补全。
 */
function closeFileReferenceCompletion(): void {
  closeCompletion()
}

/**
 * 关闭技能补全。
 */
function closeSkillReferenceCompletion(): void {
  closeSkillCompletion()
}

/**
 * 将焦点恢复到编辑器。
 */
function focusEditor(): void {
  editor.value?.commands.focus()
}

/**
 * 关闭文件补全浮层。
 */
function closeCompletion(): void {
  completionRequestId++
  if (completionTimer) {
    clearTimeout(completionTimer)
    completionTimer = undefined
  }
  completion.value = undefined
  selectedCompletionIndex.value = 0
  emitCompletionState()
}

/**
 * 关闭技能补全浮层。
 */
function closeSkillCompletion(): void {
  skillCompletion.value = undefined
  selectedSkillCompletionIndex.value = 0
  emitSkillCompletionState()
}

/**
 * 向 Composer 同步文件补全展示状态。
 */
function emitCompletionState(): void {
  emit('file-reference-completion', {
    candidates: completionCandidates.value,
    selectedIndex: selectedCompletionIndex.value
  })
}

/**
 * 向 Composer 同步技能补全展示状态。
 */
function emitSkillCompletionState(): void {
  emit('skill-reference-completion', {
    candidates: skillCompletionCandidates.value,
    selectedIndex: selectedSkillCompletionIndex.value
  })
}

/**
 * 从 Tiptap JSON 中提取纯文本，保留 hardBreak 换行。
 * @param content - Tiptap JSON 内容。
 * @returns 纯文本。
 */
function getPlainText(content: JSONContent): string {
  const parts: string[] = []
  collectPlainText(content, parts)
  return parts.join('')
}

/**
 * 从剪贴板中提取图片文件。
 * @param clipboardData - 剪贴板数据。
 * @returns 图片文件列表。
 */
function getClipboardImageFiles(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) {
    return []
  }
  const files: File[] = []
  for (const item of clipboardData.items) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) {
      continue
    }
    const file = item.getAsFile()
    if (file) {
      files.push(file)
    }
  }
  if (files.length > 0) {
    return files
  }
  return [...clipboardData.files].filter((file) => file.type.startsWith('image/'))
}

/**
 * 递归收集 Tiptap 文本节点。
 * @param node - Tiptap JSON 节点。
 * @param parts - 文本片段。
 */
function collectPlainText(node: JSONContent, parts: string[]): void {
  if (node.type === 'hardBreak') {
    parts.push('\n')
    return
  }
  if (node.type === 'fileReference') {
    const fileArg = typeof node.attrs?.fileArg === 'string' ? node.attrs.fileArg : ''
    if (fileArg) {
      parts.push(formatFileArgForInsertion(fileArg))
    }
    return
  }
  if (node.type === 'skillReference') {
    const name = typeof node.attrs?.name === 'string' ? node.attrs.name : ''
    if (name) {
      parts.push(`$${name}`)
    }
    return
  }
  if (typeof node.text === 'string') {
    parts.push(node.text)
  }
  for (const child of node.content ?? []) {
    collectPlainText(child, parts)
  }
}

defineExpose({
  closeFileReferenceCompletion,
  closeSkillReferenceCompletion,
  focusEditor,
  insertFileReferences,
  selectFileReferenceCompletion,
  selectSkillReferenceCompletion,
  setSkillReferenceCompletionIndex,
  setFileReferenceCompletionIndex
})
</script>

<template>
  <div class="plain-text-editor">
    <span v-if="placeholder && !currentText" class="plain-text-editor__placeholder">
      {{ placeholder }}
    </span>
    <ScrollArea class="plain-text-editor__scroll">
      <EditorContent class="plain-text-editor__content" :editor="editor" />
    </ScrollArea>
  </div>
</template>

<style lang="scss" scoped>
@use '../file-reference-node';

.plain-text-editor {
  position: relative;
  min-width: 0;
  color: var(--color-text);
}

.plain-text-editor__placeholder {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  color: var(--color-text-subtle);
  font-size: var(--font-size-ui);
  line-height: 1.5;
  pointer-events: none;
}

.plain-text-editor__scroll {
  width: 100%;
  max-height: 168px;
}

.plain-text-editor__scroll :deep([data-slot='scroll-area-viewport']) {
  height: auto;
  max-height: inherit;
}

.plain-text-editor__content {
  min-width: 0;
}

:deep(.tiptap) {
  min-width: 0;
  min-height: 32px;
  border: 0;
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-ui);
  line-height: 1.6;
  outline: none;
  box-shadow: none;
  white-space: pre-wrap;
  word-break: break-word;

  &:focus,
  &.ProseMirror-focused {
    border: 0;
    outline: none;
    box-shadow: none;
  }

  p {
    margin: 0;
  }

  p + p {
    margin-top: 0.35em;
  }

  .file-reference-node {
    @include file-reference-node.file-reference-node;
  }

  .file-reference-node.ProseMirror-selectednode {
    @include file-reference-node.file-reference-node-selected;
  }

  .file-reference-node__icon {
    @include file-reference-node.file-reference-node-icon;
  }

  .file-reference-node__label {
    @include file-reference-node.file-reference-node-label;
  }
}
</style>
