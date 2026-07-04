<script setup lang="ts">
import { BaseBadge, BaseButton, BaseField, BasePanel } from '@renderer/components/base'
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'
import { confirm } from '@renderer/composables/useConfirmDialog'
import useWorkspaceArchiveStore from '@renderer/stores/workspace-archive'
import type { ThreadSummary } from '@shared/coding-agent/types'
import { ArchiveRestore, Boxes, RotateCcw, Search } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'

const workspaceArchive = useWorkspaceArchiveStore()
const searchQuery = ref('')

onMounted(() => {
  void workspaceArchive.loadArchivedThreads()
})

type ArchivedThreadListItem = {
  thread: ThreadSummary
  archivedAtLabel: string
  updatedAtLabel: string
  isRestoring: boolean
}

type ArchiveProjectGroupItem = {
  group: (typeof workspaceArchive.projectGroups)[number]
  threads: ArchivedThreadListItem[]
  title: string
  statusLabel: string
  eyebrow: string
}

const archiveThreadCount = computed(() => workspaceArchive.archivedThreadList.length)
const hasArchivedThreads = computed(() => archiveThreadCount.value > 0)
const archiveProjectCount = computed(() => workspaceArchive.projectGroups.length)
const missingProjectCount = computed(
  () => workspaceArchive.projectGroups.filter((group) => !group.project).length
)
const restoringLabel = computed(() => (workspaceArchive.restoringThreadId ? '恢复中' : '空闲'))
const archiveProjectGroups = computed<ArchiveProjectGroupItem[]>(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return workspaceArchive.projectGroups
    .map((group) => ({
      group,
      title: group.project?.name ?? '未知 Project',
      statusLabel: group.project?.status ?? 'missing',
      eyebrow: `${group.threads.length} archived`,
      threads: group.threads
        .filter((thread) => {
          if (!query) return true
          const searchable = [
            thread.title,
            thread.threadId,
            group.projectId,
            group.project?.name,
            group.project?.path,
            thread.status
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
          return searchable.includes(query)
        })
        .map((thread) => ({
          thread,
          archivedAtLabel: formatDateTime(thread.archivedAt),
          updatedAtLabel: formatDateTime(thread.updatedAt),
          isRestoring: workspaceArchive.restoringThreadId === thread.threadId
        }))
    }))
    .filter((group) => group.threads.length > 0)
})
const hasFilteredArchivedThreads = computed(() => archiveProjectGroups.value.length > 0)

const archiveSummaryItems = computed(() => [
  { label: '归档会话', value: String(archiveThreadCount.value), warning: false },
  { label: 'Project', value: String(archiveProjectCount.value), warning: false },
  {
    label: 'Missing project',
    value: String(missingProjectCount.value),
    warning: missingProjectCount.value > 0
  },
  {
    label: '恢复状态',
    value: restoringLabel.value,
    warning: Boolean(workspaceArchive.restoringThreadId)
  }
])

/**
 * 格式化日期时间。
 * @param value - ISO 日期字符串。
 * @returns 展示文本。
 */
function formatDateTime(value: string | undefined): string {
  if (!value) {
    return '未知时间'
  }
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

/**
 * 恢复归档会话。
 * @param thread - 归档 thread。
 */
async function restoreArchivedThread(thread: ThreadSummary): Promise<void> {
  const result = await confirm({
    actions: [{ label: '恢复', value: 'restore' }],
    cancelText: '取消',
    description: thread.title ? `会话：${thread.title}` : `Thread ID：${thread.threadId}`,
    id: `restore-thread-${thread.threadId}`,
    title: '恢复这个会话？'
  })

  if (!result.confirmed || result.action !== 'restore') {
    return
  }

  await workspaceArchive.restoreThread(thread.threadId)
}
</script>

<template>
  <ScrollArea class="archive-page-scroll">
    <div class="archive-page">
      <header class="archive-page__header">
        <div>
          <p class="archive-page__eyebrow">Archive</p>
          <h1 class="archive-page__title">归档</h1>
          <p class="archive-page__subtitle">按 Project 查看已归档会话，并恢复到原 Project。</p>
        </div>
        <BaseButton
          size="sm"
          :disabled="workspaceArchive.loading"
          @click="workspaceArchive.loadArchivedThreads"
        >
          <template #icon>
            <RotateCcw :size="14" />
          </template>
          刷新
        </BaseButton>
      </header>

      <div v-if="workspaceArchive.errorMessage" class="archive-state is-error">
        {{ workspaceArchive.errorMessage }}
      </div>
      <div v-else-if="workspaceArchive.loading" class="archive-state">正在加载归档会话…</div>

      <section v-if="hasArchivedThreads" class="archive-summary" aria-label="归档摘要">
        <div
          v-for="item in archiveSummaryItems"
          :key="item.label"
          :class="{ 'has-warning': item.warning }"
        >
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </div>
      </section>

      <div v-if="hasArchivedThreads" class="archive-toolbar">
        <BaseField
          id="archive-search"
          v-model="searchQuery"
          type="search"
          label="搜索归档"
          placeholder="标题、thread id 或 Project"
        />
      </div>

      <div v-if="!workspaceArchive.loading && !hasArchivedThreads" class="archive-empty">
        <Boxes :size="18" />
        <strong>暂无归档会话</strong>
        <span>归档后的会话会保留 metadata 与 session 文件，并从 Project 会话列表中隐藏。</span>
      </div>

      <div
        v-else-if="!workspaceArchive.loading && !hasFilteredArchivedThreads"
        class="archive-empty"
      >
        <Search :size="18" />
        <strong>没有匹配的归档会话</strong>
        <span>调整搜索词后再试。</span>
      </div>

      <div v-else-if="hasFilteredArchivedThreads" class="archive-groups">
        <BasePanel
          v-for="groupItem in archiveProjectGroups"
          :key="groupItem.group.projectId"
          :title="groupItem.title"
          :eyebrow="groupItem.eyebrow"
        >
          <template #actions>
            <BaseBadge tone="info">{{ groupItem.statusLabel }}</BaseBadge>
          </template>

          <ul class="archive-thread-list">
            <li v-for="threadItem in groupItem.threads" :key="threadItem.thread.threadId">
              <div class="archive-thread-list__main">
                <strong>{{ threadItem.thread.title || '新会话' }}</strong>
                <span>{{ threadItem.thread.threadId }}</span>
                <small>
                  归档于 {{ threadItem.archivedAtLabel }} · 更新于
                  {{ threadItem.updatedAtLabel }}
                </small>
              </div>
              <div class="archive-thread-list__meta">
                <BaseBadge>{{ threadItem.thread.status }}</BaseBadge>
                <BaseButton
                  size="sm"
                  :disabled="threadItem.isRestoring"
                  @click="restoreArchivedThread(threadItem.thread)"
                >
                  <template #icon>
                    <ArchiveRestore :size="14" />
                  </template>
                  恢复
                </BaseButton>
              </div>
            </li>
          </ul>
        </BasePanel>
      </div>
    </div>
  </ScrollArea>
</template>
