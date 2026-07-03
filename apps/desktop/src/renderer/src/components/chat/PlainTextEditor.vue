<script setup lang="ts">
/**
 * PlainTextEditor.vue - 基于 Tiptap 的纯文本 JSON 编辑器。
 */

import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor, type JSONContent } from '@tiptap/vue-3'
import { ref, watch } from 'vue'
import ScrollArea from '../ui/scroll-area/ScrollArea.vue'

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
    placeholder: ''
  }
)

const emit = defineEmits<{
  /** 同步 Tiptap JSON 内容。 */
  'update:modelValue': [value: JSONContent]
  /** 同步纯文本内容。 */
  'text-change': [value: string]
  /** 粘贴图片文件。 */
  'paste-images': [files: File[]]
  /** 触发提交快捷键。 */
  submit: [value: { json: JSONContent; text: string }]
}>()

const isApplyingExternalContent = ref(false)
const isFocused = ref(false)
const currentText = ref('')
let lastEmittedContent: JSONContent | undefined

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
    })
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
  },
  onCreate({ editor: currentEditor }) {
    currentText.value = getPlainText(currentEditor.getJSON())
    emit('text-change', currentText.value)
  },
  onFocus() {
    isFocused.value = true
  },
  onBlur() {
    isFocused.value = false
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

    if (nextContent === lastEmittedContent || nextText === currentText.value) {
      return
    }

    isApplyingExternalContent.value = true
    currentEditor.commands.setContent(nextContent, { emitUpdate: false })
    currentText.value = nextText
    emit('text-change', currentText.value)
    isApplyingExternalContent.value = false
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

  emit('submit', {
    json: currentEditor.getJSON(),
    text: getPlainText(currentEditor.getJSON())
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
  if (typeof node.text === 'string') {
    parts.push(node.text)
  }
  for (const child of node.content ?? []) {
    collectPlainText(child, parts)
  }
}
</script>

<template>
  <div class="plain-text-editor">
    <span v-if="placeholder && !currentText && !isFocused" class="plain-text-editor__placeholder">
      {{ placeholder }}
    </span>
    <ScrollArea class="plain-text-editor__scroll">
      <EditorContent class="plain-text-editor__content" :editor="editor" />
    </ScrollArea>
  </div>
</template>

<style lang="scss" scoped>
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
  font-size: 13px;
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
  font-size: 13px;
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
}
</style>
