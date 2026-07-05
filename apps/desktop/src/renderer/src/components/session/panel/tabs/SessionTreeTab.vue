<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue'
import { useVirtualizer, type VirtualItem } from '@tanstack/vue-virtual'
import { BaseButton, BaseContextMenu, BaseSegmentedControl } from '@renderer/components/base'
import BaseField from '@renderer/components/base/BaseField.vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import type {
  SessionTreeBranchEntryRow,
  SessionTreeBranchSegmentRow,
  SessionTreeViewMode
} from '@shared/coding-agent/types'
import {
  sessionTreeFilterOptions,
  sessionTreeViewOptions,
  type SessionTreeDisplayRow,
  type SessionTreeEntryView,
  type SessionTreeFilter
} from '../types'

const MAX_VISIBLE_TREE_DEPTH = 6
const TREE_INDENT_PX = 8
const TREE_ROW_ESTIMATE_PX = 42
const TREE_ROW_GAP_PX = 2
const TREE_LIST_PADDING_TOP_PX = 2
const TREE_LIST_PADDING_BOTTOM_PX = 4

type VirtualSessionTreeRow = {
  displayRow: SessionTreeDisplayRow
  virtualItem: VirtualItem
  transform: string
}

type TreeEntryMenuItem = {
  id: string
  label: string
  shortcut?: string
  disabled?: boolean
  danger?: boolean
}

type TreeEntryMenuSection = {
  label?: string
  items: TreeEntryMenuItem[]
}

const workspaceSession = useWorkspaceSessionStore()

const currentEntryId = computed(() => workspaceSession.activeSnapshot?.currentEntryId)
const sessionTreeEntryCount = computed(
  () =>
    workspaceSession.activeSessionTreeBranches?.totalEntries ??
    workspaceSession.activeSnapshot?.sessionTree?.length ??
    0
)
const visibleSessionTreeRows = computed<SessionTreeDisplayRow[]>(() =>
  (workspaceSession.activeSessionTreeBranches?.rows ?? []).map((row) =>
    row.kind === 'segment' ? toTreeSegmentDisplayRow(row) : toBranchEntryDisplayRow(row)
  )
)

const selectedTreeEntryId = ref<string>()
const selectedTreeLabelDraft = ref('')
const isTreeLabelDialogOpen = ref(false)
const treeLabelDialogEntryId = ref<string>()
const sessionTreeListRef = ref<HTMLElement>()
const sessionTreeQuery = ref('')
const sessionTreeFilter = ref<SessionTreeFilter>('all')
const sessionTreeViewMode = ref<SessionTreeViewMode>('branches')
let sessionTreeQueryTimer: ReturnType<typeof setTimeout> | undefined

const sessionTreeVirtualizer = useVirtualizer(
  computed(() => ({
    count: visibleSessionTreeRows.value.length,
    getScrollElement: () =>
      sessionTreeListRef.value?.closest<HTMLElement>("[data-slot='scroll-area-viewport']") ?? null,
    estimateSize: () => TREE_ROW_ESTIMATE_PX,
    overscan: 10,
    gap: TREE_ROW_GAP_PX,
    paddingStart: TREE_LIST_PADDING_TOP_PX,
    paddingEnd: TREE_LIST_PADDING_BOTTOM_PX
  }))
)
const virtualTreeItems = computed(() => sessionTreeVirtualizer.value.getVirtualItems())
const virtualTreeTotalSize = computed(() => sessionTreeVirtualizer.value.getTotalSize())
const virtualSessionTreeRows = computed<VirtualSessionTreeRow[]>(() => {
  const rows = visibleSessionTreeRows.value
  const virtualRows: VirtualSessionTreeRow[] = []

  for (const virtualItem of virtualTreeItems.value) {
    const displayRow = rows[virtualItem.index]
    if (displayRow) {
      virtualRows.push({
        displayRow,
        virtualItem,
        transform: `translateY(${virtualItem.start}px)`
      })
    }
  }

  return virtualRows
})

const selectedTreeEntry = computed(() => {
  const entryRows = visibleSessionTreeRows.value
    .filter((row): row is Extract<SessionTreeDisplayRow, { kind: 'entry' }> => row.kind === 'entry')
    .map((row) => row.row)
  return (
    entryRows.find((row) => row.id === selectedTreeEntryId.value) ??
    entryRows.find((row) => row.id === currentEntryId.value) ??
    entryRows[0]
  )
})
const treeLabelDialogEntry = computed(() =>
  getVisibleTreeEntries().find((entry) => entry.id === treeLabelDialogEntryId.value)
)

watch(
  [visibleSessionTreeRows, currentEntryId],
  ([rows, currentId]) => {
    const entryRows = rows
      .filter(
        (row): row is Extract<SessionTreeDisplayRow, { kind: 'entry' }> => row.kind === 'entry'
      )
      .map((row) => row.row)
    if (
      selectedTreeEntryId.value &&
      entryRows.some((row) => row.id === selectedTreeEntryId.value)
    ) {
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
    sessionTreeFilter,
    sessionTreeViewMode
  ],
  () => {
    queueLoadSessionTreeBranchesView()
  },
  { immediate: true }
)

watch(sessionTreeQuery, () => {
  queueLoadSessionTreeBranchesView(180)
})

onBeforeUnmount(() => {
  clearQueuedSessionTreeBranchesView()
})

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

function toBranchEntryDisplayRow(
  row: SessionTreeBranchEntryRow
): Extract<SessionTreeDisplayRow, { kind: 'entry' }> {
  return {
    kind: 'entry',
    id: row.id,
    depth: row.depth,
    visualDepth: row.visualDepth,
    row: {
      id: row.entryId,
      parentId: row.parentId,
      type: row.type,
      timestamp: row.timestamp,
      title: row.title,
      summary: row.summary,
      label: row.label,
      labelTimestamp: row.labelTimestamp,
      depth: row.depth,
      visualDepth: row.visualDepth,
      childCount: row.childCount,
      leaf: row.leaf,
      branchPoint: row.branchPoint,
      current: row.current
    }
  }
}

function toTreeSegmentDisplayRow(row: SessionTreeBranchSegmentRow): SessionTreeDisplayRow {
  return {
    kind: 'segment',
    id: row.id,
    count: row.count,
    depth: row.depth,
    visualDepth: row.visualDepth
  }
}

async function loadSessionTreeBranchesView(): Promise<void> {
  await workspaceSession.loadActiveSessionTreeBranches({
    query: sessionTreeQuery.value,
    filter: sessionTreeFilter.value,
    viewMode: sessionTreeViewMode.value
  })
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

function getSessionTreeIndent(visualDepth: number): string {
  return `${Math.min(visualDepth, MAX_VISIBLE_TREE_DEPTH) * TREE_INDENT_PX}px`
}

function isCompressedTreeDepth(visualDepth: number): boolean {
  return visualDepth > MAX_VISIBLE_TREE_DEPTH
}

function canForkTreeEntry(entry: SessionTreeEntryView): boolean {
  return entry.type !== 'truncated'
}

function canNavigateTreeEntry(entry: SessionTreeEntryView): boolean {
  return entry.type !== 'truncated'
}

function getVisibleTreeEntries(): SessionTreeEntryView[] {
  return visibleSessionTreeRows.value
    .filter((row): row is Extract<SessionTreeDisplayRow, { kind: 'entry' }> => row.kind === 'entry')
    .map((row) => row.row)
}

function getNavigateTreeActionLabel(entry: SessionTreeEntryView): string {
  return entry.type === 'message' && entry.title.startsWith('user:') ? '从这里编辑' : '从这里继续'
}

function getTreeEntryTitle(entry: SessionTreeEntryView): string {
  if (entry.label) {
    return entry.label
  }
  return entry.title.replace(/^(user|assistant|tool|toolResult):\s*/i, '').trim() || entry.title
}

function getTreeEntryKindLabel(entry: SessionTreeEntryView): string {
  if (entry.type === 'message') {
    if (entry.title.startsWith('user:')) {
      return '用户'
    }
    if (entry.title.startsWith('assistant:')) {
      return '助手'
    }
    return '消息'
  }
  switch (entry.type) {
    case 'label':
      return '标签'
    case 'model_change':
      return '模型'
    case 'thinking_level_change':
      return 'Thinking'
    case 'compaction':
      return '压缩'
    case 'branch_summary':
      return '摘要'
    case 'custom_message':
      return '自定义消息'
    case 'custom':
      return '自定义'
    case 'truncated':
      return '未加载'
    default:
      return entry.type
  }
}

function getTreeEntryTone(entry: SessionTreeEntryView): string {
  if (entry.current || entry.id === currentEntryId.value) {
    return 'current'
  }
  if (entry.label) {
    return 'labeled'
  }
  if (entry.type === 'message' && entry.title.startsWith('user:')) {
    return 'user'
  }
  if (entry.type === 'message' && entry.title.startsWith('assistant:')) {
    return 'assistant'
  }
  return 'default'
}

function getTreeEntryMenuSections(entry: SessionTreeEntryView): TreeEntryMenuSection[] {
  return [
    {
      label: getTreeEntryTitle(entry),
      items: [
        {
          id: 'navigate',
          label: getNavigateTreeActionLabel(entry),
          disabled: !canNavigateTreeEntry(entry)
        },
        {
          id: 'fork',
          label: '创建分支会话',
          disabled: !canForkTreeEntry(entry)
        }
      ]
    },
    {
      items: [
        { id: 'label', label: entry.label ? '编辑标签' : '添加标签' },
        {
          id: 'clear-label',
          label: '清除标签',
          disabled: !entry.label
        },
        { id: 'copy-id', label: '复制 Entry ID' }
      ]
    }
  ]
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
  if (!visibleSessionTreeRows.value.some((row) => row.kind === 'entry' && row.row.id === entryId)) {
    sessionTreeViewMode.value = 'entries'
    sessionTreeFilter.value = 'all'
    sessionTreeQuery.value = ''
    await loadSessionTreeBranchesView()
  }
  selectedTreeEntryId.value = entryId
  await nextTick()
  scrollTreeEntryIntoView(entryId)
}

function scrollTreeEntryIntoView(entryId: string): void {
  const targetIndex = visibleSessionTreeRows.value.findIndex(
    (row) => row.kind === 'entry' && row.row.id === entryId
  )
  if (targetIndex === -1) {
    return
  }
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
  <section class="session-section" role="tabpanel">
    <header class="session-section__header">
      <div class="session-section__title">
        <h3>Tree</h3>
        <span v-if="sessionTreeEntryCount" class="session-tree-count">
          {{ visibleSessionTreeRows.length }} / {{ sessionTreeEntryCount }}
        </span>
      </div>
      <BaseButton
        size="sm"
        variant="ghost"
        :disabled="!currentEntryId"
        @click="locateCurrentTreeNode"
      >
        定位当前
      </BaseButton>
    </header>
    <div v-if="sessionTreeEntryCount === 0" class="session-empty">No session entries</div>
    <template v-else>
      <div class="session-tree-toolbar">
        <BaseField
          id="session-tree-search"
          v-model="sessionTreeQuery"
          label="Search tree"
          type="search"
          placeholder="Search entries"
        />
        <BaseSegmentedControl
          label="Tree filter"
          :model-value="sessionTreeFilter"
          :options="sessionTreeFilterOptions"
          @update:model-value="sessionTreeFilter = $event"
        />
        <BaseSegmentedControl
          label="Tree view"
          :model-value="sessionTreeViewMode"
          :options="sessionTreeViewOptions"
          @update:model-value="sessionTreeViewMode = $event"
        />
      </div>
      <div v-if="workspaceSession.activeSessionTreeBranchesLoading" class="session-empty">
        Loading branches...
      </div>
      <div v-if="workspaceSession.activeSessionTreeBranchesError" class="session-empty">
        {{ workspaceSession.activeSessionTreeBranchesError }}
      </div>
      <div v-if="visibleSessionTreeRows.length === 0" class="session-empty">
        No matching entries
      </div>
      <div
        v-else
        ref="sessionTreeListRef"
        class="session-tree"
        :style="{ height: `${virtualTreeTotalSize}px` }"
      >
        <template
          v-for="{ displayRow, virtualItem, transform } in virtualSessionTreeRows"
          :key="displayRow.id"
        >
          <BaseContextMenu
            v-if="displayRow.kind === 'entry'"
            :sections="getTreeEntryMenuSections(displayRow.row)"
            @select="(item) => runTreeEntryMenuAction(item.id, displayRow.row)"
          >
            <div
              :ref="measureSessionTreeItem"
              class="session-tree__item"
              :class="{
                'is-current': displayRow.row.id === currentEntryId,
                'is-selected': isSelectedTreeEntry(displayRow.row),
                'is-truncated': displayRow.row.type === 'truncated'
              }"
              :data-index="virtualItem.index"
              :data-tree-entry-id="displayRow.row.id"
              :style="{
                '--session-tree-indent': getSessionTreeIndent(displayRow.visualDepth),
                transform
              }"
              :title="displayRow.depth > 0 ? `Depth ${displayRow.depth}` : undefined"
              @dblclick="navigateTreeNode(displayRow.row)"
              v-memo="[
                displayRow,
                virtualItem.index,
                transform,
                currentEntryId,
                selectedTreeEntry?.id
              ]"
            >
              <span
                class="session-tree__marker"
                :class="{
                  'is-current': displayRow.row.id === currentEntryId,
                  'is-branch-point': displayRow.row.branchPoint,
                  'is-leaf': displayRow.row.leaf
                }"
                aria-hidden="true"
              />
              <button
                type="button"
                class="session-tree__content"
                @click="selectTreeEntry(displayRow.row)"
              >
                <span class="session-tree__row">
                  <span class="session-tree-kind" :class="`is-${getTreeEntryTone(displayRow.row)}`">
                    {{ getTreeEntryKindLabel(displayRow.row) }}
                  </span>
                  <span class="session-tree__title">
                    {{ getTreeEntryTitle(displayRow.row) }}
                  </span>
                  <span
                    v-if="isCompressedTreeDepth(displayRow.row.visualDepth)"
                    class="session-tree__depth"
                    >D{{ displayRow.row.depth }}</span
                  >
                  <span v-if="displayRow.row.id === currentEntryId" class="session-tree__current"
                    >当前</span
                  >
                </span>
                <span v-if="displayRow.row.summary" class="session-tree__summary">
                  {{ displayRow.row.summary }}
                </span>
              </button>
            </div>
          </BaseContextMenu>
          <div
            v-else
            :ref="measureSessionTreeItem"
            class="session-tree__item is-segment"
            :data-index="virtualItem.index"
            :style="{
              '--session-tree-indent': getSessionTreeIndent(displayRow.visualDepth),
              transform
            }"
            :title="displayRow.depth > 0 ? `Depth ${displayRow.depth}` : undefined"
            v-memo="[displayRow, virtualItem.index, transform]"
          >
            <span class="session-tree__segment-line" aria-hidden="true" />
            <div class="session-tree__segment">
              <span>折叠 {{ displayRow.count }} 条线性消息</span>
            </div>
          </div>
        </template>
      </div>
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
