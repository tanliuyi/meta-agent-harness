<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, triggerRef, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import DiffViewer from '@renderer/components/chat/messages/tools/DiffViewer.vue'
import { BaseIconButton } from '@renderer/components/base'
import { useToast } from '@renderer/composables/useToast'
import { ChevronsDownUp, ChevronsUpDown, Copy, ExternalLink, FolderSearch } from 'lucide-vue-next'
import type { DiffDocumentIndex } from '@renderer/components/chat/messages/tools/display/diffDocumentIndex'
import { diffDocumentIndexService } from '@renderer/components/chat/messages/tools/display/diffDocumentIndexService'
import ScrollArea from '@renderer/components/ui/scroll-area/ScrollArea.vue'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import {
  CHANGE_FILE_DIFF_BORDER_HEIGHT,
  CHANGE_FILE_DIFF_LINE_HEIGHT,
  CHANGE_FILE_LINE_OVERSCAN,
  CHANGE_FILE_SUMMARY_HEIGHT,
  countFileChangeStats,
  createVirtualFileChangeRows,
  formatAdditions,
  formatDeletions,
  formatFileChangePath,
  getFileChangeId,
  getFileChangeLayoutSize,
  getReviewDiff,
  getVisibleDiffLineRange,
  type FileChange,
  type FileChangeStats
} from './display/changesDisplay'
import {
  recordChangesReviewAttempt,
  recordChangesReviewFailure,
  recordChangesReviewImpression,
  recordChangesReviewSuccess,
  type ChangesReviewAction
} from './changesReviewMetrics'

type MaybeRefValue<T> = T extends { value: infer Value } ? Value : T
type ChangeListVirtualizerOptions = MaybeRefValue<Parameters<typeof useVirtualizer>[0]>
type ScrollAreaInstance = {
  getViewport: () => HTMLElement | undefined
}

type FileChangeLayout = {
  changeId: string
  diff?: string
  lineCount: number
  lineScale: number
  size: number
}

type ChangeViewportMetrics = {
  scrollTop: number
  clientHeight: number
}

const CHANGE_LIST_MAX_HEIGHT = 12_000_000
const CHANGE_LIST_GAP = 4

const workspaceSession = useWorkspaceSessionStore()
const toast = useToast()
const changeListScrollRef = ref<ScrollAreaInstance>()
const fileChangeLayouts = shallowRef<FileChangeLayout[]>([])
const diffDocuments = shallowRef<Map<string, DiffDocumentIndex>>(new Map())
const fileChangeStats = ref<FileChangeStats>({ additions: 0, deletions: 0 })
const changeViewportMetrics = ref<ChangeViewportMetrics>({ scrollTop: 0, clientHeight: 0 })
const projectionResetVersion = ref(0)
const pendingReviewActionByChangeId = ref<Record<string, ChangesReviewAction>>({})

const fileChanges = computed(() => workspaceSession.activeSnapshot?.fileChanges ?? [])
const collapsedChangeIds = computed(() => workspaceSession.activeCollapsedFileChangeIds)
let layoutSource: FileChange[] | undefined
let layoutSessionId: string | undefined
const layoutIndexById = new Map<string, number>()
let indexedGeneration = 0
let changeViewportRaf: number | undefined
let projectionMeasureRaf: number | undefined
let changeViewportResizeObserver: ResizeObserver | undefined
let layoutLineScale = 1
let projectedExpandedTotal = 0

function getEffectiveLineScale(lineCount: number, lineScale: number): number {
  if (lineCount <= 0) {
    return 1
  }
  const logicalHeight = lineCount * CHANGE_FILE_DIFF_LINE_HEIGHT
  const physicalHeight = Math.max(CHANGE_FILE_DIFF_LINE_HEIGHT, logicalHeight / lineScale)
  return logicalHeight / physicalHeight
}

function createFileChangeLayout(change: FileChange): FileChangeLayout {
  const changeId = getFileChangeId(change)
  const diff = getReviewDiff(change)
  const lineCount = diff ? diffDocumentIndexService.getLineCount(changeId, diff) : 0
  const lineScale = getEffectiveLineScale(lineCount, layoutLineScale)
  return {
    changeId,
    diff,
    lineCount,
    lineScale,
    size: getFileChangeLayoutSize(
      lineCount,
      !collapsedChangeIds.value.has(changeId),
      Boolean(diff),
      lineScale
    )
  }
}

function getProjectedExpandedTotal(lineScale: number): number {
  let total = Math.max(0, fileChangeLayouts.value.length - 1) * CHANGE_LIST_GAP
  for (const layout of fileChangeLayouts.value) {
    total += getFileChangeLayoutSize(
      layout.lineCount,
      true,
      Boolean(layout.diff),
      getEffectiveLineScale(layout.lineCount, lineScale)
    )
  }
  return total
}

function findLayoutLineScale(): number {
  let lineScale = 1
  for (let iteration = 0; iteration < 30; iteration += 1) {
    if (getProjectedExpandedTotal(lineScale) <= CHANGE_LIST_MAX_HEIGHT) {
      return lineScale
    }
    lineScale *= 2
  }
  return lineScale
}

function applyLayoutLineScale(lineScale: number): void {
  layoutLineScale = lineScale
  fileChangeLayouts.value = fileChangeLayouts.value.map((layout) => {
    const effectiveLineScale = getEffectiveLineScale(layout.lineCount, lineScale)
    return {
      ...layout,
      lineScale: effectiveLineScale,
      size: getFileChangeLayoutSize(
        layout.lineCount,
        !collapsedChangeIds.value.has(layout.changeId),
        Boolean(layout.diff),
        effectiveLineScale
      )
    }
  })
  projectedExpandedTotal = getProjectedExpandedTotal(lineScale)
}

function syncFileChangeProjection(sessionId: string | undefined, changes: FileChange[]): void {
  const canAppend = sessionId === layoutSessionId && changes === layoutSource
  const previousLength = canAppend ? fileChangeLayouts.value.length : 0

  if (!canAppend || changes.length < previousLength) {
    layoutLineScale = 1
    fileChangeLayouts.value = changes.map(createFileChangeLayout)
    applyLayoutLineScale(findLayoutLineScale())
    layoutIndexById.clear()
    fileChangeLayouts.value.forEach((layout, index) => layoutIndexById.set(layout.changeId, index))
    fileChangeStats.value = countFileChangeStats(changes)
    indexedGeneration += 1
    diffDocuments.value = new Map()
    projectionResetVersion.value += 1
  } else if (changes.length > previousLength) {
    for (let index = previousLength; index < changes.length; index += 1) {
      const change = changes[index]
      if (change) {
        const layout = createFileChangeLayout(change)
        layoutIndexById.set(layout.changeId, index)
        if (fileChangeLayouts.value.length > 0) {
          projectedExpandedTotal += CHANGE_LIST_GAP
        }
        projectedExpandedTotal += getFileChangeLayoutSize(
          layout.lineCount,
          true,
          Boolean(layout.diff),
          layout.lineScale
        )
        fileChangeLayouts.value.push(layout)
      }
    }
    triggerRef(fileChangeLayouts)
    if (projectedExpandedTotal > CHANGE_LIST_MAX_HEIGHT) {
      const nextLineScale = findLayoutLineScale()
      if (nextLineScale !== layoutLineScale) {
        applyLayoutLineScale(nextLineScale)
        projectionResetVersion.value += 1
      }
    }
    fileChangeStats.value = countFileChangeStats(changes, previousLength, fileChangeStats.value)
  }

  layoutSessionId = sessionId
  layoutSource = changes
}

watch(
  [() => workspaceSession.activeSessionId, fileChanges, () => fileChanges.value.length],
  ([sessionId, changes]) => {
    if (sessionId !== layoutSessionId) {
      diffDocumentIndexService.reset()
      pendingReviewActionByChangeId.value = {}
      const viewport = changeListScrollRef.value?.getViewport()
      if (viewport) {
        viewport.scrollTop = 0
      }
      changeViewportMetrics.value = {
        scrollTop: 0,
        clientHeight: viewport?.clientHeight ?? 0
      }
    }
    syncFileChangeProjection(sessionId, changes)
  },
  { immediate: true }
)

watch(
  [() => workspaceSession.activeSessionId, () => fileChanges.value.length],
  ([threadId, count]) => {
    if (threadId && count > 0) recordChangesReviewImpression(window.localStorage, threadId)
  },
  { immediate: true }
)

const allChangesCollapsed = computed(
  () => fileChanges.value.length > 0 && collapsedChangeIds.value.size === fileChanges.value.length
)

const getChangeListScrollElement = (): HTMLElement | null =>
  changeListScrollRef.value?.getViewport() ?? null
const estimateChangeListSize = (index: number): number =>
  fileChangeLayouts.value[index]?.size ?? CHANGE_FILE_SUMMARY_HEIGHT
const getChangeListItemKey = (index: number): string | number =>
  fileChangeLayouts.value[index]?.changeId ?? index
const changeListOptions = computed<ChangeListVirtualizerOptions>(() => ({
  count: fileChangeLayouts.value.length,
  getScrollElement: getChangeListScrollElement,
  estimateSize: estimateChangeListSize,
  getItemKey: getChangeListItemKey,
  overscan: 1,
  gap: 4
}))
const changeListVirtualizer = useVirtualizer(changeListOptions)
watch(projectionResetVersion, () => {
  void nextTick(() => {
    if (projectionMeasureRaf !== undefined) {
      window.cancelAnimationFrame(projectionMeasureRaf)
    }
    projectionMeasureRaf = window.requestAnimationFrame(() => {
      projectionMeasureRaf = undefined
      changeListVirtualizer.value.measure()
      syncChangeViewportMetrics()
    })
  })
})
const virtualChangeItems = computed(() => changeListVirtualizer.value.getVirtualItems())
const virtualChangeTotalSize = computed(() => changeListVirtualizer.value.getTotalSize())
const virtualChangeRows = computed(() =>
  createVirtualFileChangeRows(virtualChangeItems.value, fileChanges.value).flatMap(
    ({ virtualItem, change }) => {
      const layout = fileChangeLayouts.value[virtualItem.index]
      if (!layout) {
        return []
      }
      const documentIndex = diffDocuments.value.get(layout.changeId)
      const visibleLineRange = getVisibleDiffLineRange(
        virtualItem.start,
        layout.lineCount,
        changeViewportMetrics.value.scrollTop,
        changeViewportMetrics.value.clientHeight,
        layout.lineScale
      )
      return [{ virtualItem, change, layout, documentIndex, visibleLineRange }]
    }
  )
)

function setDiffDocument(changeId: string, document: DiffDocumentIndex): void {
  if (diffDocuments.value.get(changeId) === document) {
    return
  }
  const next = new Map(diffDocuments.value)
  next.set(changeId, document)
  diffDocuments.value = next
}

async function ensureDiffDocument(layout: FileChangeLayout, generation: number): Promise<void> {
  const diff = layout.diff
  if (!diff) {
    return
  }
  const cached = diffDocumentIndexService.getCached(layout.changeId, diff)
  if (cached) {
    setDiffDocument(layout.changeId, cached)
    return
  }

  const document = await diffDocumentIndexService.request(layout.changeId, diff)
  if (
    !document ||
    generation !== indexedGeneration ||
    fileChangeLayouts.value[layoutIndexById.get(layout.changeId) ?? -1]?.diff !== diff
  ) {
    return
  }
  setDiffDocument(layout.changeId, document)
}

watch(
  virtualChangeRows,
  (rows) => {
    const generation = indexedGeneration
    for (const { layout } of rows) {
      if (!collapsedChangeIds.value.has(layout.changeId)) {
        void ensureDiffDocument(layout, generation)
      }
    }
  },
  { immediate: true }
)

watch(changeListScrollRef, () => {
  changeViewportResizeObserver?.disconnect()
  const viewport = changeListScrollRef.value?.getViewport()
  if (viewport) {
    changeViewportResizeObserver = new ResizeObserver(handleChangeListScroll)
    changeViewportResizeObserver.observe(viewport)
  }
  void nextTick(syncChangeViewportMetrics)
})

function syncChangeViewportMetrics(): void {
  const viewport = changeListScrollRef.value?.getViewport()
  if (!viewport) {
    return
  }
  const next = { scrollTop: viewport.scrollTop, clientHeight: viewport.clientHeight }
  if (
    next.scrollTop !== changeViewportMetrics.value.scrollTop ||
    next.clientHeight !== changeViewportMetrics.value.clientHeight
  ) {
    changeViewportMetrics.value = next
  }
}

function handleChangeListScroll(): void {
  if (changeViewportRaf !== undefined) {
    return
  }
  changeViewportRaf = window.requestAnimationFrame(() => {
    changeViewportRaf = undefined
    syncChangeViewportMetrics()
  })
}

function isChangeExpanded(changeId: string): boolean {
  return !collapsedChangeIds.value.has(changeId)
}

function handleChangeToggle(
  event: Event,
  index: number,
  fileStart: number,
  layout: FileChangeLayout
): void {
  const details = event.currentTarget
  if (!(details instanceof HTMLDetailsElement)) {
    return
  }
  if (details.open === isChangeExpanded(layout.changeId)) {
    return
  }

  const viewport = changeListScrollRef.value?.getViewport()
  if (
    !details.open &&
    viewport &&
    viewport.scrollTop > fileStart &&
    viewport.scrollTop < fileStart + layout.size
  ) {
    viewport.scrollTop = fileStart
  }

  const nextCollapsedChangeIds = new Set(collapsedChangeIds.value)
  if (details.open) {
    nextCollapsedChangeIds.delete(layout.changeId)
  } else {
    nextCollapsedChangeIds.add(layout.changeId)
  }
  workspaceSession.setActiveCollapsedFileChangeIds(nextCollapsedChangeIds)

  const nextLayout = {
    ...layout,
    size: getFileChangeLayoutSize(
      layout.lineCount,
      details.open,
      Boolean(layout.diff),
      layout.lineScale
    )
  }
  fileChangeLayouts.value[index] = nextLayout
  triggerRef(fileChangeLayouts)
  changeListVirtualizer.value.resizeItem(index, nextLayout.size)
  if (details.open) {
    void ensureDiffDocument(nextLayout, indexedGeneration)
  }
}

function setAllChangesCollapsed(collapsed: boolean): void {
  workspaceSession.setActiveCollapsedFileChangeIds(
    collapsed ? new Set(fileChangeLayouts.value.map((layout) => layout.changeId)) : new Set()
  )
  fileChangeLayouts.value = fileChangeLayouts.value.map((layout) => ({
    ...layout,
    size: getFileChangeLayoutSize(
      layout.lineCount,
      !collapsed,
      Boolean(layout.diff),
      layout.lineScale
    )
  }))
  triggerRef(fileChangeLayouts)
  projectionResetVersion.value += 1
}

async function copyChangePath(path: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(path)
  } catch {
    toast.error('无法复制文件路径', '请检查系统剪贴板权限后重试')
  }
}

async function launchReviewAction(
  change: FileChange,
  changeId: string,
  action: ChangesReviewAction
): Promise<void> {
  const threadId = workspaceSession.activeSessionId
  if (!threadId || pendingReviewActionByChangeId.value[changeId]) return
  pendingReviewActionByChangeId.value = {
    ...pendingReviewActionByChangeId.value,
    [changeId]: action
  }
  recordChangesReviewAttempt(window.localStorage, action)
  try {
    await window.api.codingAgent.openChangedFile({ threadId, changePath: change.path, action })
    recordChangesReviewSuccess(window.localStorage, action)
  } catch (error) {
    recordChangesReviewFailure(window.localStorage, error)
    toast.error('无法打开此文件', '文件可能已移动或不在项目目录中')
  } finally {
    const next = { ...pendingReviewActionByChangeId.value }
    delete next[changeId]
    pendingReviewActionByChangeId.value = next
  }
}

function getDiffContentHeight(layout: FileChangeLayout): number {
  return layout.size - CHANGE_FILE_SUMMARY_HEIGHT - CHANGE_FILE_DIFF_BORDER_HEIGHT
}

function getVisibleDiffRowTop(
  fileStart: number,
  layout: FileChangeLayout,
  range: { start: number; end: number }
): number | undefined {
  if (layout.lineScale === 1) {
    return undefined
  }
  const diffStart = fileStart + CHANGE_FILE_SUMMARY_HEIGHT + CHANGE_FILE_DIFF_BORDER_HEIGHT
  const renderedHeight = (range.end - range.start) * CHANGE_FILE_DIFF_LINE_HEIGHT
  const desiredTop =
    changeViewportMetrics.value.scrollTop -
    diffStart -
    CHANGE_FILE_LINE_OVERSCAN * CHANGE_FILE_DIFF_LINE_HEIGHT
  return Math.max(0, Math.min(getDiffContentHeight(layout) - renderedHeight, desiredTop))
}

function handleDiffWheel(event: WheelEvent): void {
  if (event.deltaY === 0) {
    return
  }

  const target = event.target
  if (event.shiftKey && target instanceof Element) {
    const diffViewport = target
      .closest('.diff-viewer')
      ?.querySelector<HTMLElement>("[data-slot='scroll-area-viewport']")
    if (diffViewport && diffViewport.scrollWidth > diffViewport.clientWidth) {
      diffViewport.scrollLeft += event.deltaY
      event.preventDefault()
      return
    }
  }

  const viewport = changeListScrollRef.value?.getViewport()
  if (!viewport) {
    return
  }
  viewport.scrollTop += event.deltaY
  event.preventDefault()
}

onBeforeUnmount(() => {
  indexedGeneration += 1
  diffDocumentIndexService.reset()
  changeViewportResizeObserver?.disconnect()
  if (changeViewportRaf !== undefined) {
    window.cancelAnimationFrame(changeViewportRaf)
  }
  if (projectionMeasureRaf !== undefined) {
    window.cancelAnimationFrame(projectionMeasureRaf)
  }
})
</script>

<template>
  <section class="session-section session-section--changes" role="tabpanel">
    <header class="session-section__header">
      <div class="session-section__title">
        <h3>Changes</h3>
        <span v-if="fileChanges.length" class="session-panel-count">{{ fileChanges.length }}</span>
      </div>
      <div v-if="fileChanges.length" class="change-header-actions">
        <BaseIconButton
          size="small"
          :label="allChangesCollapsed ? '全部展开' : '全部折叠'"
          @click="setAllChangesCollapsed(!allChangesCollapsed)"
        >
          <ChevronsUpDown v-if="allChangesCollapsed" :size="14" />
          <ChevronsDownUp v-else :size="14" />
        </BaseIconButton>
      </div>
      <span v-if="fileChanges.length" class="change-stats">
        <span class="change-stats__additions">
          {{ formatAdditions(fileChangeStats.additions) }}
        </span>
        <span class="change-stats__separator">/</span>
        <span class="change-stats__deletions">
          {{ formatDeletions(fileChangeStats.deletions) }}
        </span>
      </span>
    </header>

    <ScrollArea
      ref="changeListScrollRef"
      class="change-file-scroll"
      :vertical-size="7"
      @scroll="handleChangeListScroll"
    >
      <div v-if="fileChanges.length === 0" class="session-empty">No file changes</div>
      <div v-else class="change-file-list" :style="{ height: `${virtualChangeTotalSize}px` }">
        <details
          v-for="{
            virtualItem,
            change,
            layout,
            documentIndex,
            visibleLineRange
          } in virtualChangeRows"
          :key="layout.changeId"
          :data-index="virtualItem.index"
          class="change-file"
          :style="{ top: `${virtualItem.start}px`, height: `${layout.size}px` }"
          :open="isChangeExpanded(layout.changeId)"
          @toggle="handleChangeToggle($event, virtualItem.index, virtualItem.start, layout)"
        >
          <summary class="change-file__summary">
            <span class="change-file__main">
              <span class="change-file__title">{{
                formatFileChangePath(change.path, workspaceSession.activeSnapshot?.cwd)
              }}</span>
            </span>
            <span class="change-file__actions" @click.prevent.stop @keydown.stop>
              <BaseIconButton
                size="small"
                label="复制文件路径"
                @click="copyChangePath(change.path)"
              >
                <Copy :size="13" />
              </BaseIconButton>
              <BaseIconButton
                v-if="change.changeType !== 'deleted'"
                size="small"
                label="用默认应用打开"
                :disabled="Boolean(pendingReviewActionByChangeId[layout.changeId])"
                @click="launchReviewAction(change, layout.changeId, 'open')"
              >
                <ExternalLink :size="13" />
              </BaseIconButton>
              <BaseIconButton
                size="small"
                label="在文件管理器中显示"
                :disabled="Boolean(pendingReviewActionByChangeId[layout.changeId])"
                @click="launchReviewAction(change, layout.changeId, 'reveal')"
              >
                <FolderSearch :size="13" />
              </BaseIconButton>
            </span>
            <strong class="change-file__stats">
              <span class="change-stats__additions">{{ formatAdditions(change.additions) }}</span>
              <span class="change-stats__deletions">{{ formatDeletions(change.deletions) }}</span>
            </strong>
          </summary>

          <div
            v-if="isChangeExpanded(layout.changeId)"
            class="change-file__diff"
            :style="{ height: `${getDiffContentHeight(layout)}px` }"
            @wheel="handleDiffWheel"
          >
            <DiffViewer
              v-if="layout.diff && documentIndex"
              :diff="layout.diff"
              :document-index="documentIndex"
              :visible-start-line="visibleLineRange.start"
              :visible-end-line="visibleLineRange.end"
              :visible-start-offset="
                getVisibleDiffRowTop(virtualItem.start, layout, visibleLineRange)
              "
              :content-height="getDiffContentHeight(layout)"
              :line-height="CHANGE_FILE_DIFF_LINE_HEIGHT"
              expand-vertically
            />
            <pre v-else-if="!layout.diff">No diff available</pre>
          </div>
        </details>
      </div>
    </ScrollArea>
  </section>
</template>
