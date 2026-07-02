<script setup lang="ts">
import { BaseButton, BaseField, BasePanel } from '@renderer/components/base'
import useModelSettingsStore from '@renderer/stores/model-settings'
import { KeyRound, Save } from 'lucide-vue-next'
import { computed, ref } from 'vue'

const modelSettings = useModelSettingsStore()
const apiKeyDraft = ref({
  provider: '',
  key: ''
})

const providerCredentialSummary = computed(() => {
  if (modelSettings.credentialStatuses.length === 0) return '等待凭据状态'
  const missing = modelSettings.credentialStatuses.filter((item) => item.status === 'missing').length
  return missing > 0 ? `${missing} 个 provider 缺少凭据` : '凭据状态正常'
})

async function saveProviderApiKey(): Promise<void> {
  await modelSettings.setProviderApiKey({
    provider: apiKeyDraft.value.provider.trim(),
    key: apiKeyDraft.value.key.trim()
  })
  apiKeyDraft.value.key = ''
}
</script>

<template>
  <div class="models-page">
    <header class="models-page__header">
      <div>
        <p class="models-page__eyebrow">Auth</p>
        <h1 class="models-page__title">API Key</h1>
        <p class="models-page__subtitle">只保存 provider 凭据到 Pi-compatible auth.json。</p>
      </div>
      <BaseButton variant="primary" :disabled="modelSettings.saving" @click="saveProviderApiKey">
        <template #icon>
          <Save :size="14" />
        </template>
        保存 API Key
      </BaseButton>
    </header>

    <div v-if="modelSettings.error" class="state-strip is-error">{{ modelSettings.error }}</div>

    <BasePanel title="Provider 凭据" eyebrow="auth.json">
      <div class="status-row">
        <KeyRound :size="16" />
        <span>{{ providerCredentialSummary }}</span>
      </div>
      <p class="muted-copy">保存后不回显明文；Pi CLI 与 Desktop 使用同一份 auth.json。</p>

      <div class="api-key-form">
        <label class="select-field">
          <span>Provider</span>
          <select v-model="apiKeyDraft.provider">
            <option value="">选择 provider</option>
            <option v-for="provider in modelSettings.providers" :key="provider" :value="provider">
              {{ provider }}
            </option>
          </select>
        </label>
        <BaseField
          id="provider-api-key"
          v-model="apiKeyDraft.key"
          type="password"
          label="API Key"
          placeholder="$OPENAI_API_KEY、!op read ... 或 literal"
          hint="支持 Pi config value 语义；renderer 不持久化密钥。"
        />
      </div>
    </BasePanel>
  </div>
</template>
