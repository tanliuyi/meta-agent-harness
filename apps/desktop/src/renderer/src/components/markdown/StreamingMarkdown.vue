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
import {
  computed,
  onBeforeUnmount,
  provide,
  ref,
  shallowRef,
  watch,
  type ComponentPublicInstance,
  type CSSProperties
} from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { useVirtualizer } from '@tanstack/vue-virtual'
import MarkdownRender, {
  getMarkdown,
  parseMarkdownToStructure,
  type NodeRendererProps
} from 'markstream-vue'
import { MarkdownContextKey, type StreamingMarkdownContext } from './markdown-context'
import {
  canReuseMarkdownAppendPrefix,
  createVirtualMarkdownChunkRows,
  stabilizeMarkdownNodeChunks,
  stabilizeMarkdownNodes,
  type StableMarkdownNodeChunk,
  type StableMarkdownNodes
} from './streamingMarkdownProjection'
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
  /** 可选的受限滚动 viewport，仅 Thinking 使用。 */
  getVirtualScrollElement?: () => HTMLElement | null | undefined
}>()

const emit = defineEmits<{
  heightChange: []
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

type ParsedMarkdownNodes = NonNullable<NodeRendererProps['nodes']>
type ParsedMarkdownNode = ParsedMarkdownNodes[number]

const PARSE_COALESCE_MS = 80
const STREAMING_CHUNK_SIZE = 16
const VIRTUAL_CHUNK_THRESHOLD = 4
const VIRTUAL_CHUNK_ESTIMATED_SIZE = 320
const VIRTUAL_CHUNK_OVERSCAN = 2
const markdown = getMarkdown()
const markdownRootRef = ref<HTMLElement>()
const usesChunkedRendering = ref(props.isStreaming || Boolean(props.getVirtualScrollElement))
const parsedNodes = shallowRef<ParsedMarkdownNodes>([])
const parsedNodeChunks = shallowRef<StableMarkdownNodeChunk<ParsedMarkdownNode>[]>([])
let stableProjection: StableMarkdownNodes<ParsedMarkdownNode> | undefined
let stableChunks: StableMarkdownNodeChunk<ParsedMarkdownNode>[] | undefined
let parseTimerId: ReturnType<typeof setTimeout> | undefined
let lastParsedSource = ''
let lastParseWasStreaming = false
let lastParseAt = Number.NEGATIVE_INFINITY

const shouldVirtualizeChunks = computed(
  () =>
    usesChunkedRendering.value &&
    Boolean(props.getVirtualScrollElement) &&
    parsedNodeChunks.value.length >= VIRTUAL_CHUNK_THRESHOLD
)
const chunkVirtualizer = useVirtualizer(
  computed(() => ({
    count: shouldVirtualizeChunks.value ? parsedNodeChunks.value.length : 0,
    getScrollElement: () => props.getVirtualScrollElement?.() ?? null,
    getItemKey: (index: number) => parsedNodeChunks.value[index]?.key ?? index,
    estimateSize: () => VIRTUAL_CHUNK_ESTIMATED_SIZE,
    overscan: VIRTUAL_CHUNK_OVERSCAN,
    scrollMargin: markdownRootRef.value?.offsetTop ?? 0
  }))
)
const virtualChunkRows = computed(() =>
  createVirtualMarkdownChunkRows(chunkVirtualizer.value.getVirtualItems(), parsedNodeChunks.value)
)
const virtualChunkContainerStyle = computed<CSSProperties>(() => ({
  height: `${chunkVirtualizer.value.getTotalSize()}px`
}))

function measureVirtualChunk(refValue: Element | ComponentPublicInstance | null): void {
  const element = refValue instanceof Element ? refValue : refValue?.$el
  if (element instanceof Element) {
    chunkVirtualizer.value.measureElement(element)
  }
}

function getVirtualChunkStyle(start: number): CSSProperties {
  return {
    transform: `translateY(${start - (chunkVirtualizer.value.options.scrollMargin ?? 0)}px)`
  }
}

function parseLatestSource(): void {
  parseTimerId = undefined
  const source = props.source
  const isStreaming = props.isStreaming
  const nodes = parseMarkdownToStructure(source, markdown, {
    final: !isStreaming,
    streamParse: 'auto'
  }) as ParsedMarkdownNodes
  const canReuseAppendPrefix =
    isStreaming && lastParseWasStreaming && canReuseMarkdownAppendPrefix(lastParsedSource, source)
  const stablePrefixLength = canReuseAppendPrefix
    ? Math.max(0, Math.min(stableProjection?.nodes.length ?? 0, nodes.length) - 1)
    : 0
  stableProjection = stabilizeMarkdownNodes(nodes, stableProjection, { stablePrefixLength })
  stableChunks = stabilizeMarkdownNodeChunks(
    stableProjection.nodes,
    stableChunks,
    STREAMING_CHUNK_SIZE
  )
  parsedNodes.value = stableProjection.nodes
  parsedNodeChunks.value = stableChunks
  lastParsedSource = source
  lastParseWasStreaming = isStreaming
  lastParseAt = performance.now()
}

function scheduleSourceParse(immediate: boolean): void {
  if (immediate && parseTimerId !== undefined) {
    clearTimeout(parseTimerId)
    parseTimerId = undefined
  }
  const delay = PARSE_COALESCE_MS - (performance.now() - lastParseAt)
  if (immediate || delay <= 0) {
    parseLatestSource()
    return
  }
  parseTimerId ??= setTimeout(parseLatestSource, delay)
}

watch(
  () => [props.source, props.isStreaming] as const,
  ([, isStreaming], previous) => {
    scheduleSourceParse(!isStreaming || previous?.[1] !== isStreaming)
  },
  { immediate: true, flush: 'sync' }
)

watch(
  () => props.getVirtualScrollElement,
  (getVirtualScrollElement) => {
    if (getVirtualScrollElement) {
      usesChunkedRendering.value = true
    }
  },
  { immediate: true }
)

useResizeObserver(markdownRootRef, () => emit('heightChange'))

onBeforeUnmount(() => {
  if (parseTimerId !== undefined) {
    clearTimeout(parseTimerId)
  }
})
</script>

<template>
  <div ref="markdownRootRef" class="streaming-markdown">
    <template v-if="usesChunkedRendering">
      <div
        v-if="shouldVirtualizeChunks"
        class="streaming-markdown__virtual-size"
        :style="virtualChunkContainerStyle"
      >
        <div
          v-for="{ chunk, virtualItem } in virtualChunkRows"
          :key="chunk.key"
          :ref="measureVirtualChunk"
          v-memo="[chunk, virtualItem.start, isStreaming, isDark]"
          :data-index="virtualItem.index"
          class="streaming-markdown__virtual-chunk"
          :style="getVirtualChunkStyle(virtualItem.start)"
        >
          <MarkdownRender
            custom-id="meta-agent-markdown"
            mode="chat"
            :nodes="chunk.nodes"
            :index-key="`${messageId}:${chunk.key}`"
            :final="!isStreaming"
            html-policy="escape"
            :is-dark="isDark"
            :render-as-fragment="true"
            :max-live-nodes="0"
            :smooth-streaming="false"
            :batch-rendering="false"
            :fade="false"
          />
        </div>
      </div>
      <template v-else>
        <MarkdownRender
          v-for="chunk in parsedNodeChunks"
          :key="chunk.key"
          v-memo="[chunk, isStreaming, isDark]"
          custom-id="meta-agent-markdown"
          mode="chat"
          :nodes="chunk.nodes"
          :index-key="`${messageId}:${chunk.key}`"
          :final="!isStreaming"
          html-policy="escape"
          :is-dark="isDark"
          :render-as-fragment="true"
          :max-live-nodes="0"
          :smooth-streaming="false"
          :batch-rendering="false"
          :fade="false"
        />
      </template>
    </template>
    <MarkdownRender
      v-else
      custom-id="meta-agent-markdown"
      mode="chat"
      :nodes="parsedNodes"
      :final="!isStreaming"
      html-policy="escape"
      :is-dark="isDark"
      :max-live-nodes="0"
      :smooth-streaming="false"
      :batch-rendering="true"
      :render-batch-size="13"
      :render-batch-delay="8"
      :render-batch-budget-ms="4"
      :fade="false"
      @height-change="emit('heightChange')"
    />
  </div>
</template>

<style lang="scss" scoped>
.streaming-markdown {
  min-width: 0;
  color: var(--color-text);
}

.streaming-markdown__virtual-size {
  position: relative;
  width: 100%;
}

.streaming-markdown__virtual-chunk {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
}
</style>
