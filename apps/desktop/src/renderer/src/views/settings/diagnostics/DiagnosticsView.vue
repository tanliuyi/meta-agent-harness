<script setup lang="ts">
import { BaseBadge, BaseButton, BasePanel } from '@renderer/components/base'
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'
import useDiagnosticsStore, {
  type DiagnosticsDomain,
  type DiagnosticsItem,
  type DiagnosticsSeverity
} from '@renderer/stores/diagnostics'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import { WORKSPACE_SESSION_ROUTE_NAME } from '@renderer/router/workspace-route-host'
import {
  AlertTriangle,
  CheckCircle2,
  FolderSearch,
  RefreshCw,
  Settings2,
  SlidersHorizontal
} from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

const diagnostics = useDiagnosticsStore()
const workspaceSession = useWorkspaceSessionStore()
const router = useRouter()
const selectedDomain = ref<'all' | DiagnosticsDomain>('all')
const selectedSeverity = ref<'all' | DiagnosticsSeverity>('all')

const domainLabels: Record<DiagnosticsDomain, string> = {
  thread: 'Thread',
  model: '模型',
  agent: 'Agent'
}

const severityLabels: Record<DiagnosticsSeverity, string> = {
  error: '错误',
  warning: '警告',
  info: '信息'
}

const filteredItems = computed(() =>
  diagnostics.items.filter((item) => {
    if (selectedDomain.value !== 'all' && item.domain !== selectedDomain.value) return false
    if (selectedSeverity.value !== 'all' && item.severity !== selectedSeverity.value) return false
    return true
  })
)

const activeFilterLabel = computed(() => {
  const domain = selectedDomain.value === 'all' ? '全部来源' : domainLabels[selectedDomain.value]
  const severity =
    selectedSeverity.value === 'all' ? '全部级别' : severityLabels[selectedSeverity.value]
  return `${domain} / ${severity}`
})

onMounted(() => {
  void diagnostics.load()
})

function setDomain(domain: 'all' | DiagnosticsDomain): void {
  selectedDomain.value = domain
}

function setSeverity(severity: 'all' | DiagnosticsSeverity): void {
  selectedSeverity.value = severity
}

function setSummaryFilter(severity: 'all' | DiagnosticsSeverity): void {
  selectedSeverity.value = severity
  selectedDomain.value = 'all'
}

function badgeToneForSeverity(
  severity: DiagnosticsSeverity
): 'neutral' | 'success' | 'warning' | 'info' {
  if (severity === 'error' || severity === 'warning') return 'warning'
  return 'info'
}

function formatMeta(item: DiagnosticsItem): string {
  return [domainLabels[item.domain], item.source, item.threadId].filter(Boolean).join(' / ')
}

function getItemActionLabel(item: DiagnosticsItem): string {
  if (item.domain === 'thread') {
    return item.threadId ? '打开线程' : '查看工作区'
  }
  if (item.domain === 'model') {
    return '模型诊断'
  }
  return 'Agent 状态'
}

function getItemActionIcon(item: DiagnosticsItem): typeof FolderSearch {
  if (item.domain === 'thread') return FolderSearch
  return Settings2
}

async function openDiagnosticTarget(item: DiagnosticsItem): Promise<void> {
  if (item.domain === 'thread') {
    if (item.threadId) {
      workspaceSession.setContextActiveThreadId(item.threadId)
      await router.replace({
        name: WORKSPACE_SESSION_ROUTE_NAME,
        params: { sessionId: item.threadId }
      })
      return
    }
    await router.replace({
      name: WORKSPACE_SESSION_ROUTE_NAME,
      params: { sessionId: workspaceSession.activeSessionId ?? 'new' }
    })
    return
  }

  if (item.domain === 'model') {
    await router.replace('/settings/models/diagnostics')
    return
  }

  await router.replace('/settings/agent/status')
}
</script>

<template>
  <ScrollArea class="diagnostics-page-scroll">
    <div class="diagnostics-page">
      <header class="diagnostics-page__header">
        <div>
          <p class="diagnostics-page__eyebrow">Diagnostics</p>
          <h1 class="diagnostics-page__title">诊断</h1>
          <p class="diagnostics-page__subtitle">
            汇总 thread、model registry、auth 和 settings 加载状态。
          </p>
        </div>
        <BaseButton size="sm" :disabled="diagnostics.loading" @click="diagnostics.load">
          <template #icon>
            <RefreshCw :size="14" />
          </template>
          刷新
        </BaseButton>
      </header>

      <section class="diagnostics-summary" aria-label="诊断统计">
        <button
          type="button"
          class="diagnostics-summary__item"
          :class="{ 'is-active': selectedSeverity === 'all' && selectedDomain === 'all' }"
          @click="setSummaryFilter('all')"
        >
          <span>总数</span>
          <strong>{{ diagnostics.counts.total }}</strong>
        </button>
        <button
          type="button"
          class="diagnostics-summary__item"
          :class="{ 'is-active': selectedSeverity === 'error' && selectedDomain === 'all' }"
          @click="setSummaryFilter('error')"
        >
          <span>错误</span>
          <strong>{{ diagnostics.counts.error }}</strong>
        </button>
        <button
          type="button"
          class="diagnostics-summary__item"
          :class="{ 'is-active': selectedSeverity === 'warning' && selectedDomain === 'all' }"
          @click="setSummaryFilter('warning')"
        >
          <span>警告</span>
          <strong>{{ diagnostics.counts.warning }}</strong>
        </button>
        <button
          type="button"
          class="diagnostics-summary__item"
          :class="{ 'is-active': selectedSeverity === 'info' && selectedDomain === 'all' }"
          @click="setSummaryFilter('info')"
        >
          <span>信息</span>
          <strong>{{ diagnostics.counts.info }}</strong>
        </button>
      </section>

      <BasePanel title="诊断信息" eyebrow="Read only">
        <template #actions>
          <div class="diagnostics-filters" aria-label="诊断过滤">
            <button
              :class="{ 'is-active': selectedDomain === 'all' }"
              type="button"
              @click="setDomain('all')"
            >
              全部
            </button>
            <button
              v-for="domain in ['thread', 'model', 'agent'] as const"
              :key="domain"
              :class="{ 'is-active': selectedDomain === domain }"
              type="button"
              @click="setDomain(domain)"
            >
              {{ domainLabels[domain] }}
            </button>
          </div>
        </template>

        <div class="diagnostics-severity-filter">
          <button
            :class="{ 'is-active': selectedSeverity === 'all' }"
            type="button"
            @click="setSeverity('all')"
          >
            全部级别
          </button>
          <button
            v-for="severity in ['error', 'warning', 'info'] as const"
            :key="severity"
            :class="{ 'is-active': selectedSeverity === severity }"
            type="button"
            @click="setSeverity(severity)"
          >
            {{ severityLabels[severity] }}
          </button>
        </div>

        <div class="diagnostics-active-filter">
          <span>{{ activeFilterLabel }}</span>
          <strong>{{ filteredItems.length }}</strong>
        </div>

        <p v-if="diagnostics.error" class="diagnostics-error">{{ diagnostics.error }}</p>

        <ul v-if="filteredItems.length > 0" class="diagnostics-list">
          <li v-for="item in filteredItems" :key="item.id">
            <AlertTriangle v-if="item.severity !== 'info'" :size="15" />
            <CheckCircle2 v-else :size="15" />
            <div class="diagnostics-list__copy">
              <strong>{{ item.message }}</strong>
              <span>{{ item.details ?? formatMeta(item) }}</span>
              <small>{{ formatMeta(item) }}</small>
            </div>
            <div class="diagnostics-list__meta">
              <BaseBadge :tone="badgeToneForSeverity(item.severity)">
                {{ severityLabels[item.severity] }}
              </BaseBadge>
              <BaseButton size="sm" variant="ghost" @click="openDiagnosticTarget(item)">
                <template #icon>
                  <component :is="getItemActionIcon(item)" :size="13" />
                </template>
                {{ getItemActionLabel(item) }}
              </BaseButton>
            </div>
          </li>
        </ul>

        <div v-else class="diagnostics-empty">
          <SlidersHorizontal :size="16" />
          <span>{{ diagnostics.loading ? '正在加载诊断信息' : '暂无诊断信息' }}</span>
        </div>
      </BasePanel>
    </div>
  </ScrollArea>
</template>

<style lang="scss" scoped>
.diagnostics-page {
  display: grid;
  gap: var(--space-4);
}

.diagnostics-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-2);
}

.diagnostics-summary__item {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: var(--space-3);
  text-align: left;
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);

  &:hover {
    background: var(--color-surface-raised);
    border-color: var(--color-border-strong);
  }

  &.is-active {
    background: var(--color-item-active);
    border-color: var(--color-item-active-border);
  }

  span {
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-xs);
    font-weight: 650;
  }

  strong {
    color: var(--color-text);
    font-size: var(--font-size-ui-lg);
    line-height: 1.1;
  }
}

.diagnostics-filters,
.diagnostics-severity-filter {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);

  button {
    min-height: 24px;
    padding: 0 var(--space-2);
    color: var(--color-text-muted);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    font-size: var(--font-size-ui-xs);
    font-weight: 650;
    cursor: pointer;

    &:hover {
      color: var(--color-text);
      background: var(--color-surface-raised);
    }

    &.is-active {
      color: var(--color-text);
      background: var(--color-item-active);
      border-color: var(--color-item-active-border);
    }
  }
}

.diagnostics-severity-filter {
  margin-bottom: var(--space-3);
}

.diagnostics-active-filter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
  margin-bottom: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    flex: 0 0 auto;
    color: var(--color-text);
    font-size: var(--font-size-ui-xs);
  }
}

.diagnostics-error {
  margin: 0 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  color: var(--color-accent);
  font-size: var(--font-size-ui-sm);
  line-height: 1.5;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  background: var(--color-accent-soft);
  border: 1px solid var(--color-accent-outline);
  border-radius: var(--radius-md);
}

.diagnostics-list {
  display: grid;
  gap: 1px;
  padding: 0;
  margin: 0;
  overflow: hidden;
  list-style: none;
  background: var(--color-border);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);

  li {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    gap: var(--space-2);
    align-items: start;
    min-width: 0;
    padding: var(--space-3);
    background: var(--color-surface);
  }

  svg {
    margin-top: 2px;
    color: var(--color-text-subtle);
  }
}

.diagnostics-list__meta {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}

.diagnostics-list__copy {
  min-width: 0;

  strong,
  span {
    display: block;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  small {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: var(--color-text);
    font-size: var(--font-size-ui-sm);
    line-height: 1.35;
  }

  span {
    margin-top: 2px;
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-xs);
  }

  small {
    margin-top: 2px;
    color: var(--color-text-subtle);
    font-size: var(--font-size-ui-2xs);
  }
}

.diagnostics-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 120px;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-sm);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
}

@media (width <= 720px) {
  .diagnostics-page {
    padding: var(--space-3);
  }

  .diagnostics-page__header {
    align-items: start;
    flex-direction: column;
  }

  .diagnostics-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .diagnostics-list li {
    grid-template-columns: 18px minmax(0, 1fr);
  }

  .diagnostics-list__meta {
    grid-column: 2;
    justify-content: flex-start;
  }
}
</style>
