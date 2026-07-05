<script setup lang="ts">
import { computed, ref, type ComponentPublicInstance } from 'vue'
import { useVirtualizer, type VirtualItem } from '@tanstack/vue-virtual'
import DiffViewer from '@renderer/components/chat/messages/tools/DiffViewer.vue'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import type { ThreadSnapshot } from '@shared/coding-agent/types'
import { getFileName } from '../utils'

type FileChange = ThreadSnapshot['fileChanges'][number]
type VirtualFileChangeRow = {
  virtualItem: VirtualItem
  change: FileChange
}

const workspaceSession = useWorkspaceSessionStore()
const changeListRef = ref<HTMLElement>()

const fileChanges = computed(() => workspaceSession.activeSnapshot?.fileChanges ?? [])
const changeListVirtualizer = useVirtualizer(
  computed(() => ({
    count: fileChanges.value.length,
    getScrollElement: () =>
      changeListRef.value?.closest<HTMLElement>("[data-slot='scroll-area-viewport']") ?? null,
    estimateSize: () => 382,
    overscan: 4,
    gap: 4
  }))
)
const virtualChangeItems = computed(() => changeListVirtualizer.value.getVirtualItems())
const virtualChangeTotalSize = computed(() => changeListVirtualizer.value.getTotalSize())
const virtualChangeRows = computed<VirtualFileChangeRow[]>(() => {
  const rows: VirtualFileChangeRow[] = []
  for (const virtualItem of virtualChangeItems.value) {
    const change = fileChanges.value[virtualItem.index]
    if (change) {
      rows.push({ virtualItem, change })
    }
  }
  return rows
})
const fileChangeStats = computed(() =>
  fileChanges.value.reduce(
    (stats, change) => ({
      additions: stats.additions + (change.additions ?? 0),
      deletions: stats.deletions + (change.deletions ?? 0)
    }),
    { additions: 0, deletions: 0 }
  )
)

function getFileChangeId(change: FileChange): string {
  return `${change.toolCallId ?? change.createdAt}:${change.path}`
}

function getReviewDiff(change: FileChange | undefined): string | undefined {
  return change?.diff || change?.patch
}

function measureChangeItem(refValue: Element | ComponentPublicInstance | null): void {
  if (refValue instanceof Element) {
    changeListVirtualizer.value.measureElement(refValue)
  }
}

function formatAdditions(value: number | undefined): string {
  return `+${value ?? 0}`
}

function formatDeletions(value: number | undefined): string {
  return `-${value ?? 0}`
}
</script>

<template>
  <section class="session-section" role="tabpanel">
    <header class="session-section__header">
      <div class="session-section__title">
        <h3>Changes</h3>
        <span v-if="fileChanges.length" class="session-panel-count">{{ fileChanges.length }}</span>
      </div>
      <span v-if="fileChanges.length" class="change-stats">
        <span class="change-stats__additions">{{
          formatAdditions(fileChangeStats.additions)
        }}</span>
        <span class="change-stats__separator">/</span>
        <span class="change-stats__deletions">{{
          formatDeletions(fileChangeStats.deletions)
        }}</span>
      </span>
    </header>

    <div v-if="fileChanges.length === 0" class="session-empty">No file changes</div>
    <div
      v-else
      ref="changeListRef"
      class="change-file-list"
      :style="{ height: `${virtualChangeTotalSize}px` }"
    >
      <details
        v-for="{ virtualItem, change } in virtualChangeRows"
        :key="getFileChangeId(change)"
        :ref="measureChangeItem"
        :data-index="virtualItem.index"
        class="change-file"
        :style="{ transform: `translateY(${virtualItem.start}px)` }"
        open
      >
        <summary class="change-file__summary">
          <span class="change-file__main">
            <span class="change-file__title">{{ getFileName(change.path) }}</span>
            <span class="change-file__meta">
              {{ change.changeType }} ·
              {{ change.path }}
            </span>
          </span>
          <strong class="change-file__stats">
            <span class="change-stats__additions">{{ formatAdditions(change.additions) }}</span>
            <span class="change-stats__deletions">{{ formatDeletions(change.deletions) }}</span>
          </strong>
        </summary>

        <div class="change-file__diff">
          <DiffViewer v-if="getReviewDiff(change)" :diff="getReviewDiff(change)!" />
          <pre v-else>No diff available</pre>
        </div>
      </details>
    </div>
  </section>
</template>
