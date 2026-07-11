<script setup lang="ts">
import { computed } from 'vue'
import { formatTokens } from '@shared/coding-agent/format'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'

/** 上下文用量数据。 */
export type TokenUsage = {
  /** 已使用 token 数；undefined 表示尚未估算出。 */
  tokens?: number
  /** 上下文窗口大小。 */
  contextWindow: number
  /** 使用百分比（0-100）；undefined 表示尚未估算出。 */
  percent?: number
  /** 是否启用自动上下文压缩；undefined 表示运行态尚未加载。 */
  autoCompactionEnabled?: boolean
}

const props = defineProps<{
  /** 当前会话的 token usage 信息。 */
  usage?: TokenUsage
}>()

const RADIUS = 12
const STROKE = 5
const NORMALIZED_RADIUS = RADIUS - STROKE / 2
const CIRCUMFERENCE = 2 * Math.PI * NORMALIZED_RADIUS

const usedTokens = computed(() => props.usage?.tokens)
const contextWindow = computed(() => props.usage?.contextWindow ?? 0)
const isUnknown = computed(
  () => props.usage?.tokens === undefined || props.usage?.percent === undefined
)
const percent = computed(() => {
  if (isUnknown.value || contextWindow.value === 0) {
    return 0
  }
  return Math.min(100, Math.max(0, props.usage?.percent ?? 0))
})

const progressOffset = computed(() => CIRCUMFERENCE * (1 - percent.value / 100))

const statusLabel = computed(() => {
  if (isUnknown.value) {
    return '估算中'
  }
  if (percent.value >= 90) {
    return '临近上限'
  }
  if (percent.value >= 70) {
    return '偏高'
  }
  return '正常'
})

const statusClass = computed(() => {
  if (isUnknown.value) {
    return 'is-unknown'
  }
  if (percent.value >= 90) {
    return 'is-danger'
  }
  if (percent.value >= 70) {
    return 'is-warning'
  }
  return 'is-normal'
})

const color = computed(() => {
  if (percent.value >= 90) {
    return 'var(--color-danger)'
  }
  if (percent.value >= 70) {
    return 'var(--color-accent)'
  }
  return 'var(--color-primary)'
})

const percentText = computed(() => {
  if (isUnknown.value) {
    return '?'
  }
  return `${percent.value.toFixed(1)}%`
})

const autoIndicator = computed(() => (props.usage?.autoCompactionEnabled === true ? ' (auto)' : ''))
const autoCompactionText = computed(() => {
  if (props.usage?.autoCompactionEnabled === undefined) {
    return '未知'
  }
  return props.usage.autoCompactionEnabled ? '开启' : '关闭'
})

const displayText = computed(() => {
  return `${percentText.value}/${formatTokens(contextWindow.value)}${autoIndicator.value}`
})
const usedTokensText = computed(() => (isUnknown.value ? '?' : formatTokens(usedTokens.value ?? 0)))
</script>

<template>
  <TooltipProvider>
    <Tooltip :delay-duration="150">
      <TooltipTrigger as-child>
        <button
          type="button"
          class="usage"
          :class="statusClass"
          :aria-label="`上下文用量 ${displayText}，${statusLabel}`"
        >
          <svg class="usage__ring" viewBox="0 0 28 28" fill="none" :aria-hidden="true">
            <circle
              class="usage__track"
              cx="14"
              cy="14"
              :r="NORMALIZED_RADIUS"
              :stroke-width="STROKE"
            />
            <circle
              v-if="!isUnknown"
              class="usage__progress"
              cx="14"
              cy="14"
              :r="NORMALIZED_RADIUS"
              :stroke-width="STROKE"
              :stroke="color"
              :stroke-dasharray="CIRCUMFERENCE"
              :stroke-dashoffset="progressOffset"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div class="usage__tooltip">
          <p class="usage__tooltip-title">上下文用量</p>
          <p class="usage__tooltip-row">
            已使用：<strong>{{ usedTokensText }}</strong>
          </p>
          <p class="usage__tooltip-row">
            上下文窗口：<strong>{{ formatTokens(contextWindow) }}</strong>
          </p>
          <p class="usage__tooltip-row">
            使用率：<strong>{{ percentText }}</strong>
          </p>
          <p class="usage__tooltip-row">
            自动压缩：<strong>{{ autoCompactionText }}</strong>
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>

<style lang="scss" scoped>
.usage {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 26px;
  height: 26px;
  padding: 0;
  color: var(--color-text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-text);
  }

  &.is-warning {
    color: var(--color-accent);
  }

  &.is-danger {
    color: var(--color-danger);
  }

  &.is-unknown {
    color: var(--color-text-subtle);
  }
}

.usage__ring {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  transform: rotate(-90deg);
}

.usage__track {
  stroke: var(--color-control-track);
}

.usage__progress {
  transition:
    stroke-dashoffset var(--duration-base) var(--ease-standard),
    stroke var(--duration-fast) var(--ease-standard);
}

.usage__tooltip {
  display: grid;
  gap: 2px;
  min-width: 0;
  max-width: 240px;
}

.usage__tooltip-title {
  margin: 0 0 2px;
  font-weight: 650;
}

.usage__tooltip-row {
  margin: 0;
  color: var(--usage-tooltip-row-text);

  strong {
    color: var(--color-primary-ink);
  }
}

@media (width <= 720px) {
  .usage {
    width: 32px;
    padding: 0;
    justify-content: center;
  }

  .usage__copy {
    display: none;
  }
}
</style>
