<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

/**
 * BaseIconButton.vue - 基础图标按钮组件。
 *
 * 仅包含图标的按钮，支持激活状态、无障碍标签与无包装 Tooltip。
 */

const props = withDefaults(
  defineProps<{
    /** 是否处于激活状态。 */
    active?: boolean
    /** 按钮的无障碍标签，同时作为默认 Tooltip 文本。 */
    label: string
    /** 是否启用由 label 提供的默认 Tooltip。 */
    tooltip?: boolean
    /** 按钮原生类型。 */
    type?: 'button' | 'submit' | 'reset'
    /** 是否禁用。 */
    disabled?: boolean
    size?: 'small' | 'medium' | 'large'
  }>(),
  {
    active: false,
    tooltip: true,
    type: 'button',
    disabled: false
  }
)

const buttonRef = ref<HTMLButtonElement>()
let tooltipElement: HTMLDivElement | undefined
let tooltipTimer: ReturnType<typeof setTimeout> | undefined
let suppressNextFocusTooltip = false
let focusSuppressionTimer: ReturnType<typeof setTimeout> | undefined

const buttonClasses = computed(() => {
  return {
    'base-icon-button': true,
    'is-active': props.active,
    [`is-${props.size}`]: true
  }
})

function clearTooltipTimer(): void {
  if (tooltipTimer === undefined) return
  clearTimeout(tooltipTimer)
  tooltipTimer = undefined
}

function hideTooltip(): void {
  clearTooltipTimer()
  tooltipElement?.remove()
  tooltipElement = undefined
  window.removeEventListener('scroll', hideTooltip, true)
  window.removeEventListener('resize', hideTooltip)
}

function showTooltip(): void {
  hideTooltip()
  if (!buttonRef.value || !props.tooltip || props.disabled) return

  tooltipTimer = setTimeout(() => {
    const button = buttonRef.value
    if (!button) return

    const tooltip = document.createElement('div')
    tooltip.dataset.slot = 'tooltip-content'
    tooltip.dataset.baseIconButtonTooltip = ''
    tooltip.setAttribute('role', 'tooltip')
    tooltip.textContent = props.label
    Object.assign(tooltip.style, {
      position: 'fixed',
      pointerEvents: 'none',
      visibility: 'hidden',
      whiteSpace: 'nowrap'
    })
    document.body.append(tooltip)

    const buttonRect = button.getBoundingClientRect()
    const tooltipRect = tooltip.getBoundingClientRect()
    const viewportPadding = 8
    const gap = 6
    const centeredLeft = buttonRect.left + (buttonRect.width - tooltipRect.width) / 2
    const left = Math.min(
      Math.max(centeredLeft, viewportPadding),
      window.innerWidth - tooltipRect.width - viewportPadding
    )
    const aboveTop = buttonRect.top - tooltipRect.height - gap
    const top =
      aboveTop >= viewportPadding ? aboveTop : Math.min(buttonRect.bottom + gap, window.innerHeight)

    tooltip.style.left = `${Math.round(left)}px`
    tooltip.style.top = `${Math.round(top)}px`
    tooltip.style.visibility = 'visible'
    tooltipElement = tooltip
    tooltipTimer = undefined
    window.addEventListener('scroll', hideTooltip, true)
    window.addEventListener('resize', hideTooltip)
  }, 150)
}

function showFocusTooltip(): void {
  if (suppressNextFocusTooltip) {
    suppressNextFocusTooltip = false
    return
  }
  if (!buttonRef.value?.matches(':focus-visible')) return
  showTooltip()
}

function handlePointerDown(): void {
  suppressNextFocusTooltip = document.activeElement !== buttonRef.value
  if (focusSuppressionTimer !== undefined) clearTimeout(focusSuppressionTimer)
  focusSuppressionTimer = setTimeout(() => {
    suppressNextFocusTooltip = false
    focusSuppressionTimer = undefined
  }, 0)
  hideTooltip()
}

onBeforeUnmount(() => {
  if (focusSuppressionTimer !== undefined) clearTimeout(focusSuppressionTimer)
  hideTooltip()
})
</script>

<template>
  <button
    ref="buttonRef"
    :class="buttonClasses"
    :type="type"
    :disabled="disabled"
    :aria-label="label"
    @mouseenter="showTooltip"
    @mouseleave="hideTooltip"
    @focus="showFocusTooltip"
    @blur="hideTooltip"
    @pointerdown="handlePointerDown"
  >
    <slot />
  </button>
</template>

<style lang="scss" scoped>
.base-icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--color-text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  pointer-events: auto;
  transition:
    color var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);

  &:hover,
  &.is-active {
    color: var(--color-primary-strong);
    background: var(--color-primary-soft);
    border-color: var(--color-primary-outline);
  }

  &:active:not(:disabled) {
    transform: translateY(1px);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }

  :deep(svg) {
    flex-shrink: 0;
  }

  &.is-small {
    width: 20px;
    height: 20px;
  }
  &.is-medium {
    width: 24px;
    height: 24px;
  }
  &.is-large {
    width: 32px;
    height: 32px;
  }
}
</style>
