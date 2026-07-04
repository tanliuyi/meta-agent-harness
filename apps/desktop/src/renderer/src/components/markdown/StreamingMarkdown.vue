<script lang="ts">
import { setCustomComponents } from 'markstream-vue'
import StreamingCodeBlock from './StreamingCodeBlock.vue'
import StreamingLink from './StreamingLink.vue'
import StreamingImage from './StreamingImage.vue'
import StreamingInlineCode from './StreamingInlineCode.vue'

/**
 * 注册 markstream-vue 自定义节点组件。
 * 放在 module 顶层，只执行一次。
 */
setCustomComponents('meta-agent-markdown', {
  code_block: StreamingCodeBlock,
  link: StreamingLink,
  image: StreamingImage,
  inline_code: StreamingInlineCode
})
</script>

<script setup lang="ts">
import { computed, provide } from 'vue'
import MarkdownRender from 'markstream-vue'
import { MarkdownContextKey, type StreamingMarkdownContext } from './markdown-context'
import { useTheme } from '@renderer/composables/useTheme'

/**
 * StreamingMarkdown - 封装 markstream-vue 的流式 Markdown 渲染。
 * 负责安全策略（禁用 raw HTML、链接白名单、图片占位）、主题透传和代码块异步高亮。
 */

const props = defineProps<{
  /** Markdown 源文本。 */
  source: string
  /** 消息渲染版本号，用于区分流式更新。 */
  revision: number
  /** 是否仍在流式生成中。 */
  isStreaming: boolean
  /** 消息 ID。 */
  messageId: string
}>()

const { resolvedTheme } = useTheme()
const isDark = computed(() => resolvedTheme.value === 'dark')
const theme = computed(() => (isDark.value ? 'github-dark' : 'github-light'))

const context = computed<StreamingMarkdownContext>(() => ({
  messageId: props.messageId,
  revision: props.revision,
  isStreaming: props.isStreaming,
  isDark: isDark.value,
  theme: theme.value
}))

provide(MarkdownContextKey, context)
</script>

<template>
  <div class="streaming-markdown">
    <MarkdownRender
      custom-id="meta-agent-markdown"
      mode="chat"
      :content="source"
      :final="!isStreaming"
      html-policy="escape"
      :is-dark="isDark"
      :max-live-nodes="0"
      :batch-rendering="true"
      :render-batch-size="13"
      :render-batch-delay="8"
      :fade="false"
    />
  </div>
</template>

<style lang="scss" scoped>
.streaming-markdown {
  min-width: 0;
  color: var(--color-text);
}
</style>
