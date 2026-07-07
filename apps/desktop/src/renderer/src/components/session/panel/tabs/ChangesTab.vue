<script setup lang="ts">
import { computed, ref, type ComponentPublicInstance } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import DiffViewer from '@renderer/components/chat/messages/tools/DiffViewer.vue'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import {
  countFileChangeStats,
  createVirtualFileChangeRows,
  formatAdditions,
  formatDeletions,
  getFileChangeId,
  getReviewDiff
} from './display/changesDisplay'

type MaybeRefValue<T> = T extends { value: infer Value } ? Value : T
type ChangeListVirtualizerOptions = MaybeRefValue<Parameters<typeof useVirtualizer>[0]>

const workspaceSession = useWorkspaceSessionStore()
const changeListRef = ref<HTMLElement>()

const fileChanges = computed(() => workspaceSession.activeSnapshot?.fileChanges ?? [])
const getChangeListScrollElement = (): HTMLElement | null =>
  changeListRef.value?.closest<HTMLElement>("[data-slot='scroll-area-viewport']") ?? null
const estimateChangeListSize = (): number => 382
const changeListOptions = computed<ChangeListVirtualizerOptions>((previous) => {
  const count = fileChanges.value.length
  if (previous?.count === count) {
    return previous
  }
  return {
    count,
    getScrollElement: getChangeListScrollElement,
    estimateSize: estimateChangeListSize,
    overscan: 4,
    gap: 4
  }
})
const changeListVirtualizer = useVirtualizer(changeListOptions)
const virtualChangeItems = computed(() => changeListVirtualizer.value.getVirtualItems())
const virtualChangeTotalSize = computed(() => changeListVirtualizer.value.getTotalSize())
const virtualChangeRows = computed(() =>
  createVirtualFileChangeRows(virtualChangeItems.value, fileChanges.value)
)
const fileChangeStats = computed(() => countFileChangeStats(fileChanges.value))

function measureChangeItem(refValue: Element | ComponentPublicInstance | null): void {
  if (refValue instanceof Element) {
    changeListVirtualizer.value.measureElement(refValue)
  }
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
            <span class="change-file__title">{{ change.path }}</span>
          </span>
          <strong class="change-file__stats">
            <span class="change-stats__additions">{{ formatAdditions(change.additions) }}</span>
            <span class="change-stats__deletions">{{ formatDeletions(change.deletions) }}</span>
          </strong>
        </summary>

        <div class="change-file__diff">
          <DiffViewer
            v-if="getReviewDiff(change)"
            :diff="getReviewDiff(change)!"
            expand-vertically
          />
          <pre v-else>No diff available</pre>
        </div>
      </details>
    </div>
  </section>
</template>
