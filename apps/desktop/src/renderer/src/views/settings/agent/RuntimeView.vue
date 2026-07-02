<script setup lang="ts">
import { BaseButton, BasePanel } from '@renderer/components/base'
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
      <BaseButton variant="primary" :disabled="!agentSettings.canSave" @click="agentSettings.saveRuntime">
        <template #icon><Save :size="14" /></template>
        保存运行时
      </BaseButton>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="运行时" eyebrow="Runtime">
      <div class="switch-list">
        <label class="switch-row">
          <input v-model="agentSettings.draft.runtime.compactionEnabled" type="checkbox" />
          <span>
            <strong>自动上下文压缩</strong>
            <small>接近上下文窗口时自动 compact。</small>
          </span>
        </label>
        <label class="switch-row">
          <input v-model="agentSettings.draft.runtime.retryEnabled" type="checkbox" />
          <span>
            <strong>自动重试</strong>
            <small>网络或 provider transient error 自动重试。</small>
          </span>
        </label>
        <label class="switch-row">
          <input v-model="agentSettings.draft.runtime.branchSummarySkipPrompt" type="checkbox" />
          <span>
            <strong>跳过分支摘要提示</strong>
            <small>/tree navigation 时默认不询问 branch summary。</small>
          </span>
        </label>
      </div>

      <div class="form-grid compact-grid" style="margin-top: var(--space-4)">
        <label class="number-field">
          <span>HTTP idle timeout</span>
          <input v-model.number="agentSettings.draft.runtime.httpIdleTimeoutMs" min="0" step="1000" type="number" />
        </label>
        <label class="number-field">
          <span>Compaction reserve tokens</span>
          <input v-model.number="agentSettings.draft.runtime.compactionReserveTokens" min="0" type="number" />
        </label>
        <label class="number-field">
          <span>Keep recent tokens</span>
          <input v-model.number="agentSettings.draft.runtime.compactionKeepRecentTokens" min="0" type="number" />
        </label>
        <label class="number-field">
          <span>Branch summary reserve</span>
          <input v-model.number="agentSettings.draft.runtime.branchSummaryReserveTokens" min="0" type="number" />
        </label>
        <label class="number-field">
          <span>Retry max attempts</span>
          <input v-model.number="agentSettings.draft.runtime.retryMaxRetries" min="0" type="number" />
        </label>
        <label class="number-field">
          <span>Retry base delay ms</span>
          <input v-model.number="agentSettings.draft.runtime.retryBaseDelayMs" min="0" type="number" />
        </label>
        <label class="number-field">
          <span>WebSocket connect timeout</span>
          <input v-model.number="agentSettings.draft.runtime.websocketConnectTimeoutMs" min="0" type="number" />
        </label>
        <label class="number-field">
          <span>Provider timeout ms</span>
          <input v-model.number="agentSettings.draft.runtime.providerRetryTimeoutMs" min="0" type="number" />
        </label>
        <label class="number-field">
          <span>Provider max retries</span>
          <input v-model.number="agentSettings.draft.runtime.providerRetryMaxRetries" min="0" type="number" />
        </label>
        <label class="number-field">
          <span>Provider retry delay cap</span>
          <input v-model.number="agentSettings.draft.runtime.providerRetryMaxRetryDelayMs" min="0" type="number" />
        </label>
      </div>
    </BasePanel>
  </div>
</template>
