<script setup lang="ts">
import type { PreparedTextWithSegments } from '@chenglou/pretext'
import type { PreparedRichInline, RichInlineItem } from '@chenglou/pretext/rich-inline'
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from 'vue'
import type { ThreadMessage } from '@shared/coding-agent/types'
import {
  formatMessageTime,
  getMessageFileAttachments,
  getMessageImageSrc,
  getMessageText,
  getStandaloneMessageImages,
  getUserMessageDisplaySegments
} from './support/message-format'
import type { ImagePreviewItem } from '../ImagePreviewDialog.vue'
import BaseIconButton from '@/components/base/BaseIconButton.vue'
import SkillIcon from '@/components/icons/SkillIcon.vue'
import {
  Check,
  Copy,
  File as FileIcon,
  GitFork,
  MapPin,
  Quote,
  Target,
  TextCursorInput
} from 'lucide-vue-next'

const COLLAPSED_MAX_HEIGHT = 320
const USER_MESSAGE_MAX_WIDTH = 640
const USER_MESSAGE_MAX_RATIO = 0.88
const FILE_REFERENCE_FALLBACK_EXTRA_WIDTH = 36
const TIGHT_WIDTH_MAX_TEXT_LENGTH = 360
const TIGHT_WIDTH_MAX_SEGMENT_COUNT = 8
const ImagePreviewDialog = defineAsyncComponent({
  loader: () => import('../ImagePreviewDialog.vue'),
  suspensible: false
})

const props = defineProps<{
  message: ThreadMessage
  /** 是否正在导航到这条消息。 */
  isNavigatingTree?: boolean
}>()

const emit = defineEmits<{
  forkFromMessage: [entryId: string]
  locateInTree: [entryId: string]
  navigateTree: [entryId: string]
}>()

const fileAttachments = computed(() => getMessageFileAttachments(props.message))
const standaloneImages = computed(() => getStandaloneMessageImages(props.message))
const imagePreviewDialogOpen = ref(false)
const imagePreviewInitialIndex = ref(0)
const attachmentPreviewCount = computed(
  () => fileAttachments.value.filter((attachment) => Boolean(attachment.imageSrc)).length
)
const allDisplaySegments = computed(() => getUserMessageDisplaySegments(props.message))
const quoteSegments = computed(() =>
  allDisplaySegments.value.filter((segment) => segment.type === 'quoteReference')
)
const displaySegments = computed(() => {
  const segments = allDisplaySegments.value.filter((segment) => segment.type !== 'quoteReference')
  const first = segments[0]
  if (first?.type === 'text') {
    const text = first.text.replace(/^\s+/, '')
    return text ? [{ ...first, text }, ...segments.slice(1)] : segments.slice(1)
  }
  return segments
})
const displaySegmentsKey = computed(() => getDisplaySegmentsKey(displaySegments.value))
const displayText = computed(() =>
  displaySegments.value
    .map((segment) => {
      if (segment.type === 'text') return segment.text
      if (segment.type === 'fileReference') return `@${segment.fileArg}`
      return segment.label
    })
    .join('')
    .trim()
)
const hasMediaBubble = computed(
  () => fileAttachments.value.length > 0 || standaloneImages.value.length > 0
)
const shouldMeasureBubble = computed(
  () =>
    displayText.value.length > 0 &&
    displayText.value.length <= TIGHT_WIDTH_MAX_TEXT_LENGTH &&
    displaySegments.value.length <= TIGHT_WIDTH_MAX_SEGMENT_COUNT
)
const formattedTime = computed(() => formatMessageTime(props.message.createdAt))
const imagePreviewItems = computed<ImagePreviewItem[]>(() => [
  ...fileAttachments.value.flatMap((attachment): ImagePreviewItem[] =>
    attachment.imageSrc
      ? [
          {
            src: attachment.imageSrc,
            alt: attachment.name,
            title: attachment.name,
            meta: attachment.note
          }
        ]
      : []
  ),
  ...standaloneImages.value.map((image, index) => ({
    src: getMessageImageSrc(image),
    alt: `Image ${index + 1}`,
    title: `Image ${index + 1}`,
    meta: image.mimeType
  }))
])

const isCopied = ref(false)
let copyTimeout: ReturnType<typeof setTimeout> | null = null

async function copyMessageText(): Promise<void> {
  const text = getMessageText(props.message)
  if (!text) return

  try {
    await navigator.clipboard.writeText(text)
    isCopied.value = true
    if (copyTimeout) clearTimeout(copyTimeout)
    copyTimeout = setTimeout(() => {
      isCopied.value = false
    }, 1000)
  } catch (err) {
    console.error('Failed to copy message:', err)
  }
}

function forkFromMessage(): void {
  if (!props.message.sessionEntryId) return
  emit('forkFromMessage', props.message.sessionEntryId)
}

function locateInTree(): void {
  if (!props.message.sessionEntryId) return
  emit('locateInTree', props.message.sessionEntryId)
}

function navigateTree(): void {
  if (!props.message.sessionEntryId) return
  emit('navigateTree', props.message.sessionEntryId)
}

function openImagePreview(index: number): void {
  imagePreviewInitialIndex.value = index
  imagePreviewDialogOpen.value = true
}

function getAttachmentPreviewIndex(attachmentIndex: number): number {
  return fileAttachments.value
    .slice(0, attachmentIndex)
    .filter((attachment) => Boolean(attachment.imageSrc)).length
}

const isExpanded = ref(false)
const isOverflowing = ref(false)
const contentRef = ref<HTMLElement>()
const measuredBubbleWidth = ref<string>()
let resizeObserver: ResizeObserver | null = null
let measureRaf: number | null = null
let measureGeneration = 0
let isDisposed = false
let preparedCache: {
  font: string
  letterSpacing: number
  key: string
  prepared: PreparedMessageText
} | null = null
let pretextModulesPromise: Promise<PretextModules> | null = null

type PretextModules = {
  measureLineStats: (typeof import('@chenglou/pretext'))['measureLineStats']
  measureRichInlineStats: (typeof import('@chenglou/pretext/rich-inline'))['measureRichInlineStats']
  prepareRichInline: (typeof import('@chenglou/pretext/rich-inline'))['prepareRichInline']
  prepareWithSegments: (typeof import('@chenglou/pretext'))['prepareWithSegments']
}

type PreparedMessageText =
  | {
      kind: 'plain'
      value: PreparedTextWithSegments
    }
  | {
      kind: 'rich'
      value: PreparedRichInline
    }

function checkOverflow(): void {
  if (!contentRef.value) return
  const body = contentRef.value.querySelector('.user-message__body')
  if (!body) return
  isOverflowing.value = body.scrollHeight > COLLAPSED_MAX_HEIGHT + 1
}

function scheduleMeasure(): void {
  if (measureRaf !== null) return
  measureRaf = window.requestAnimationFrame(() => {
    measureRaf = null
    void measureBubbleWidth()
  })
}

async function measureBubbleWidth(): Promise<void> {
  const bubble = contentRef.value
  if (!bubble || !shouldMeasureBubble.value) {
    measuredBubbleWidth.value = undefined
    void nextTick(checkOverflow)
    return
  }

  const textElement = bubble.querySelector<HTMLElement>('.user-message__text')
  const containerWidth = getMessageLaneWidth(bubble)
  if (!textElement || containerWidth <= 0) {
    measuredBubbleWidth.value = undefined
    void nextTick(checkOverflow)
    return
  }

  const bubbleStyle = window.getComputedStyle(bubble)
  const textStyle = window.getComputedStyle(textElement)
  const maxBubbleWidth = Math.min(
    USER_MESSAGE_MAX_WIDTH,
    Math.floor(containerWidth * USER_MESSAGE_MAX_RATIO)
  )
  const horizontalChrome =
    readPixelValue(bubbleStyle.paddingLeft) +
    readPixelValue(bubbleStyle.paddingRight) +
    readPixelValue(bubbleStyle.borderLeftWidth) +
    readPixelValue(bubbleStyle.borderRightWidth)
  const maxContentWidth = Math.max(1, maxBubbleWidth - horizontalChrome)
  const letterSpacing = readLetterSpacing(textStyle.letterSpacing)
  const generation = measureGeneration
  const pretext = await loadPretextModules()
  if (
    isDisposed ||
    generation !== measureGeneration ||
    !contentRef.value ||
    !shouldMeasureBubble.value
  ) {
    return
  }
  const prepared = getPreparedText(textElement, getCanvasFont(textStyle), letterSpacing, pretext)
  const tightContentWidth = findTightContentWidth(prepared, maxContentWidth, pretext)
  const bubbleWidth = Math.min(maxBubbleWidth, Math.ceil(tightContentWidth + horizontalChrome))

  const nextWidth = `${Math.max(1, bubbleWidth)}px`
  if (measuredBubbleWidth.value !== nextWidth) {
    measuredBubbleWidth.value = nextWidth
  }
  void nextTick(checkOverflow)
}

function getMessageLaneWidth(bubble: HTMLElement): number {
  const lane = bubble.closest<HTMLElement>('.chat-view__message')
  return (
    lane?.getBoundingClientRect().width ?? bubble.parentElement?.getBoundingClientRect().width ?? 0
  )
}

function getPreparedText(
  textElement: HTMLElement,
  font: string,
  letterSpacing: number,
  pretext: PretextModules
): PreparedMessageText {
  const key = getPreparedCacheKey(font, letterSpacing)
  if (
    preparedCache?.key === key &&
    preparedCache.font === font &&
    preparedCache.letterSpacing === letterSpacing
  ) {
    return preparedCache.prepared
  }

  const richItems = getRichInlineItems(textElement, font, letterSpacing)
  const prepared =
    richItems === null
      ? ({
          kind: 'plain',
          value: pretext.prepareWithSegments(displayText.value, font, {
            letterSpacing,
            whiteSpace: 'pre-wrap'
          })
        } satisfies PreparedMessageText)
      : ({
          kind: 'rich',
          value: pretext.prepareRichInline(richItems)
        } satisfies PreparedMessageText)
  preparedCache = { font, key, letterSpacing, prepared }
  return prepared
}

function getPreparedCacheKey(font: string, letterSpacing: number): string {
  return JSON.stringify({
    font,
    letterSpacing,
    segments: displaySegmentsKey.value
  })
}

function getRichInlineItems(
  textElement: HTMLElement,
  textFont: string,
  textLetterSpacing: number
): RichInlineItem[] | null {
  if (!displaySegments.value.some((segment) => segment.type !== 'text')) {
    return null
  }

  const fileReferenceElement = textElement.querySelector<HTMLElement>('.file-reference-node')
  const fileReferenceLabel = textElement.querySelector<HTMLElement>('.file-reference-node__label')
  const fileReferenceStyle = fileReferenceElement
    ? window.getComputedStyle(fileReferenceElement)
    : null
  const fileReferenceLabelStyle = fileReferenceLabel
    ? window.getComputedStyle(fileReferenceLabel)
    : null
  const fileReferenceFont = fileReferenceLabelStyle
    ? getCanvasFont(fileReferenceLabelStyle)
    : textFont
  const fileReferenceLetterSpacing = fileReferenceLabelStyle
    ? readLetterSpacing(fileReferenceLabelStyle.letterSpacing)
    : textLetterSpacing
  const fileReferenceExtraWidth =
    fileReferenceElement && fileReferenceLabel
      ? Math.max(
          0,
          fileReferenceElement.getBoundingClientRect().width -
            fileReferenceLabel.getBoundingClientRect().width
        )
      : FILE_REFERENCE_FALLBACK_EXTRA_WIDTH
  const fileReferenceMargin =
    fileReferenceStyle === null
      ? 0
      : readPixelValue(fileReferenceStyle.marginLeft) +
        readPixelValue(fileReferenceStyle.marginRight)

  return displaySegments.value.map((segment) =>
    segment.type === 'text'
      ? {
          font: textFont,
          letterSpacing: textLetterSpacing,
          text: segment.text
        }
      : {
          break: 'never',
          extraWidth: fileReferenceExtraWidth + fileReferenceMargin,
          font: fileReferenceFont,
          letterSpacing: fileReferenceLetterSpacing,
          text: segment.label
        }
  )
}

function findTightContentWidth(
  prepared: PreparedMessageText,
  maxWidth: number,
  pretext: PretextModules
): number {
  const initialLineCount = measureTextStats(prepared, maxWidth, pretext).lineCount
  if (initialLineCount === 0) return 0

  let lo = 1
  let hi = Math.max(1, Math.ceil(maxWidth))
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const lineCount = measureTextStats(prepared, mid, pretext).lineCount
    if (lineCount <= initialLineCount) {
      hi = mid
    } else {
      lo = mid + 1
    }
  }

  return measureTextStats(prepared, lo, pretext).maxLineWidth
}

function measureTextStats(
  prepared: PreparedMessageText,
  maxWidth: number,
  pretext: PretextModules
): {
  lineCount: number
  maxLineWidth: number
} {
  return prepared.kind === 'plain'
    ? pretext.measureLineStats(prepared.value, maxWidth)
    : pretext.measureRichInlineStats(prepared.value, maxWidth)
}

function getCanvasFont(style: CSSStyleDeclaration): string {
  if (style.font) return style.font
  const fontStyle = style.fontStyle || 'normal'
  const fontVariant = style.fontVariant || 'normal'
  const fontWeight = style.fontWeight || '400'
  const fontSize = style.fontSize || '14px'
  const fontFamily = style.fontFamily || 'sans-serif'
  return `${fontStyle} ${fontVariant} ${fontWeight} ${fontSize} ${fontFamily}`
}

function readLetterSpacing(value: string): number {
  return value === 'normal' ? 0 : readPixelValue(value)
}

function readPixelValue(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function getDisplaySegmentsKey(segments: RichInlineDisplaySegment[]): string {
  return segments
    .map((segment) => {
      if (segment.type === 'text') {
        return `text:${segment.text.length}:${getTextKeySample(segment.text)}`
      }
      if (segment.type === 'fileReference') {
        return `file:${segment.fileArg}:${segment.label}`
      }
      if (segment.type === 'skillReference') {
        return `skill:${segment.name}:${segment.label}:${segment.location}`
      }
      return `quote:${segment.messageId ?? ''}:${segment.sessionEntryId ?? ''}:${getTextKeySample(segment.text)}`
    })
    .join('\n')
}

function getTextKeySample(text: string): string {
  if (text.length <= TIGHT_WIDTH_MAX_TEXT_LENGTH) {
    return text
  }
  return `${text.slice(0, 64)}…${text.slice(-64)}`
}

type RichInlineDisplaySegment = ReturnType<typeof getUserMessageDisplaySegments>[number]

function loadPretextModules(): Promise<PretextModules> {
  pretextModulesPromise ??= Promise.all([
    import('@chenglou/pretext'),
    import('@chenglou/pretext/rich-inline')
  ]).then(([text, rich]) => ({
    measureLineStats: text.measureLineStats,
    measureRichInlineStats: rich.measureRichInlineStats,
    prepareRichInline: rich.prepareRichInline,
    prepareWithSegments: text.prepareWithSegments
  }))
  return pretextModulesPromise
}

watch([displayText, shouldMeasureBubble, displaySegmentsKey], () => {
  measureGeneration += 1
  preparedCache = null
  void nextTick(scheduleMeasure)
})

onMounted(() => {
  scheduleMeasure()
  resizeObserver = new ResizeObserver(scheduleMeasure)
  const lane = contentRef.value?.closest<HTMLElement>('.chat-view__message')
  if (lane) {
    resizeObserver.observe(lane)
  } else if (contentRef.value?.parentElement) {
    resizeObserver.observe(contentRef.value.parentElement)
  }
  void document.fonts.ready.then(scheduleMeasure)
})

onBeforeUnmount(() => {
  isDisposed = true
  measureGeneration += 1
  if (copyTimeout) clearTimeout(copyTimeout)
  if (measureRaf !== null) window.cancelAnimationFrame(measureRaf)
  resizeObserver?.disconnect()
})

function toggleExpand(): void {
  isExpanded.value = !isExpanded.value
}
</script>

<template>
  <div class="message is-user-message">
    <div class="user-message-stack">
      <div v-if="hasMediaBubble" class="user-message user-message--media">
        <div class="user-message__body">
          <div v-if="fileAttachments.length > 0" class="user-message__attachments">
            <div
              v-for="(attachment, index) in fileAttachments"
              :key="`${attachment.name}-${index}`"
              class="user-message__attachment"
              :class="{ 'user-message__attachment--image': attachment.imageSrc }"
            >
              <button
                v-if="attachment.imageSrc"
                class="user-message__image-preview"
                type="button"
                :aria-label="`预览 ${attachment.name}`"
                @click="openImagePreview(getAttachmentPreviewIndex(index))"
              >
                <img class="user-message__attachment-image" :src="attachment.imageSrc" alt="" />
              </button>
              <template v-else>
                <FileIcon :size="16" class="user-message__attachment-icon" />
                <div class="user-message__attachment-meta">
                  <div class="user-message__attachment-name" :title="attachment.name">
                    {{ attachment.name }}
                  </div>
                  <div v-if="attachment.note" class="user-message__attachment-note">
                    {{ attachment.note }}
                  </div>
                </div>
              </template>
            </div>
          </div>
          <div v-if="standaloneImages.length > 0" class="user-message__images">
            <button
              v-for="(image, index) in standaloneImages"
              :key="`${image.mimeType}-${index}`"
              class="user-message__image-preview"
              type="button"
              :aria-label="`预览图片 ${index + 1}`"
              @click="openImagePreview(attachmentPreviewCount + index)"
            >
              <img :src="getMessageImageSrc(image)" alt="" />
            </button>
          </div>
        </div>
      </div>
      <ImagePreviewDialog
        v-if="imagePreviewDialogOpen"
        v-model:open="imagePreviewDialogOpen"
        :images="imagePreviewItems"
        :initial-index="imagePreviewInitialIndex"
      />
      <div v-if="quoteSegments.length > 0" class="user-message user-message--quotes">
        <div class="user-message__quotes">
          <div
            v-for="(segment, index) in quoteSegments"
            :key="index"
            class="quote-reference-node"
            :class="{ 'is-browser-element': segment.kind === 'browser-element' }"
            :title="segment.browserRef"
          >
            <Target v-if="segment.kind === 'browser-element'" :size="12" aria-hidden="true" />
            <Quote v-else :size="12" aria-hidden="true" />
            <div class="quote-reference-node__text">
              {{
                segment.kind === 'browser-element'
                  ? `<${segment.tagName || 'element'}>${segment.label ? ` ${segment.label}` : ''}`
                  : segment.text
              }}
            </div>
          </div>
        </div>
      </div>
      <div
        v-if="displaySegments.length > 0"
        ref="contentRef"
        class="user-message user-message--text"
        :class="{ 'user-message--collapsed': isOverflowing && !isExpanded }"
        :style="{ '--user-message-tight-width': measuredBubbleWidth }"
      >
        <div class="user-message__body">
          <div class="user-message__text">
            <template v-for="(segment, index) in displaySegments" :key="index">
              <span v-if="segment.type === 'text'">{{ segment.text }}</span>
              <span
                v-else-if="segment.type === 'fileReference'"
                class="file-reference-node"
                :title="segment.fileArg"
              >
                <span class="file-reference-node__icon">@</span>
                <span class="file-reference-node__label">{{ segment.label }}</span>
              </span>
              <span
                v-else-if="segment.type === 'skillReference'"
                class="file-reference-node skill-reference-node"
                :title="segment.location"
              >
                <span class="file-reference-node__icon">
                  <SkillIcon :size="14" />
                </span>
                <span class="file-reference-node__label">{{ segment.label }}</span>
              </span>
            </template>
          </div>
        </div>
        <button
          v-if="isOverflowing"
          type="button"
          class="user-message__expand-btn"
          @click="toggleExpand"
        >
          {{ isExpanded ? '收起' : '展开全部' }}
        </button>
      </div>
    </div>
    <div class="message__actions">
      <span class="message__time">{{ formattedTime }}</span>
      <BaseIconButton
        v-if="message.sessionEntryId"
        :label="isNavigatingTree ? '正在从这里编辑' : '从这里编辑'"
        class="message__action-btn"
        :disabled="isNavigatingTree"
        @click="navigateTree"
      >
        <TextCursorInput :size="13" />
      </BaseIconButton>
      <BaseIconButton
        v-if="message.sessionEntryId"
        label="在 Tree 中定位"
        class="message__action-btn"
        @click="locateInTree"
      >
        <MapPin :size="13" />
      </BaseIconButton>
      <BaseIconButton
        v-if="message.sessionEntryId"
        label="创建分支会话"
        class="message__action-btn"
        @click="forkFromMessage"
      >
        <GitFork :size="13" />
      </BaseIconButton>
      <BaseIconButton
        :label="isCopied ? '已复制' : '复制消息'"
        class="message__action-btn"
        @click="copyMessageText"
      >
        <Check v-if="isCopied" :size="13" />
        <Copy v-else :size="13" />
      </BaseIconButton>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@use '../file-reference-node';

.message {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  width: 100%;
  max-width: 100%;
  min-width: 0;

  &__actions {
    display: flex;
    flex-direction: row;
    justify-content: flex-end;
    gap: var(--space-2);
  }
}

.message__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0;
  opacity: 0;
  margin-top: var(--space-2);
  transition: opacity var(--duration-fast) var(--ease-standard);

  .message:hover & {
    opacity: 1;
  }
}

:deep(.message__action-btn) {
  width: 24px;
  height: 24px;
  color: var(--color-text-subtle);
  border-radius: var(--radius-sm);

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-raised);
  }
}

.message__time {
  margin-right: 6px;
  font-size: 11px;
  color: var(--color-text-subtle);
}

.user-message-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-2);
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.user-message {
  display: flex;
  flex-direction: column;
  align-self: flex-end;
  box-sizing: border-box;
  inline-size: var(--user-message-tight-width, max-content);
  max-inline-size: min(640px, 88%);
  min-inline-size: 0;
  padding: var(--space-1) var(--space-2);
  background: var(--user-message-bg);
  border: 1px solid var(--user-message-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  color: var(--color-text);
  font-size: var(--font-size-ui);
  line-height: 1.6;
  line-break: auto;
  word-break: normal;
  overflow-wrap: break-word;

  &--media {
    inline-size: max-content;
    padding: var(--space-1);
  }

  &--quotes {
    inline-size: max-content;
  }

  &--collapsed {
    .user-message__body {
      max-height: 320px;
      overflow: hidden;
      position: relative;

      &::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 64px;
        background: linear-gradient(to bottom, transparent, var(--user-message-bg));
        pointer-events: none;
      }
    }
  }
}

.user-message__expand-btn {
  align-self: flex-start;
  padding: var(--space-1) 0 0;
  color: var(--color-primary);
  font-size: var(--font-size-ui-xs);
  background: none;
  border: none;
  cursor: pointer;
  transition: opacity var(--duration-fast) var(--ease-standard);

  &:hover {
    opacity: 0.8;
  }
}

.user-message__body,
.user-message__text {
  max-width: 100%;
  min-width: 0;
}

.user-message__text {
  line-break: inherit;
  overflow-wrap: inherit;
  white-space: pre-wrap;
  word-break: inherit;
}

.file-reference-node {
  @include file-reference-node.file-reference-node;
  white-space: nowrap;
}

.file-reference-node__icon {
  @include file-reference-node.file-reference-node-icon;
}

.file-reference-node__label {
  @include file-reference-node.file-reference-node-label;
}

.user-message__quotes {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.quote-reference-node {
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr);
  align-items: start;
  gap: 6px;
  min-width: 0;
  min-height: 24px;
  padding: 2px 6px;
  color: var(--color-text);
  border-radius: var(--radius-lg);

  svg {
    margin-top: 2px;
    opacity: 0.78;
  }
}

.quote-reference-node__text {
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  font-size: var(--font-size-ui-sm);
  line-height: 1.35;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.user-message__images {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: var(--space-2);
  width: min(320px, calc(100vw - 64px));

  &:not(:last-child) {
    margin-bottom: var(--space-2);
  }

  img {
    width: 100%;
    max-height: 180px;
    object-fit: cover;
    border: 1px solid var(--user-message-media-border);
    border-radius: var(--radius-lg);
  }
}

.user-message__image-preview {
  display: flex;
  width: 100%;
  padding: 0;
  background: transparent;
  border: 0;
  cursor: zoom-in;

  &:focus-visible {
    outline: 2px solid var(--color-primary-outline);
    outline-offset: 2px;
    border-radius: var(--radius-lg);
  }
}

.user-message__attachments {
  display: flex;
  flex-direction: row;
  gap: var(--space-1);
  width: fit-content;
  max-width: 100%;
}

.user-message__attachment {
  display: flex;
  align-items: start;
  gap: var(--space-1);
  min-width: 0;
  width: fit-content;
  max-width: 100%;
  padding: 6px 8px;
  background: var(--user-message-attachment-bg);
  border: 1px solid var(--user-message-attachment-border);
  border-radius: var(--radius-md);

  &--image {
    justify-self: end;
    width: fit-content;
    padding: 0;
    background: transparent;
    border: none;
    gap: 4px;
  }
}

.user-message__attachment-icon {
  color: var(--color-text-muted);
}

.user-message__attachment-meta {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.user-message__attachment-image {
  width: 100%;
  height: auto;
  object-fit: cover;
  background: var(--color-surface);
  border: 1px solid var(--user-message-media-border);
  border-radius: var(--radius-lg);

  .user-message__attachment--image & {
    width: 64px;
    height: 64px;
    object-fit: cover;
  }
}

.user-message__attachment-name,
.user-message__attachment-note {
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.user-message__attachment-name {
  font-size: var(--font-size-ui-sm);
  color: var(--color-text);
}

.user-message__attachment-note {
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-muted);
}
</style>
