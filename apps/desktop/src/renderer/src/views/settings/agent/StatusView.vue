<script setup lang="ts">
import { BaseBadge, BasePanel } from '@renderer/components/base'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import { AlertTriangle, CheckCircle2, FolderCog, Settings2 } from 'lucide-vue-next'
import { computed } from 'vue'

const agentSettings = useAgentSettingsStore()

const diagnosticItems = computed(() => agentSettings.diagnostics)
const hasDiagnostics = computed(() => diagnosticItems.value.length > 0)
const errorCount = computed(
  () => diagnosticItems.value.filter((diagnostic) => diagnostic.severity === 'error').length
)
const warningCount = computed(
  () => diagnosticItems.value.filter((diagnostic) => diagnostic.severity === 'warning').length
)
const infoCount = computed(
  () => diagnosticItems.value.filter((diagnostic) => diagnostic.severity === 'info').length
)
const statusTone = computed<'neutral' | 'success' | 'warning' | 'info'>(() =>
  errorCount.value > 0 || warningCount.value > 0 ? 'warning' : 'success'
)
const statusLabel = computed(() => {
  if (errorCount.value > 0) return `${errorCount.value} 个错误`
  if (warningCount.value > 0) return `${warningCount.value} 个警告`
  return '状态正常'
})
const storageRows = computed(() => [
  {
    label: 'Agent dir',
    value: agentSettings.storage?.agentDir ?? '未加载',
    icon: FolderCog
  },
  {
    label: 'settings.json',
    value: agentSettings.storage?.settingsPath ?? '未加载',
    icon: Settings2
  }
])
const diagnosticSummary = computed(() => [
  { label: '错误', value: errorCount.value, warning: errorCount.value > 0 },
  { label: '警告', value: warningCount.value, warning: warningCount.value > 0 },
  { label: '信息', value: infoCount.value, warning: false },
  { label: '总数', value: diagnosticItems.value.length, warning: false }
])

function badgeToneForSeverity(
  severity: (typeof diagnosticItems.value)[number]['severity']
): 'neutral' | 'success' | 'warning' | 'info' {
  if (severity === 'error' || severity === 'warning') return 'warning'
  return 'info'
}

function severityLabel(severity: (typeof diagnosticItems.value)[number]['severity']): string {
  switch (severity) {
    case 'error':
      return '错误'
    case 'warning':
      return '警告'
    case 'info':
      return '信息'
  }
}
</script>

<template>
  <div class="agent-page">
    <header class="agent-page__header">
      <div>
        <p class="agent-page__eyebrow">Storage</p>
        <h1 class="agent-page__title">状态</h1>
        <p class="agent-page__subtitle">查看 Pi-compatible settings.json 路径和加载诊断。</p>
      </div>
    </header>

    <BasePanel title="状态" eyebrow="Storage">
      <div class="agent-status-summary">
        <div>
          <span>加载状态</span>
          <strong>{{ agentSettings.loading ? '加载中' : '已加载' }}</strong>
        </div>
        <div
          v-for="item in diagnosticSummary"
          :key="item.label"
          :class="{ 'has-warning': item.warning }"
        >
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </div>
      </div>

      <div class="agent-health">
        <CheckCircle2 v-if="!hasDiagnostics" :size="16" />
        <AlertTriangle v-else :size="16" />
        <div>
          <strong>{{ statusLabel }}</strong>
          <span>Pi-compatible settings.json 与 agentDir 由 main 进程读取，renderer 只展示快照。</span>
        </div>
        <BaseBadge :tone="statusTone">{{ statusLabel }}</BaseBadge>
      </div>

      <div class="storage-list" aria-label="Agent storage paths">
        <div v-for="row in storageRows" :key="row.label" class="storage-row">
          <component :is="row.icon" :size="15" />
          <span>{{ row.label }}</span>
          <strong :title="row.value">{{ row.value }}</strong>
        </div>
      </div>

      <ul v-if="hasDiagnostics" class="diagnostic-list">
        <li v-for="diagnostic in diagnosticItems" :key="diagnostic.id">
          <AlertTriangle :size="15" />
          <div>
            <strong>{{ diagnostic.message }}</strong>
            <p>{{ diagnostic.details ?? diagnostic.source }}</p>
          </div>
          <BaseBadge :tone="badgeToneForSeverity(diagnostic.severity)">
            {{ severityLabel(diagnostic.severity) }}
          </BaseBadge>
        </li>
      </ul>
      <div v-else class="diagnostic-empty">
        <CheckCircle2 :size="16" />
        <span>settings.json 状态正常</span>
      </div>
    </BasePanel>
  </div>
</template>
