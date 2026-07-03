<script setup lang="ts">
import { computed, inject, markRaw, onMounted, ref, shallowRef, triggerRef, watch } from 'vue'
import type { Ref } from 'vue'
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'
import { shikiHighlightService } from './shiki-highlight-service'
import type { HighlightTokens } from './shiki-highlight.worker'
import { MarkdownContextKey, type StreamingMarkdownContext } from './markdown-context'

/**
 * 代码块节点类型（与 markstream-vue 内部结构保持一致）。
 */
interface CodeBlockNode {
  type: 'code_block'
  language: string
  code: string
  raw: string
  loading?: boolean
  diff?: boolean
}

/**
 * StreamingCodeBlock - 流式代码块。
 * 流式期间先显示 escaped plain code；消息完成后通过 Shiki worker 异步高亮。
 */

const props = defineProps<{
  node: CodeBlockNode
  isDark?: boolean
}>()

const context = inject<Ref<StreamingMarkdownContext>>(MarkdownContextKey)!

const highlightedTokens = shallowRef<HighlightTokens>()
const isLoading = ref(false)
const needsRetry = ref(false)
const blockId = Math.random().toString(36).slice(2)

const code = computed(() => props.node.code ?? '')
const language = computed(() => props.node.language || '')

function shouldHighlight(): boolean {
  const ctx = context.value
  if (!ctx.messageId) return false
  if (!code.value) return false
  return true
}

function applyHighlightResult(
  result: Awaited<ReturnType<typeof shikiHighlightService.highlight>>
): void {
  if (!result) return
  if (result.reset || !highlightedTokens.value) {
    highlightedTokens.value = markRaw(result.tokens)
    return
  }

  if (result.recall > 0) {
    highlightedTokens.value.splice(Math.max(0, highlightedTokens.value.length - result.recall))
  }
  if (result.tokens.length > 0) {
    highlightedTokens.value.push(...result.tokens)
  }
  triggerRef(highlightedTokens)
}

async function requestHighlight(): Promise<void> {
  if (!shouldHighlight()) return
  if (isLoading.value) {
    needsRetry.value = true
    return
  }

  const ctx = context.value
  const expectedRevision = ctx.revision
  const expectedMessageId = ctx.messageId
  const expectedTheme = ctx.theme
  const expectedCode = code.value
  const expectedStreaming = ctx.isStreaming

  isLoading.value = true
  needsRetry.value = false
  try {
    const result = await shikiHighlightService.highlight({
      messageId: expectedMessageId,
      messageRevision: expectedRevision,
      blockIndex: blockId,
      lang: language.value,
      code: expectedCode,
      theme: expectedTheme,
      streaming: expectedStreaming
    })

    if (!result) return
    // 过期结果丢弃：检查消息是否仍在当前版本且未被替换。
    if (context.value.messageId !== expectedMessageId) return
    if (context.value.theme !== expectedTheme) return
    if (expectedStreaming) {
      if (!code.value.startsWith(expectedCode)) return
    } else if (code.value !== expectedCode) {
      return
    }
    if (!expectedStreaming && context.value.revision !== expectedRevision) return

    applyHighlightResult(result)
  } finally {
    isLoading.value = false
    const shouldRetry =
      needsRetry.value || code.value !== expectedCode || context.value.theme !== expectedTheme
    needsRetry.value = false
    if (shouldRetry && shouldHighlight()) {
      void requestHighlight()
    }
  }
}

onMounted(() => {
  if (shouldHighlight()) {
    requestHighlight()
  }
})

watch(
  () => [context.value.isStreaming, context.value.theme, code.value, language.value],
  () => {
    if (shouldHighlight()) {
      requestHighlight()
    } else {
      highlightedTokens.value = undefined
    }
  },
  { flush: 'post' }
)
</script>

<template>
  <div class="streaming-code-block">
    <div v-if="language" class="streaming-code-block__header">
      <span class="streaming-code-block__lang">{{ language }}</span>
    </div>
    <ScrollArea scrollbars="horizontal" class="streaming-code-block__scroll">
      <!-- prettier-ignore -->
      <pre v-if="highlightedTokens" class="streaming-code-block__highlight"><code><span v-for="(token, tokenIndex) in highlightedTokens" :key="tokenIndex" class="streaming-code-block__token" :style="token.style">{{ token.content }}</span></code></pre>
      <pre v-else class="streaming-code-block__pre"><code>{{ code }}</code></pre>
    </ScrollArea>
  </div>
</template>

<style lang="scss" scoped>
.streaming-code-block {
  position: relative;
  margin: var(--message-markdown-code-gap, var(--message-markdown-block-gap, var(--space-2))) 0;
  background: var(--color-canvas);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.streaming-code-block__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-1) var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-sm);
  font-family: var(--font-mono);
  background: color-mix(in srgb, var(--color-surface) 86%, transparent);
  border-bottom: 1px solid var(--color-border);
}

.streaming-code-block__lang {
  text-transform: lowercase;
}

.streaming-code-block__scroll {
  width: 100%;
}

.streaming-code-block__scroll :deep([data-slot='scroll-area-viewport']) {
  width: 100%;
}

.streaming-code-block__pre,
.streaming-code-block__highlight {
  min-width: 100%;
  padding: var(--space-2) var(--space-3);
}

.streaming-code-block__pre,
.streaming-code-block__highlight {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--font-size-code);
  line-height: 1.55;
  white-space: pre;
  word-break: normal;
  background: transparent;

  code {
    font-family: inherit;
    background: transparent;
    padding: 0;
  }
}

.streaming-code-block__highlight {
  width: max-content;
  background: transparent !important;
}

.streaming-code-block__highlight code {
  display: block;
  width: max-content;
  min-width: 100%;
  font-family: inherit;
  background: transparent;
}

.streaming-code-block__token {
  white-space: pre;
}
</style>
