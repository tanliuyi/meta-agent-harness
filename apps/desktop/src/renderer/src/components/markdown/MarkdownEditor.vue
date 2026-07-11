<script setup lang="ts">
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Undo2
} from 'lucide-vue-next'
import { onBeforeUnmount, watch } from 'vue'
import BaseIconButton from '@renderer/components/base/BaseIconButton.vue'

const props = withDefaults(
  defineProps<{
    modelValue?: string
    placeholder?: string
    autofocus?: boolean
  }>(),
  {
    modelValue: '',
    placeholder: '输入 Markdown…',
    autofocus: false
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

let applyingExternalValue = false
const editor = useEditor({
  content: props.modelValue,
  contentType: 'markdown',
  autofocus: props.autofocus ? 'end' : false,
  extensions: [StarterKit, Markdown],
  editorProps: {
    attributes: {
      class: 'markdown-editor__content',
      'data-placeholder': props.placeholder
    }
  },
  onUpdate: ({ editor: currentEditor }) => {
    if (!applyingExternalValue) emit('update:modelValue', currentEditor.getMarkdown())
  }
})

watch(
  () => props.modelValue,
  (value) => {
    if (!editor.value || value === editor.value.getMarkdown()) return
    applyingExternalValue = true
    editor.value.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
    applyingExternalValue = false
  }
)

watch(
  () => props.placeholder,
  (value) =>
    editor.value?.setOptions({ editorProps: { attributes: { 'data-placeholder': value } } })
)

onBeforeUnmount(() => editor.value?.destroy())
</script>

<template>
  <div class="markdown-editor">
    <div class="markdown-editor__toolbar" role="toolbar" aria-label="Markdown 格式">
      <BaseIconButton
        label="粗体"
        size="small"
        :active="editor?.isActive('bold')"
        @click="editor?.chain().focus().toggleBold().run()"
      >
        <Bold />
      </BaseIconButton>
      <BaseIconButton
        label="斜体"
        size="small"
        :active="editor?.isActive('italic')"
        @click="editor?.chain().focus().toggleItalic().run()"
      >
        <Italic />
      </BaseIconButton>
      <span class="markdown-editor__separator" />
      <BaseIconButton
        label="一级标题"
        size="small"
        :active="editor?.isActive('heading', { level: 1 })"
        @click="editor?.chain().focus().toggleHeading({ level: 1 }).run()"
      >
        <Heading1 />
      </BaseIconButton>
      <BaseIconButton
        label="二级标题"
        size="small"
        :active="editor?.isActive('heading', { level: 2 })"
        @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()"
      >
        <Heading2 />
      </BaseIconButton>
      <BaseIconButton
        label="无序列表"
        size="small"
        :active="editor?.isActive('bulletList')"
        @click="editor?.chain().focus().toggleBulletList().run()"
      >
        <List />
      </BaseIconButton>
      <BaseIconButton
        label="有序列表"
        size="small"
        :active="editor?.isActive('orderedList')"
        @click="editor?.chain().focus().toggleOrderedList().run()"
      >
        <ListOrdered />
      </BaseIconButton>
      <BaseIconButton
        label="引用"
        size="small"
        :active="editor?.isActive('blockquote')"
        @click="editor?.chain().focus().toggleBlockquote().run()"
      >
        <Quote />
      </BaseIconButton>
      <BaseIconButton
        label="代码块"
        size="small"
        :active="editor?.isActive('codeBlock')"
        @click="editor?.chain().focus().toggleCodeBlock().run()"
      >
        <Code />
      </BaseIconButton>
      <span class="markdown-editor__spacer" />
      <BaseIconButton
        label="撤销"
        size="small"
        :disabled="!editor?.can().undo()"
        @click="editor?.chain().focus().undo().run()"
      >
        <Undo2 />
      </BaseIconButton>
      <BaseIconButton
        label="重做"
        size="small"
        :disabled="!editor?.can().redo()"
        @click="editor?.chain().focus().redo().run()"
      >
        <Redo2 />
      </BaseIconButton>
    </div>
    <EditorContent class="markdown-editor__body" :editor="editor" />
  </div>
</template>

<style scoped lang="scss">
.markdown-editor {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--color-field);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);
}

.markdown-editor:focus-within {
  border-color: var(--color-primary);
  box-shadow: var(--shadow-focus);
}

.markdown-editor__toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 32px;
  padding: var(--space-1) var(--space-2);
  overflow-x: auto;
  background: var(--color-surface-raised);
  border-bottom: 1px solid var(--color-border);
  scrollbar-width: none;
}

.markdown-editor__toolbar::-webkit-scrollbar {
  display: none;
}

.markdown-editor__toolbar :deep(svg) {
  width: 14px;
  height: 14px;
}

.markdown-editor__separator {
  align-self: stretch;
  width: 1px;
  margin: 2px var(--space-1);
  background: var(--color-border);
}

.markdown-editor__spacer {
  flex: 1 0 var(--space-2);
}

.markdown-editor__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

:deep(.markdown-editor__content) {
  min-height: 220px;
  max-height: min(52vh, 520px);
  padding: var(--space-3);
  overflow-y: auto;
  color: var(--color-text);
  font-size: var(--font-size-ui-sm);
  line-height: 1.6;
  outline: none;
}

:deep(.markdown-editor__content > :first-child) {
  margin-top: 0;
}

:deep(.markdown-editor__content > :last-child) {
  margin-bottom: 0;
}

:deep(.markdown-editor__content p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  color: var(--color-text-subtle);
  pointer-events: none;
}

:deep(.markdown-editor__content pre) {
  padding: var(--space-3);
  overflow-x: auto;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

:deep(.markdown-editor__content code) {
  font-family: var(--font-mono);
}

:deep(.markdown-editor__content blockquote) {
  margin-left: 0;
  padding-left: var(--space-3);
  color: var(--color-text-muted);
  border-left: 2px solid var(--color-border-strong);
}
</style>
