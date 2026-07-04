<script setup lang="ts">
import { BaseBadge, BaseButton, BasePanel } from '@renderer/components/base'
import { SettingsSwitchField, SettingsTextField } from '@renderer/views/settings/components/form'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import { Save } from 'lucide-vue-next'
import { computed } from 'vue'

const agentSettings = useAgentSettingsStore()

const runtimeSummary = computed(() => {
  const runtime = agentSettings.draft?.runtime
  if (!runtime) {
    return []
  }
  return [
    {
      label: 'Context',
      value: runtime.compactionEnabled ? 'Auto compact' : 'Manual only',
      detail: `${formatTokenCount(runtime.compactionKeepRecentTokens)} recent · ${formatTokenCount(runtime.compactionReserveTokens)} reserve`,
      tone: runtime.compactionEnabled ? 'success' : 'warning',
      badgeLabel: runtime.compactionEnabled ? 'On' : 'Review'
    },
    {
      label: 'Retry',
      value: runtime.retryEnabled ? `${runtime.retryMaxRetries} attempts` : 'Disabled',
      detail: `${formatDuration(runtime.retryBaseDelayMs)} base delay`,
      tone: runtime.retryEnabled ? 'success' : 'warning',
      badgeLabel: runtime.retryEnabled ? 'On' : 'Review'
    },
    {
      label: 'Provider',
      value: `${runtime.providerRetryMaxRetries ?? 0} retries`,
      detail: `${formatDuration(runtime.providerRetryTimeoutMs)} timeout · ${formatDuration(runtime.providerRetryMaxRetryDelayMs)} cap`,
      tone: runtime.providerRetryMaxRetries ? 'info' : 'neutral',
      badgeLabel: runtime.providerRetryMaxRetries ? 'SDK' : 'Default'
    },
    {
      label: 'Connection',
      value: formatDuration(runtime.httpIdleTimeoutMs),
      detail: `${formatDuration(runtime.websocketConnectTimeoutMs)} websocket`,
      tone: 'neutral',
      badgeLabel: 'Timeout'
    }
  ] as Array<{
    label: string
    value: string
    detail: string
    tone: 'neutral' | 'success' | 'warning' | 'info'
    badgeLabel: string
  }>
})

function formatDuration(value: number | undefined): string {
  if (value === undefined) {
    return 'system default'
  }
  if (value <= 0) {
    return 'off'
  }
  if (value < 1000) {
    return `${value}ms`
  }
  const seconds = value / 1000
  if (seconds < 60) {
    return `${seconds.toFixed(seconds % 1 === 0 ? 0 : 1)}s`
  }
  const minutes = seconds / 60
  return `${minutes.toFixed(minutes % 1 === 0 ? 0 : 1)}m`
}

function formatTokenCount(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`
  }
  return String(value)
}
</script>

<template>
  <div class="agent-page">
    <header class="agent-page__header">
      <div>
        <p class="agent-page__eyebrow">Runtime</p>
        <h1 class="agent-page__title">运行时</h1>
        <p class="agent-page__subtitle">只保存压缩、摘要、重试和连接 timeout。</p>
      </div>
      <BaseButton
        size="sm"
        variant="primary"
        :disabled="!agentSettings.canSave"
        @click="agentSettings.saveRuntime"
      >
        <template #icon>
          <Save :size="14" />
        </template>
        保存运行时
      </BaseButton>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="运行时" eyebrow="Runtime">
      <div class="runtime-summary" aria-label="Runtime strategy summary">
        <div v-for="item in runtimeSummary" :key="item.label">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
          <small>{{ item.detail }}</small>
          <BaseBadge :tone="item.tone">{{ item.badgeLabel }}</BaseBadge>
        </div>
      </div>

      <div class="switch-list">
        <SettingsSwitchField
          v-model="agentSettings.draft.runtime.compactionEnabled"
          title="自动上下文压缩"
          description="接近上下文窗口时自动 compact。"
        />
        <SettingsSwitchField
          v-model="agentSettings.draft.runtime.retryEnabled"
          title="自动重试"
          description="网络或 provider transient error 自动重试。"
        />
        <SettingsSwitchField
          v-model="agentSettings.draft.runtime.branchSummarySkipPrompt"
          title="跳过分支摘要提示"
          description="/tree navigation 时默认不询问 branch summary。"
        />
      </div>

      <div class="runtime-field-groups">
        <section>
          <header>
            <strong>Context</strong>
            <span>压缩与分支摘要预算</span>
          </header>
          <div class="form-grid compact-grid">
            <SettingsTextField
              v-model="agentSettings.draft.runtime.compactionReserveTokens"
              label="压缩预留 token Compaction reserve tokens"
              type="number"
              :min="0"
            />
            <SettingsTextField
              v-model="agentSettings.draft.runtime.compactionKeepRecentTokens"
              label="保留最近 token Keep recent tokens"
              type="number"
              :min="0"
            />
            <SettingsTextField
              v-model="agentSettings.draft.runtime.branchSummaryReserveTokens"
              label="分支摘要预留 Branch summary reserve"
              type="number"
              :min="0"
            />
          </div>
        </section>

        <section>
          <header>
            <strong>Retry</strong>
            <span>Agent 与 provider transient error 策略</span>
          </header>
          <div class="form-grid compact-grid">
            <SettingsTextField
              v-model="agentSettings.draft.runtime.retryMaxRetries"
              label="最大重试次数 Retry max attempts"
              type="number"
              :min="0"
            />
            <SettingsTextField
              v-model="agentSettings.draft.runtime.retryBaseDelayMs"
              label="重试基础延迟 Retry base delay ms"
              type="number"
              :min="0"
            />
            <SettingsTextField
              v-model="agentSettings.draft.runtime.providerRetryMaxRetries"
              label="Provider 最大重试 Provider max retries"
              type="number"
              :min="0"
            />
            <SettingsTextField
              v-model="agentSettings.draft.runtime.providerRetryMaxRetryDelayMs"
              label="Provider 重试延迟上限 Provider retry delay cap"
              type="number"
              :min="0"
            />
          </div>
        </section>

        <section>
          <header>
            <strong>Connection</strong>
            <span>HTTP 与 WebSocket timeout</span>
          </header>
          <div class="form-grid compact-grid">
            <SettingsTextField
              v-model="agentSettings.draft.runtime.httpIdleTimeoutMs"
              label="HTTP 空闲超时 HTTP idle timeout"
              type="number"
              :min="0"
              :step="1000"
            />
            <SettingsTextField
              v-model="agentSettings.draft.runtime.websocketConnectTimeoutMs"
              label="WebSocket 连接超时 WebSocket connect timeout"
              type="number"
              :min="0"
            />
            <SettingsTextField
              v-model="agentSettings.draft.runtime.providerRetryTimeoutMs"
              label="Provider 超时 Provider timeout ms"
              type="number"
              :min="0"
            />
          </div>
        </section>
      </div>
    </BasePanel>
  </div>
</template>
