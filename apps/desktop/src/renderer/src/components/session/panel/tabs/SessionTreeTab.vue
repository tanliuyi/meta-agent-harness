<script setup lang="ts">
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  ref,
  watch,
  type ComponentPublicInstance
} from 'vue'
import { useVirtualizer, type VirtualItem } from '@tanstack/vue-virtual'
import { GitBranch, LocateFixed, Search } from 'lucide-vue-next'
import { BaseButton, BaseContextMenu, BaseSegmentedControl } from '@renderer/components/base'
import BaseField from '@renderer/components/base/BaseField.vue'
import ScrollArea from '@renderer/components/ui/scroll-area/ScrollArea.vue'
import { useSessionContext } from '@renderer/composables/useSessionContext'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import type { AgentTreeFilterMode } from '@shared/coding-agent/types'
import {
  canForkTreeEntry,
  canNavigateTreeEntry,
  getSessionTreeIndent as getSessionTreeIndentValue,
  getTreeEntryKindLabel,
  getTreeEntryMenuSections,
  getTreeEntryTitle,
  getTreeEntryTone,
  isCompressedTreeDepth as isCompressedTreeDepthValue
} from '../display/sessionTreeDisplay'
import {
  sessionTreeFilterOptions,
  type SessionTreeEntryView,
  type SessionTreeFilter
} from '../model/types'
import {
  estimateSessionTreeRowSize,
  getSessionTreeVirtualItemKey,
  resolveSessionTreeEndFollowState
} from './display/sessionTreeVirtualization'

const { panelTabRequest } = useSessionContext()

const MAX_VISIBLE_TREE_DEPTH = 6
const TREE_INDENT_PX = 8
const TREE_ROW_GAP_PX = 2
const TREE_LIST_PADDING_TOP_PX = 2
const TREE_LIST_PADDING_BOTTOM_PX = 4
const TREE_NEAR_END_DISTANCE_PX = 32
const TREE_STICKY_END_DISTANCE_PX = 2

type VirtualSessionTreeRow = {
  entry: SessionTreeEntryView
  virtualItem: VirtualItem
  transform: string
}

type ScrollAreaInstance = {
  getViewport: () => HTMLElement | undefined
}

const workspaceSession = useWorkspaceSessionStore()
const agentSettings = useAgentSettingsStore()

const currentEntryId = computed(() => workspaceSession.activeSnapshot?.currentEntryId)
const sessionTreeEntryCount = computed(
  () =>
    workspaceSession.activeSessionTreeBranches?.totalEntries ??
    workspaceSession.activeSnapshot?.sessionTree?.length ??
    0
)
const visibleTreeEntries = computed<SessionTreeEntryView[]>(
  () => workspaceSession.activeSessionTreeBranches?.rows ?? []
)
const visibleTreeEntryIds = computed(() => new Set(visibleTreeEntries.value.map((row) => row.id)))
const visibleTreeEntryIndexById = computed(() => {
  const indexById = new Map<string, number>()
  visibleTreeEntries.value.forEach((entry, index) => {
    indexById.set(entry.id, index)
  })
  return indexById
})

const selectedTreeEntryId = ref<string>()
const selectedTreeLabelDraft = ref('')
const isTreeLabelDialogOpen = ref(false)
const treeLabelDialogEntryId = ref<string>()
const sessionTreeScrollRef = ref<ScrollAreaInstance>()
const sessionTreeQuery = ref('')
const sessionTreeFilter = ref<SessionTreeFilter>('default')
const hasAppliedConfiguredTreeFilter = ref(false)
const shouldFollowTreeEnd = ref(true)
let sessionTreeQueryTimer: ReturnType<typeof setTimeout> | undefined
let retainedSessionTreeScrollOffset = 0
let isSessionTreeTabActive = false
let isTreeUserScrollLocked = false
let isProgrammaticTreeEndScroll = false
let hasInitializedSessionTreeEnd = false
let sessionTreeLoadSequence = 0
let sessionTreeEndSettleSequence = 0

if (!agentSettings.snapshot && !agentSettings.loading) {
  void agentSettings.load()
}

function getSessionTreeScrollElement(): HTMLElement | null {
  return sessionTreeScrollRef.value?.getViewport() ?? null
}

function getSessionTreeItemKey(index: number): string {
  return getSessionTreeVirtualItemKey(
    workspaceSession.activeSessionId,
    visibleTreeEntries.value[index],
    index
  )
}

function estimateSessionTreeItemSize(index: number): number {
  return estimateSessionTreeRowSize(visibleTreeEntries.value[index])
}

const sessionTreeVirtualizer = useVirtualizer(
  computed(() => ({
    count: visibleTreeEntries.value.length,
    getScrollElement: getSessionTreeScrollElement,
    getItemKey: getSessionTreeItemKey,
    estimateSize: estimateSessionTreeItemSize,
    overscan: 10,
    gap: TREE_ROW_GAP_PX,
    anchorTo: shouldFollowTreeEnd.value ? ('end' as const) : ('start' as const),
    followOnAppend: 'auto' as const,
    scrollEndThreshold: TREE_NEAR_END_DISTANCE_PX,
    paddingStart: TREE_LIST_PADDING_TOP_PX,
    paddingEnd: TREE_LIST_PADDING_BOTTOM_PX
  }))
)
const virtualTreeItems = computed(() => sessionTreeVirtualizer.value.getVirtualItems())
const virtualTreeTotalSize = computed(() => sessionTreeVirtualizer.value.getTotalSize())
const virtualSessionTreeRows = computed<VirtualSessionTreeRow[]>(() => {
  const entries = visibleTreeEntries.value
  const virtualRows: VirtualSessionTreeRow[] = []

  for (const virtualItem of virtualTreeItems.value) {
    const entry = entries[virtualItem.index]
    if (entry) {
      virtualRows.push({
        entry,
        virtualItem,
        transform: `translateY(${virtualItem.start}px)`
      })
    }
  }

  return virtualRows
})

const selectedTreeEntry = computed(() => {
  const entryRows = visibleTreeEntries.value
  return (
    entryRows.find((row) => row.id === selectedTreeEntryId.value) ??
    entryRows.find((row) => row.id === currentEntryId.value) ??
    entryRows[0]
  )
})
const treeLabelDialogEntry = computed(() =>
  visibleTreeEntries.value.find((entry) => entry.id === treeLabelDialogEntryId.value)
)

watch(
  () => agentSettings.snapshot?.display.treeFilterMode,
  (mode) => {
    if (!mode || hasAppliedConfiguredTreeFilter.value) {
      return
    }
    sessionTreeFilter.value = toSessionTreeFilter(mode)
    hasAppliedConfiguredTreeFilter.value = true
  },
  { immediate: true }
)

watch(
  [visibleTreeEntries, visibleTreeEntryIds, currentEntryId],
  ([entryRows, entryIds, currentId]) => {
    if (selectedTreeEntryId.value && entryIds.has(selectedTreeEntryId.value)) {
      return
    }
    selectedTreeEntryId.value =
      entryRows.find((row) => row.id === currentId)?.id ?? entryRows[0]?.id
  },
  { immediate: true }
)

watch(
  [
    () => workspaceSession.activeSessionId,
    () => workspaceSession.activeSnapshot?.currentEntryId,
    () => workspaceSession.activeSessionTreeBranchesState?.revision,
    sessionTreeFilter
  ],
  ([sessionId, , , filter], previous) => {
    if (!previous || sessionId !== previous[0] || filter !== previous[3]) {
      resetSessionTreeEndFollow()
    }
    queueLoadSessionTreeBranchesView()
  },
  { immediate: true }
)

watch(sessionTreeQuery, () => {
  resetSessionTreeEndFollow()
  queueLoadSessionTreeBranchesView(180)
})

onActivated(() => {
  isSessionTreeTabActive = true
  void restoreSessionTreeScrollOffset()
})

onDeactivated(() => {
  isSessionTreeTabActive = false
  isProgrammaticTreeEndScroll = false
  sessionTreeEndSettleSequence += 1
})

onBeforeUnmount(() => {
  isSessionTreeTabActive = false
  isProgrammaticTreeEndScroll = false
  sessionTreeEndSettleSequence += 1
  clearQueuedSessionTreeBranchesView()
})

watch(
  panelTabRequest,
  (request) => {
    if (request?.tabId !== 'tree') {
      return
    }
    const entryId = request.params?.entryId
    if (typeof entryId === 'string') {
      void focusSessionTreeEntry(entryId)
    }
  },
  { immediate: true }
)

watch(
  () => workspaceSession.treeFocusRequest,
  (request) => {
    if (request) {
      void focusSessionTreeEntry(request.entryId)
    }
  },
  { immediate: true }
)

watch(
  () => selectedTreeEntry.value?.id,
  () => {
    if (!isTreeLabelDialogOpen.value) {
      selectedTreeLabelDraft.value = selectedTreeEntry.value?.label ?? ''
    }
  },
  { immediate: true }
)

watch(
  () => selectedTreeEntry.value?.label,
  (label) => {
    if (!isTreeLabelDialogOpen.value) {
      selectedTreeLabelDraft.value = label ?? ''
    }
  }
)

watch(
  () => treeLabelDialogEntry.value?.label,
  (label) => {
    if (isTreeLabelDialogOpen.value) {
      selectedTreeLabelDraft.value = label ?? ''
    }
  }
)

async function loadSessionTreeBranchesView(): Promise<void> {
  const loadSequence = ++sessionTreeLoadSequence
  const shouldFollowAfterLoad = shouldFollowTreeEnd.value && !isTreeUserScrollLocked
  const requiresEndInitialization = !hasInitializedSessionTreeEnd
  await workspaceSession.loadActiveSessionTreeBranches({
    query: sessionTreeQuery.value,
    filter: sessionTreeFilter.value
  })
  if (loadSequence !== sessionTreeLoadSequence) {
    return
  }
  await initializeSessionTreeEndIfNeeded()
  if (
    !requiresEndInitialization &&
    shouldFollowAfterLoad &&
    !isTreeUserScrollLocked &&
    isSessionTreeTabActive
  ) {
    await settleSessionTreeAtEnd()
  }
}

function queueLoadSessionTreeBranchesView(delayMs = 0): void {
  clearQueuedSessionTreeBranchesView()
  if (delayMs <= 0) {
    void loadSessionTreeBranchesView()
    return
  }
  sessionTreeQueryTimer = setTimeout(() => {
    sessionTreeQueryTimer = undefined
    void loadSessionTreeBranchesView()
  }, delayMs)
}

function clearQueuedSessionTreeBranchesView(): void {
  if (sessionTreeQueryTimer === undefined) {
    return
  }
  clearTimeout(sessionTreeQueryTimer)
  sessionTreeQueryTimer = undefined
}

function resetSessionTreeEndFollow(): void {
  sessionTreeLoadSequence += 1
  sessionTreeEndSettleSequence += 1
  retainedSessionTreeScrollOffset = 0
  isProgrammaticTreeEndScroll = false
  isTreeUserScrollLocked = false
  shouldFollowTreeEnd.value = true
  hasInitializedSessionTreeEnd = false
}

function getSessionTreeDistanceToEnd(): number | undefined {
  const viewport = sessionTreeScrollRef.value?.getViewport()
  if (!viewport) {
    return undefined
  }
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
}

function holdSessionTreeUserScroll(): void {
  sessionTreeEndSettleSequence += 1
  isProgrammaticTreeEndScroll = false
  isTreeUserScrollLocked = true
  shouldFollowTreeEnd.value = false
}

function updateSessionTreeScrollState(event?: Event): void {
  const eventTarget = event?.currentTarget
  const viewport =
    eventTarget instanceof HTMLElement ? eventTarget : sessionTreeScrollRef.value?.getViewport()
  if (!viewport) {
    return
  }
  retainedSessionTreeScrollOffset = viewport.scrollTop
  if (isProgrammaticTreeEndScroll) {
    return
  }
  const distanceToEnd = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
  const followState = resolveSessionTreeEndFollowState(
    distanceToEnd,
    isTreeUserScrollLocked,
    TREE_NEAR_END_DISTANCE_PX,
    TREE_STICKY_END_DISTANCE_PX
  )
  isTreeUserScrollLocked = followState.userScrollLocked
  shouldFollowTreeEnd.value = followState.shouldFollow
}

function handleSessionTreeWheel(event: WheelEvent): void {
  if (Math.abs(event.deltaY) < 1) {
    return
  }
  const distanceToEnd = getSessionTreeDistanceToEnd()
  if (
    event.deltaY < 0 ||
    distanceToEnd === undefined ||
    distanceToEnd > TREE_STICKY_END_DISTANCE_PX
  ) {
    holdSessionTreeUserScroll()
  }
}

function handleSessionTreeScrollbarPointerDown(): void {
  holdSessionTreeUserScroll()
}

function waitForSessionTreeFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function settleSessionTreeAtEnd(): Promise<void> {
  const settleSequence = ++sessionTreeEndSettleSequence
  isProgrammaticTreeEndScroll = true
  sessionTreeVirtualizer.value.measure()
  await nextTick()

  for (let frame = 0; frame < 3; frame += 1) {
    if (
      settleSequence !== sessionTreeEndSettleSequence ||
      !isSessionTreeTabActive ||
      isTreeUserScrollLocked
    ) {
      return
    }
    sessionTreeVirtualizer.value.scrollToEnd({ behavior: 'auto' })
    await waitForSessionTreeFrame()
  }

  if (settleSequence !== sessionTreeEndSettleSequence) {
    return
  }
  isProgrammaticTreeEndScroll = false
  const viewport = sessionTreeScrollRef.value?.getViewport()
  viewport?.dispatchEvent(new Event('scroll'))
  await nextTick()
}

async function initializeSessionTreeEndIfNeeded(): Promise<void> {
  if (
    hasInitializedSessionTreeEnd ||
    !isSessionTreeTabActive ||
    visibleTreeEntries.value.length === 0
  ) {
    return
  }
  hasInitializedSessionTreeEnd = true
  await settleSessionTreeAtEnd()
}

async function restoreSessionTreeScrollOffset(): Promise<void> {
  await nextTick()
  if (!isSessionTreeTabActive) {
    return
  }
  const viewport = sessionTreeScrollRef.value?.getViewport()
  if (!viewport) {
    return
  }
  if (shouldFollowTreeEnd.value) {
    hasInitializedSessionTreeEnd = visibleTreeEntries.value.length > 0
    await settleSessionTreeAtEnd()
    return
  }

  sessionTreeVirtualizer.value.measure()
  await nextTick()
  const maxOffset = Math.max(sessionTreeVirtualizer.value.getTotalSize() - viewport.clientHeight, 0)
  retainedSessionTreeScrollOffset = Math.min(retainedSessionTreeScrollOffset, maxOffset)
  sessionTreeVirtualizer.value.scrollToOffset(retainedSessionTreeScrollOffset, {
    behavior: 'auto'
  })
  viewport.dispatchEvent(new Event('scroll'))
  await nextTick()
}

function toSessionTreeFilter(mode: AgentTreeFilterMode): SessionTreeFilter {
  switch (mode) {
    case 'no-tools':
      return 'no-tools'
    case 'user-only':
      return 'user'
    case 'labeled-only':
      return 'labeled'
    case 'default':
      return 'default'
    case 'all':
      return 'all'
  }
}

function getSessionTreeIndent(visualDepth: number): string {
  return getSessionTreeIndentValue(visualDepth, MAX_VISIBLE_TREE_DEPTH, TREE_INDENT_PX)
}

function isCompressedTreeDepth(visualDepth: number): boolean {
  return isCompressedTreeDepthValue(visualDepth, MAX_VISIBLE_TREE_DEPTH)
}

function isSelectedTreeEntry(entry: SessionTreeEntryView): boolean {
  return selectedTreeEntry.value?.id === entry.id
}

function selectTreeEntry(entry: SessionTreeEntryView): void {
  selectedTreeEntryId.value = entry.id
}

async function runTreeEntryMenuAction(
  actionId: string,
  entry: SessionTreeEntryView
): Promise<void> {
  selectedTreeEntryId.value = entry.id
  switch (actionId) {
    case 'navigate':
      await navigateTreeNode(entry)
      break
    case 'fork':
      await forkTreeNode(entry)
      break
    case 'label':
      openTreeLabelDialog(entry)
      break
    case 'clear-label':
      await clearTreeLabel(entry)
      break
    case 'copy-id':
      await copyTreeEntryId(entry)
      break
  }
}

function openTreeLabelDialog(entry: SessionTreeEntryView): void {
  selectedTreeEntryId.value = entry.id
  treeLabelDialogEntryId.value = entry.id
  selectedTreeLabelDraft.value = entry.label ?? ''
  isTreeLabelDialogOpen.value = true
}

function handleTreeLabelDialogOpenChange(open: boolean): void {
  if (open) {
    isTreeLabelDialogOpen.value = true
    return
  }
  closeTreeLabelDialog()
}

function closeTreeLabelDialog(): void {
  isTreeLabelDialogOpen.value = false
  treeLabelDialogEntryId.value = undefined
  selectedTreeLabelDraft.value = selectedTreeEntry.value?.label ?? ''
}

async function locateCurrentTreeNode(): Promise<void> {
  if (!currentEntryId.value) {
    return
  }
  await focusSessionTreeEntry(currentEntryId.value)
}

async function focusSessionTreeEntry(entryId: string): Promise<void> {
  if (!visibleTreeEntryIds.value.has(entryId)) {
    sessionTreeFilter.value = 'all'
    sessionTreeQuery.value = ''
    await loadSessionTreeBranchesView()
  }
  selectedTreeEntryId.value = entryId
  await nextTick()
  scrollTreeEntryIntoView(entryId)
}

function scrollTreeEntryIntoView(entryId: string): void {
  const targetIndex = visibleTreeEntryIndexById.value.get(entryId) ?? -1
  if (targetIndex === -1) {
    return
  }
  holdSessionTreeUserScroll()
  sessionTreeVirtualizer.value.scrollToIndex(targetIndex, { align: 'center', behavior: 'smooth' })
}

function measureSessionTreeItem(refValue: Element | ComponentPublicInstance | null): void {
  const element = refValue instanceof Element ? refValue : refValue?.$el
  if (element instanceof Element) {
    sessionTreeVirtualizer.value.measureElement(element)
  }
}

async function forkTreeNode(entry: SessionTreeEntryView): Promise<void> {
  if (!canForkTreeEntry(entry)) {
    return
  }
  await workspaceSession.forkActiveSession(entry.id)
}

async function navigateTreeNode(entry: SessionTreeEntryView): Promise<void> {
  if (!canNavigateTreeEntry(entry)) {
    return
  }
  await workspaceSession.navigateActiveSessionTree(entry.id)
}

async function copyTreeEntryId(entry: SessionTreeEntryView): Promise<void> {
  await navigator.clipboard.writeText(entry.id)
}

async function saveSelectedTreeLabel(): Promise<void> {
  const entry = treeLabelDialogEntry.value ?? selectedTreeEntry.value
  if (!entry) {
    return
  }
  await workspaceSession.setActiveSessionEntryLabel(entry.id, selectedTreeLabelDraft.value)
  closeTreeLabelDialog()
  await loadSessionTreeBranchesView()
  await focusSessionTreeEntry(entry.id)
}

async function clearTreeLabel(entry: SessionTreeEntryView): Promise<void> {
  await workspaceSession.setActiveSessionEntryLabel(entry.id, '')
  await loadSessionTreeBranchesView()
  await focusSessionTreeEntry(entry.id)
}

async function clearSelectedTreeLabel(): Promise<void> {
  const entry = treeLabelDialogEntry.value ?? selectedTreeEntry.value
  if (!entry) {
    return
  }
  selectedTreeLabelDraft.value = ''
  await clearTreeLabel(entry)
  closeTreeLabelDialog()
}
</script>

<template>
  <section class="session-section session-section--tree" role="tabpanel">
    <header class="session-section__header session-tree-header">
      <div class="session-section__title">
        <GitBranch class="session-tree-header__icon" :size="14" aria-hidden="true" />
        <h3>SESSION TREE</h3>
        <span v-if="sessionTreeEntryCount" class="session-tree-count">
          {{ visibleTreeEntries.length }}<span aria-hidden="true">/</span
          >{{ sessionTreeEntryCount }}
        </span>
      </div>
      <BaseButton
        class="session-tree-locate"
        size="sm"
        variant="ghost"
        :disabled="!currentEntryId"
        title="定位当前节点"
        @click="locateCurrentTreeNode"
      >
        <template #icon><LocateFixed :size="14" /></template>
        定位
      </BaseButton>
    </header>
    <div v-if="sessionTreeEntryCount === 0" class="session-empty">No session entries</div>
    <template v-else>
      <div class="session-tree-toolbar">
        <div class="session-tree-search">
          <Search :size="13" aria-hidden="true" />
          <BaseField
            id="session-tree-search"
            v-model="sessionTreeQuery"
            aria-label="搜索会话树"
            type="search"
            placeholder="搜索节点..."
          />
          <span class="session-tree-search__prompt" aria-hidden="true">_</span>
        </div>
        <BaseSegmentedControl
          size="small"
          label="树节点过滤器"
          :model-value="sessionTreeFilter"
          :options="sessionTreeFilterOptions"
          @update:model-value="sessionTreeFilter = $event"
        />
      </div>
      <div v-if="workspaceSession.activeSessionTreeBranchesLoading" class="session-empty">
        Loading tree...
      </div>
      <div v-if="workspaceSession.activeSessionTreeBranchesError" class="session-empty">
        {{ workspaceSession.activeSessionTreeBranchesError }}
      </div>
      <div v-if="visibleTreeEntries.length === 0" class="session-empty">No matching entries</div>
      <ScrollArea
        v-else
        ref="sessionTreeScrollRef"
        class="session-tree"
        :vertical-size="7"
        @scroll="updateSessionTreeScrollState"
        @scrollbar-pointer-down="handleSessionTreeScrollbarPointerDown"
        @wheel.passive="handleSessionTreeWheel"
      >
        <div class="session-tree__virtual" :style="{ height: `${virtualTreeTotalSize}px` }">
          <BaseContextMenu
            v-for="{ entry, virtualItem, transform } in virtualSessionTreeRows"
            :key="entry.id"
            v-memo="[
              entry,
              entry.id === selectedTreeEntryId,
              entry.id === currentEntryId,
              virtualItem.index === 0,
              virtualItem.index === visibleTreeEntries.length - 1,
              transform
            ]"
            :sections="getTreeEntryMenuSections(entry)"
            @select="(item) => runTreeEntryMenuAction(item.id, entry)"
          >
            <div
              :ref="measureSessionTreeItem"
              class="session-tree__item"
              :class="{
                'is-first': virtualItem.index === 0,
                'is-last': virtualItem.index === visibleTreeEntries.length - 1,
                'is-leaf': entry.leaf,
                'is-branch-point': entry.branchPoint,
                'is-current': entry.id === currentEntryId,
                'is-selected': isSelectedTreeEntry(entry),
                'is-truncated': entry.type === 'truncated'
              }"
              :data-index="virtualItem.index"
              :data-tree-entry-id="entry.id"
              :style="{
                '--session-tree-indent': getSessionTreeIndent(entry.visualDepth),
                '--session-tree-row-gap': `${TREE_ROW_GAP_PX}px`,
                transform
              }"
              :title="entry.depth > 0 ? `Depth ${entry.depth}` : undefined"
              @dblclick="navigateTreeNode(entry)"
            >
              <span
                class="session-tree__marker"
                :class="{
                  'is-current': entry.id === currentEntryId,
                  'is-branch-point': entry.branchPoint,
                  'is-leaf': entry.leaf
                }"
                aria-hidden="true"
              />
              <button type="button" class="session-tree__content" @click="selectTreeEntry(entry)">
                <span class="session-tree__row">
                  <span
                    class="session-tree-kind"
                    :class="`is-${getTreeEntryTone(entry, currentEntryId)}`"
                  >
                    {{ getTreeEntryKindLabel(entry) }}
                  </span>
                  <span class="session-tree__title">
                    {{ getTreeEntryTitle(entry) }}
                  </span>
                  <span v-if="isCompressedTreeDepth(entry.visualDepth)" class="session-tree__depth"
                    >D{{ entry.depth }}</span
                  >
                  <span v-if="entry.id === currentEntryId" class="session-tree__current">当前</span>
                </span>
                <span v-if="entry.summary" class="session-tree__summary">
                  {{ entry.summary }}
                </span>
              </button>
            </div>
          </BaseContextMenu>
        </div>
      </ScrollArea>
    </template>

    <Dialog :open="isTreeLabelDialogOpen" @update:open="handleTreeLabelDialogOpenChange">
      <DialogContent class="session-tree-label-dialog">
        <form class="session-tree-label-dialog__form" @submit.prevent="saveSelectedTreeLabel">
          <DialogHeader>
            <DialogTitle>{{ treeLabelDialogEntry?.label ? '编辑标签' : '添加标签' }}</DialogTitle>
            <DialogDescription>
              {{ treeLabelDialogEntry ? getTreeEntryTitle(treeLabelDialogEntry) : 'Tree entry' }}
            </DialogDescription>
          </DialogHeader>

          <BaseField
            id="session-tree-label"
            v-model="selectedTreeLabelDraft"
            label="Label"
            placeholder="Add label"
          />

          <DialogFooter>
            <BaseButton
              v-if="treeLabelDialogEntry?.label"
              type="button"
              size="sm"
              variant="ghost"
              @click="clearSelectedTreeLabel"
            >
              Clear
            </BaseButton>
            <BaseButton type="button" size="sm" variant="ghost" @click="closeTreeLabelDialog">
              Cancel
            </BaseButton>
            <BaseButton type="submit" size="sm" variant="primary"> Save </BaseButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </section>
</template>
