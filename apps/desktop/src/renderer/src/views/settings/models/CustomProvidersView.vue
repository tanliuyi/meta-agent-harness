<script setup lang="ts">
import { BaseBadge, BaseButton, BaseField, BasePanel } from '@renderer/components/base'
import { SettingsSelectField } from '@renderer/views/settings/components/form'
import useModelSettingsStore from '@renderer/stores/model-settings'
import { Database, Save } from 'lucide-vue-next'
import { computed, ref } from 'vue'

const modelSettings = useModelSettingsStore()

const customProviderDraft = ref({
  provider: '',
  name: '',
  baseUrl: '',
  api: 'openai-completions',
  apiKey: '',
  modelId: '',
  modelName: '',
  contextWindow: '128000',
  maxTokens: '16384'
})

const supportedApis = [
  { label: 'OpenAI Completions', value: 'openai-completions' },
  { label: 'OpenAI Responses', value: 'openai-responses' },
  { label: 'Anthropic Messages', value: 'anthropic-messages' },
  { label: 'Google Generative AI', value: 'google-generative-ai' }
]

type CustomProviderListItem = {
  provider: (typeof modelSettings.customProviders)[number]
  title: string
  subtitle: string
  credentialTone: 'success' | 'warning'
  credentialLabel: string
}

const customProviderCount = computed(() => modelSettings.customProviders.length)
const hasCustomProviders = computed(() => customProviderCount.value > 0)
const customProviderItems = computed<CustomProviderListItem[]>(() =>
  modelSettings.customProviders.map((provider) => ({
    provider,
    title: provider.name ?? provider.provider,
    subtitle: `${provider.provider} · ${provider.api ?? 'api 未指定'}`,
    credentialTone: provider.hasApiKeyConfig ? 'success' : 'warning',
    credentialLabel: provider.hasApiKeyConfig ? '凭据来源已配置' : '缺凭据来源'
  }))
)

async function saveCustomProvider(): Promise<void> {
  const draft = customProviderDraft.value
  await modelSettings.upsertCustomProvider({
    provider: draft.provider.trim(),
    name: draft.name.trim() || undefined,
    baseUrl: draft.baseUrl.trim(),
    api: draft.api,
    apiKey: draft.apiKey.trim() || undefined,
    models: [
      {
        id: draft.modelId.trim(),
        name: draft.modelName.trim() || undefined,
        reasoning: false,
        input: ['text'],
        contextWindow: Number(draft.contextWindow),
        maxTokens: Number(draft.maxTokens)
      }
    ]
  })
  customProviderDraft.value.apiKey = ''
}
</script>

<template>
  <div class="models-page">
    <header class="models-page__header">
      <div>
        <p class="models-page__eyebrow">Custom</p>
        <h1 class="models-page__title">自定义 Provider</h1>
        <p class="models-page__subtitle">只保存 Pi-compatible models.json provider 配置。</p>
      </div>
      <BaseButton size="sm" variant="primary" :disabled="modelSettings.saving" @click="saveCustomProvider">
        <template #icon>
          <Save :size="14" />
        </template>
        保存 Provider
      </BaseButton>
    </header>

    <div v-if="modelSettings.error" class="state-strip is-error">{{ modelSettings.error }}</div>

    <BasePanel title="Provider 定义" eyebrow="models.json">
      <template #actions>
        <BaseBadge :tone="hasCustomProviders ? 'success' : 'neutral'">
          {{ customProviderCount }} 个
        </BaseBadge>
      </template>

      <div class="provider-form">
        <BaseField
          id="custom-provider-id"
          v-model="customProviderDraft.provider"
          label="Provider ID"
          placeholder="local-openai"
        />
        <BaseField
          id="custom-provider-name"
          v-model="customProviderDraft.name"
          label="显示名"
          placeholder="Local OpenAI"
        />
        <BaseField
          id="custom-provider-base-url"
          v-model="customProviderDraft.baseUrl"
          label="Base URL"
          placeholder="http://localhost:11434/v1"
        />
        <SettingsSelectField v-model="customProviderDraft.api" label="API 类型 API" :options="supportedApis" />
        <BaseField
          id="custom-provider-api-key"
          v-model="customProviderDraft.apiKey"
          type="password"
          label="API Key 配置"
          placeholder="$LOCAL_MODEL_API_KEY 或 literal"
          hint="提交给 main 保存；保存后不会从后端回显明文。"
        />
        <BaseField
          id="custom-provider-model-id"
          v-model="customProviderDraft.modelId"
          label="Model ID"
          placeholder="qwen2.5-coder:7b"
        />
        <BaseField
          id="custom-provider-model-name"
          v-model="customProviderDraft.modelName"
          label="Model 显示名"
          placeholder="Qwen Coder Local"
        />
        <BaseField
          id="custom-provider-context"
          v-model="customProviderDraft.contextWindow"
          label="Context Window"
          placeholder="128000"
        />
        <BaseField
          id="custom-provider-max-tokens"
          v-model="customProviderDraft.maxTokens"
          label="Max Tokens"
          placeholder="16384"
        />
      </div>
    </BasePanel>

    <BasePanel title="已配置 Provider" eyebrow="Custom" style="margin-top: var(--space-4)">
      <ul v-if="hasCustomProviders" class="plain-list">
        <li v-for="item in customProviderItems" :key="item.provider.provider">
          <div>
            <strong>{{ item.title }}</strong>
            <span>{{ item.subtitle }}</span>
          </div>
          <div class="model-badges">
            <BaseBadge tone="info">{{ item.provider.modelCount }} models</BaseBadge>
            <BaseBadge :tone="item.credentialTone">
              {{ item.credentialLabel }}
            </BaseBadge>
          </div>
        </li>
      </ul>
      <div v-else class="empty-state">
        <Database :size="18" />
        <strong>尚未添加自定义 provider</strong>
        <span>可添加 Ollama、LM Studio、vLLM 或 OpenAI-compatible proxy。</span>
      </div>
    </BasePanel>
  </div>
</template>
