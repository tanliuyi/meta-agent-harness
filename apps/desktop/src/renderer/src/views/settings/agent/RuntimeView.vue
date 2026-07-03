<script setup lang="ts">
import { BaseButton, BasePanel } from '@renderer/components/base'
import { SettingsSwitchField, SettingsTextField } from '@renderer/views/settings/components/form'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import { Save } from 'lucide-vue-next'

const agentSettings = useAgentSettingsStore()
</script>

<template>
  <div class="agent-page">
    <header class="agent-page__header">
      <div>
        <p class="agent-page__eyebrow">Runtime</p>
        <h1 class="agent-page__title">运行时</h1>
        <p class="agent-page__subtitle">只保存压缩、摘要、重试和连接 timeout。</p>
      </div>
      <BaseButton size="sm" variant="primary" :disabled="!agentSettings.canSave" @click="agentSettings.saveRuntime">
        <template #icon><Save :size="14" /></template>
        保存运行时
      </BaseButton>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="运行时" eyebrow="Runtime">
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

      <div class="form-grid compact-grid">
        <SettingsTextField v-model="agentSettings.draft.runtime.httpIdleTimeoutMs" label="HTTP 空闲超时 HTTP idle timeout" type="number" :min="0" :step="1000" />
        <SettingsTextField v-model="agentSettings.draft.runtime.compactionReserveTokens" label="压缩预留 token Compaction reserve tokens" type="number" :min="0" />
        <SettingsTextField v-model="agentSettings.draft.runtime.compactionKeepRecentTokens" label="保留最近 token Keep recent tokens" type="number" :min="0" />
        <SettingsTextField v-model="agentSettings.draft.runtime.branchSummaryReserveTokens" label="分支摘要预留 Branch summary reserve" type="number" :min="0" />
        <SettingsTextField v-model="agentSettings.draft.runtime.retryMaxRetries" label="最大重试次数 Retry max attempts" type="number" :min="0" />
        <SettingsTextField v-model="agentSettings.draft.runtime.retryBaseDelayMs" label="重试基础延迟 Retry base delay ms" type="number" :min="0" />
        <SettingsTextField v-model="agentSettings.draft.runtime.websocketConnectTimeoutMs" label="WebSocket 连接超时 WebSocket connect timeout" type="number" :min="0" />
        <SettingsTextField v-model="agentSettings.draft.runtime.providerRetryTimeoutMs" label="Provider 超时 Provider timeout ms" type="number" :min="0" />
        <SettingsTextField v-model="agentSettings.draft.runtime.providerRetryMaxRetries" label="Provider 最大重试 Provider max retries" type="number" :min="0" />
        <SettingsTextField v-model="agentSettings.draft.runtime.providerRetryMaxRetryDelayMs" label="Provider 重试延迟上限 Provider retry delay cap" type="number" :min="0" />
      </div>
    </BasePanel>
  </div>
</template>
