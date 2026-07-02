<script setup lang="ts">
/**
 * PlainTextEditor.vue - 基于 Tiptap 的纯文本 JSON 编辑器。
 */

import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor, type JSONContent } from '@tiptap/vue-3'
import { ref, watch } from 'vue'

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
    /** 是否禁用编辑器。 */
    disabled?: boolean
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
    disabled: false,
    placeholder: ''
  }
)

const emit = defineEmits<{
  /** 同步 Tiptap JSON 内容。 */
  'update:modelValue': [value: JSONContent]
  /** 同步纯文本内容。 */
  'text-change': [value: string]
  /** 触发提交快捷键。 */
  submit: [value: { json: JSONContent; text: string }]
}>()

const isApplyingExternalContent = ref(false)
const isFocused = ref(false)
const currentText = ref('')

const editor = useEditor({
  content: props.modelValue,
  editable: !props.disabled,
  extensions: [
    StarterKit.configure({
      blockquote: false,
      bold: false,
      bulletList: false,
      code: false,
      codeBlock: false,
      dropcursor: false,
      gapcursor: false,
      hardBreak: false,
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

      event.preventDefault()
      if (text) {
        view.dispatch(view.state.tr.insertText(text))
      }
      return true
    },
    handleKeyDown(_view, event) {
      if (event.key !== 'Enter' || event.shiftKey) {
        return false
      }

      event.preventDefault()
      submitContent()
      return true
    }
  },
  onUpdate({ editor: currentEditor }) {
    if (isApplyingExternalContent.value) {
      return
    }

    currentText.value = currentEditor.getText()
    emit('update:modelValue', currentEditor.getJSON())
    emit('text-change', currentText.value)
  },
  onCreate({ editor: currentEditor }) {
    currentText.value = currentEditor.getText()
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
  () => props.disabled,
  (disabled) => {
    editor.value?.setEditable(!disabled)
  }
)

watch(
  () => props.modelValue,
  (value) => {
    const currentEditor = editor.value

    if (!currentEditor) {
      return
    }

    const nextContent = value ?? emptyDocument

    if (JSON.stringify(currentEditor.getJSON()) === JSON.stringify(nextContent)) {
      return
    }

    isApplyingExternalContent.value = true
    currentEditor.commands.setContent(nextContent, { emitUpdate: false })
    currentText.value = currentEditor.getText()
    emit('text-change', currentText.value)
    isApplyingExternalContent.value = false
  },
  { deep: true }
)

/**
 * 提交当前编辑器内容。
 */
function submitContent(): void {
  const currentEditor = editor.value

  if (!currentEditor || props.disabled) {
    return
  }

  emit('submit', {
    json: currentEditor.getJSON(),
    text: currentEditor.getText()
  })
}
</script>

<template>
  <div class="plain-text-editor" :data-disabled="disabled">
    <span v-if="placeholder && !currentText && !isFocused" class="plain-text-editor__placeholder">
      {{ placeholder }}
    </span>
    <EditorContent class="plain-text-editor__content" :editor="editor" />
  </div>
</template>

<style lang="scss" scoped>
.plain-text-editor {
  position: relative;
  min-width: 0;
  color: var(--color-text);

  &[data-disabled='true'] {
    cursor: not-allowed;
    opacity: 0.72;
  }
}

.plain-text-editor__placeholder {
  position: absolute;
  top: 0;
  left: 0;
  color: var(--color-text-subtle);
  font-size: 13px;
  line-height: 1.5;
  pointer-events: none;
}

.plain-text-editor__content {
  min-width: 0;
}

:deep(.tiptap) {
  min-width: 0;
  min-height: 32px;
  border: 0;
  overflow-y: auto;
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
