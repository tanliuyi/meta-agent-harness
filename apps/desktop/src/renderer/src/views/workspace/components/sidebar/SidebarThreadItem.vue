<script setup lang="ts">
import { BaseContextMenu } from '@renderer/components/base'
import type { WorkspaceSession } from '@renderer/stores/workspace-session'
import { computed } from 'vue'
import {
  formatUpdatedAtDistance,
  getThreadLeafShortcuts,
  getThreadLineageLabel,
  getThreadMenuSections,
  getThreadStatusIndicator,
  getThreadStatusLabel,
  isThreadMenuActionId,
  type ThreadMenuActionId
} from './support/sidebar-thread-item'

const props = defineProps<{
  active: boolean
  currentTime: number
  depth: number
  thread: WorkspaceSession
}>()

const emit = defineEmits<{
  (event: 'menu-action', actionId: ThreadMenuActionId, thread: WorkspaceSession): void
  (event: 'navigate-leaf', thread: WorkspaceSession, entryId: string): void
  (event: 'select-thread', threadId: string): void
}>()

const statusIndicator = computed(() => getThreadStatusIndicator(props.thread.status))
const statusLabel = computed(() =>
  statusIndicator.value ? getThreadStatusLabel(props.thread.status) : undefined
)
const updatedAtDistance = computed(() =>
  statusIndicator.value
    ? undefined
    : formatUpdatedAtDistance(props.thread.updatedAt, props.currentTime)
)
const lineageLabel = computed(() => getThreadLineageLabel(props.thread))
const leafShortcuts = computed(() => (props.active ? getThreadLeafShortcuts(props.thread) : []))
const threadMenuSections = computed(() => getThreadMenuSections(props.thread))
const threadIndent = computed(() => `${Math.min(Math.max(props.depth, 0), 4) * 12}px`)

function emitMenuAction(actionId: string): void {
  if (isThreadMenuActionId(actionId)) {
    emit('menu-action', actionId, props.thread)
  }
}
</script>

<template>
  <BaseContextMenu :sections="threadMenuSections" @select="(item) => emitMenuAction(item.id)">
    <li
      class="session-group__item"
      :class="{ 'is-active': active }"
      :style="{ '--thread-indent': threadIndent }"
      @click="emit('select-thread', thread.threadId)"
    >
      <span class="session-group__item-content">
        <span class="session-group__item-main">
          <span class="session-group__item-title">
            {{ thread.title || '新会话' }}
          </span>
          <span
            v-if="statusIndicator"
            class="thread-status"
            :class="`is-${statusIndicator}`"
            :aria-label="statusLabel"
            role="img"
          >
            <svg
              v-if="statusIndicator === 'running'"
              class="thread-status__svg"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <circle class="thread-status__track" cx="8" cy="8" r="6.25" />
              <circle class="thread-status__runner" cx="8" cy="8" r="6.25" />
            </svg>
            <svg v-else class="thread-status__svg" viewBox="0 0 16 16" aria-hidden="true">
              <circle class="thread-status__error-ring" cx="8" cy="8" r="6.25" />
              <path class="thread-status__error-mark" d="M8 4.75v4.2" />
              <circle class="thread-status__error-dot" cx="8" cy="11.35" r="0.7" />
            </svg>
          </span>
          <time
            v-else-if="updatedAtDistance"
            class="thread-updated-at"
            :datetime="thread.updatedAt"
          >
            {{ updatedAtDistance }}
          </time>
        </span>
        <span v-if="lineageLabel" class="session-group__item-meta">
          <span>{{ lineageLabel }}</span>
        </span>
        <span v-if="leafShortcuts.length" class="session-group__leaf-shortcuts">
          <button
            v-for="shortcut in leafShortcuts"
            :key="shortcut.id"
            type="button"
            @click.stop="emit('navigate-leaf', thread, shortcut.id)"
          >
            <span>{{ shortcut.label }}</span>
            <small>{{ shortcut.meta }}</small>
          </button>
        </span>
      </span>
    </li>
  </BaseContextMenu>
</template>

<style lang="scss" scoped>
.session-group__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  min-height: 2.4em;
  margin: 0 calc(var(--space-2) + 6px);
  padding: var(--space-1) var(--space-3) var(--space-1)
    calc(var(--space-5) + var(--thread-indent, 0px));
  color: var(--color-text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  cursor: default;
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-text);
    background: color-mix(in srgb, var(--color-surface-raised) 72%, transparent);
    border-color: var(--color-border-muted);
  }

  &.is-active {
    color: var(--color-text);
    background: color-mix(in srgb, var(--color-primary) 7%, var(--color-surface-raised));
    border-color: transparent;
    box-shadow: none;
  }

  &-content {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &-main {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  &-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: var(--font-size-ui-sm);
    font-weight: 560;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &-meta {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    color: var(--color-text-subtle, var(--color-text-muted));
    font-size: var(--font-size-ui-xs);
    line-height: 1.25;

    span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
}

.session-group__leaf-shortcuts {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 2px 0 1px;

  button {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2);
    align-items: center;
    min-width: 0;
    height: 22px;
    padding: 0 var(--space-2);
    color: var(--color-text-muted);
    background: color-mix(in srgb, var(--color-surface) 72%, transparent);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xs);
    font: inherit;
    text-align: left;

    &:hover {
      color: var(--color-text);
      background: var(--color-surface-raised);
    }
  }

  span,
  small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    font-size: var(--font-size-ui-xs);
    font-weight: 560;
  }

  small {
    color: var(--color-text-subtle, var(--color-text-muted));
    font-size: var(--font-size-ui-2xs);
  }
}

.thread-status {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--color-text-muted);
}

.thread-updated-at {
  flex: 0 0 auto;
  color: var(--color-text-subtle, var(--color-text-muted));
  font-family: var(--font-mono);
  font-size: var(--font-size-ui-xs);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

.thread-status__svg {
  display: block;
  width: 14px;
  height: 14px;
  overflow: visible;
}

.thread-status__track,
.thread-status__runner,
.thread-status__error-ring {
  fill: none;
  stroke-width: 2;
}

.thread-status__track {
  stroke: currentColor;
  opacity: 0.22;
}

.thread-status__runner {
  animation: thread-status-spin 0.9s linear infinite;
  stroke: currentColor;
  stroke-dasharray: 22 40;
  stroke-linecap: round;
  transform-origin: 8px 8px;
}

.thread-status.is-error {
  color: var(--color-danger);
}

.thread-status__error-ring {
  animation: thread-status-error-pulse 1.4s var(--ease-standard) infinite;
  stroke: currentColor;
}

.thread-status__error-mark {
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-width: 1.8;
}

.thread-status__error-dot {
  animation: thread-status-error-dot 1.4s var(--ease-standard) infinite;
  fill: currentColor;
}

@keyframes thread-status-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes thread-status-error-pulse {
  0%,
  100% {
    opacity: 0.45;
  }

  50% {
    opacity: 1;
  }
}

@keyframes thread-status-error-dot {
  0%,
  100% {
    transform: scale(0.85);
  }

  50% {
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .thread-status__runner,
  .thread-status__error-ring,
  .thread-status__error-dot {
    animation: none;
  }
}
</style>
