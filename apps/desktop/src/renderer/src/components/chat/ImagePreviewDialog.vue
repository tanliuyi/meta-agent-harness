<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { WORKSPACE_PORTAL_TARGET } from '@renderer/router/workspace-route-host'

export interface ImagePreviewItem {
  src: string
  alt?: string
  title?: string
  meta?: string
}

const props = withDefaults(
  defineProps<{
    open: boolean
    images: ImagePreviewItem[]
    initialIndex?: number
  }>(),
  {
    initialIndex: 0
  }
)

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const MIN_SCALE = 0.25
const MAX_SCALE = 6
const WHEEL_SCALE_FACTOR = 0.0018

const activeIndex = ref(0)
const scale = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
const isDragging = ref(false)
const didDrag = ref(false)
const dragStart = ref({ x: 0, y: 0, offsetX: 0, offsetY: 0 })

const activeImage = computed(() => props.images[activeIndex.value])
const imageTransform = computed(
  () => `translate(${offsetX.value}px, ${offsetY.value}px) scale(${scale.value})`
)

watch(
  () => props.open,
  (open) => {
    if (!open) {
      isDragging.value = false
      return
    }
    activeIndex.value = clampIndex(props.initialIndex)
    resetTransform()
  },
  { immediate: true }
)

watch(
  () => props.initialIndex,
  (index) => {
    if (!props.open) return
    activeIndex.value = clampIndex(index)
    resetTransform()
  }
)

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})

function closePreview(): void {
  emit('update:open', false)
}

function handleBackdropClick(): void {
  closePreview()
}

function clampIndex(index: number): number {
  return Math.min(Math.max(index, 0), Math.max(props.images.length - 1, 0))
}

function resetTransform(): void {
  scale.value = 1
  offsetX.value = 0
  offsetY.value = 0
  isDragging.value = false
}

function handleWheel(event: WheelEvent): void {
  event.preventDefault()
  const nextScale = clampScale(scale.value * (1 - event.deltaY * WHEEL_SCALE_FACTOR))
  if (nextScale === scale.value) return
  scale.value = nextScale
  if (scale.value === 1) {
    offsetX.value = 0
    offsetY.value = 0
  }
}

function clampScale(value: number): number {
  return Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, value)) * 100) / 100
}

function startDrag(event: PointerEvent): void {
  didDrag.value = false
  dragStart.value = {
    x: event.clientX,
    y: event.clientY,
    offsetX: offsetX.value,
    offsetY: offsetY.value
  }
  if (scale.value > 1) {
    isDragging.value = true
    if (event.currentTarget instanceof HTMLElement) {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }
}

function moveDrag(event: PointerEvent): void {
  if (!isDragging.value) return
  const deltaX = event.clientX - dragStart.value.x
  const deltaY = event.clientY - dragStart.value.y
  if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
    didDrag.value = true
  }
  offsetX.value = dragStart.value.offsetX + deltaX
  offsetY.value = dragStart.value.offsetY + deltaY
}

function endDrag(event: PointerEvent): void {
  if (!isDragging.value) return
  isDragging.value = false
  if (event.currentTarget instanceof HTMLElement) {
    event.currentTarget.releasePointerCapture(event.pointerId)
  }
}

function handleImageClick(event: MouseEvent): void {
  event.stopPropagation()
  if (didDrag.value) {
    didDrag.value = false
    return
  }
  if (scale.value === 1) {
    scale.value = 2
    return
  }
  resetTransform()
}

function handleKeydown(event: KeyboardEvent): void {
  if (!props.open) return
  switch (event.key) {
    case 'Escape':
      closePreview()
      break
    case '0':
      resetTransform()
      break
    case 'ArrowLeft':
      if (activeIndex.value > 0) {
        activeIndex.value -= 1
        resetTransform()
      }
      break
    case 'ArrowRight':
      if (activeIndex.value < props.images.length - 1) {
        activeIndex.value += 1
        resetTransform()
      }
      break
  }
}
</script>

<template>
  <Teleport :to="WORKSPACE_PORTAL_TARGET">
    <div
      v-if="open && activeImage"
      class="image-preview"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      @click.self="handleBackdropClick"
      @wheel="handleWheel"
    >
      <button
        class="image-preview__close"
        type="button"
        aria-label="关闭图片预览"
        @click="closePreview"
      >
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M5 5l10 10M15 5 5 15" />
        </svg>
      </button>

      <div class="image-preview__stage">
        <img
          class="image-preview__image"
          :class="{ 'is-draggable': scale > 1, 'is-dragging': isDragging }"
          :src="activeImage.src"
          :alt="activeImage.alt ?? ''"
          :style="{ transform: imageTransform }"
          draggable="false"
          @click="handleImageClick"
          @pointerdown.stop="startDrag"
          @pointermove.stop="moveDrag"
          @pointerup.stop="endDrag"
          @pointercancel.stop="endDrag"
          @dblclick.stop="resetTransform"
        />
      </div>
    </div>
  </Teleport>
</template>

<style lang="scss" scoped>
.image-preview {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: rgb(0 0 0 / 82%);
  touch-action: none;
  user-select: none;
}

.image-preview__close {
  position: fixed;
  top: 14px;
  right: 14px;
  z-index: 1;
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  padding: 0;
  color: rgb(255 255 255 / 82%);
  background: rgb(0 0 0 / 36%);
  border: 1px solid rgb(255 255 255 / 18%);
  border-radius: var(--radius-md);
  cursor: pointer;
  backdrop-filter: blur(10px);
  transition:
    color var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);

  svg {
    width: 18px;
    height: 18px;
  }

  &:hover,
  &:focus-visible {
    color: #fff;
    background: rgb(255 255 255 / 12%);
    border-color: rgb(255 255 255 / 28%);
  }
}

.image-preview__stage {
  display: grid;
  width: 100vw;
  height: 100svh;
  place-items: center;
  pointer-events: none;
}

.image-preview__image {
  display: block;
  max-width: calc(100vw - 48px);
  max-height: calc(100svh - 48px);
  object-fit: contain;
  cursor: zoom-in;
  pointer-events: auto;
  transform-origin: center;
  transition: transform var(--duration-fast) var(--ease-standard);
  will-change: transform;
}

.image-preview__image.is-draggable {
  cursor: grab;
}

.image-preview__image.is-dragging {
  cursor: grabbing;
  transition: none;
}
</style>
