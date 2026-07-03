<script setup lang="ts">
import { BaseBadge, BasePanel } from '@renderer/components/base'
import useModelSettingsStore, { type DiagnosticSeverity } from '@renderer/stores/model-settings'
import { AlertTriangle, CheckCircle2, SlidersHorizontal } from 'lucide-vue-next'
import { computed } from 'vue'

const modelSettings = useModelSettingsStore()

const severityLabels: Record<DiagnosticSeverity, string> = {
  info: '信息',
  warning: '警告',
  error: '错误'
}

type DiagnosticListItem = {
  diagnostic: (typeof modelSettings.diagnostics)[number]
  tone: 'neutral' | 'success' | 'warning' | 'info'
  severityLabel: string
  isInfo: boolean
}

const diagnosticItems = computed<DiagnosticListItem[]>(() =>
  modelSettings.diagnostics.map((diagnostic) => ({
    diagnostic,
    tone: badgeToneForSeverity(diagnostic.severity),
    severityLabel: severityLabels[diagnostic.severity],
    isInfo: diagnostic.severity === 'info'
  }))
)

function badgeToneForSeverity(
  severity: DiagnosticSeverity
): 'neutral' | 'success' | 'warning' | 'info' {
  if (severity === 'error' || severity === 'warning') return 'warning'
  return 'info'
}
</script>

<template>
  <div class="models-page">
    <header class="models-page__header">
      <div>
        <p class="models-page__eyebrow">Diagnostics</p>
        <h1 class="models-page__title">诊断</h1>
        <p class="models-page__subtitle">查看 settings、auth 和 model registry 的加载问题。</p>
      </div>
    </header>

    <BasePanel title="诊断信息" eyebrow="Read only">
      <ul v-if="diagnosticItems.length > 0" class="plain-list">
        <li v-for="item in diagnosticItems" :key="item.diagnostic.id">
          <div>
            <strong>
              <AlertTriangle v-if="!item.isInfo" :size="14" />
              <CheckCircle2 v-else :size="14" />
              {{ item.diagnostic.message }}
            </strong>
            <span>{{ item.diagnostic.details ?? item.diagnostic.source }}</span>
          </div>
          <BaseBadge :tone="item.tone">
            {{ item.severityLabel }}
          </BaseBadge>
        </li>
      </ul>
      <div v-else class="status-row">
        <SlidersHorizontal :size="16" />
        <span>暂无诊断信息</span>
      </div>
    </BasePanel>
  </div>
</template>
