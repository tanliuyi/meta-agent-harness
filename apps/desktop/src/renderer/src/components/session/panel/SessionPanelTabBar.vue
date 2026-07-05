<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import type { SessionPanelOpenTab, SessionPanelTabCountMap, SessionPanelTabId } from './types'

const props = defineProps<{
  activeTabInstanceId: string
  attentionTabIds: SessionPanelTabId[]
  collapsed?: boolean
  counts: SessionPanelTabCountMap
  isAddPanelActive: boolean
  openTabs: SessionPanelOpenTab[]
}>()

const emit = defineEmits<{
  close: [tabInstanceId: string]
  openAddPanel: []
  select: [tabInstanceId: string]
}>()

function getTabCount(tabId: SessionPanelTabId): number | undefined {
  return props.counts[tabId] || undefined
}

function isTabAttention(tabId: SessionPanelTabId): boolean {
  return props.attentionTabIds.includes(tabId)
}

function isAddPanelAttention(): boolean {
  return props.attentionTabIds.some(
    (tabId) => !props.openTabs.some((tab) => tab.id === tabId)
  )
}

function moveActiveTab(fromTabInstanceId: string, direction: 1 | -1): void {
  if (props.openTabs.length === 0) {
    return
  }
  const currentIndex = Math.max(
    0,
    props.openTabs.findIndex((tab) => tab.instanceId === fromTabInstanceId)
  )
  const nextIndex = (currentIndex + direction + props.openTabs.length) % props.openTabs.length
  const nextTab = props.openTabs[nextIndex]
  if (nextTab) {
    emit('select', nextTab.instanceId)
  }
}

function handleTabKeydown(event: KeyboardEvent, tabInstanceId: string): void {
  switch (event.key) {
    case 'ArrowRight':
      event.preventDefault()
      moveActiveTab(tabInstanceId, 1)
      return
    case 'ArrowLeft':
      event.preventDefault()
      moveActiveTab(tabInstanceId, -1)
      return
    case 'Home':
      event.preventDefault()
      if (props.openTabs[0]) {
        emit('select', props.openTabs[0].instanceId)
      }
      return
    case 'End':
      event.preventDefault()
      if (props.openTabs.at(-1)) {
        emit('select', props.openTabs.at(-1)!.instanceId)
      }
      return
    case 'Backspace':
    case 'Delete':
      event.preventDefault()
      emit('close', tabInstanceId)
      return
  }
}
</script>

<template>
  <div v-if="!collapsed" class="session-panel__tabs" role="tablist" aria-label="Session panel">
    <div
      v-for="tab in openTabs"
      :key="tab.instanceId"
      class="session-panel__tab"
      :class="{
        'is-active': activeTabInstanceId === tab.instanceId,
        'has-attention': isTabAttention(tab.id)
      }"
    >
      <button
        type="button"
        class="session-panel__tab-main"
        role="tab"
        :aria-selected="activeTabInstanceId === tab.instanceId"
        @click="$emit('select', tab.instanceId)"
        @keydown="handleTabKeydown($event, tab.instanceId)"
      >
        <span>{{ tab.label }}</span>
        <small v-if="getTabCount(tab.id)">{{ getTabCount(tab.id) }}</small>
      </button>
      <button
        class="session-panel__tab-close"
        type="button"
        tabindex="-1"
        :aria-label="`关闭 ${tab.label}`"
        @click.stop="$emit('close', tab.instanceId)"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
        </svg>
      </button>
    </div>
    <button
      type="button"
      class="session-panel__tab-add"
      :class="{ 'is-active': isAddPanelActive, 'has-attention': isAddPanelAttention() }"
      role="tab"
      :aria-selected="isAddPanelActive"
      aria-label="添加面板"
      @click="$emit('openAddPanel')"
    >
      <Plus :size="15" />
    </button>
  </div>
</template>
