<script setup lang="ts">
import { BaseBadge, BaseButton, BaseField, BasePanel } from '@renderer/components/base'
import { SettingsSelectField } from '@renderer/views/settings/components/form'
import useModelSettingsStore from '@renderer/stores/model-settings'
import type { ProviderCredentialStatus } from '@shared/coding-agent/types'
import { Check, KeyRound, LogIn, Save, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'

const modelSettings = useModelSettingsStore()
const apiKeyDraft = ref({
  provider: '',
  key: ''
})
const oauthDraft = ref({
  provider: '',
  method: 'browser'
})
const oauthPromptInput = ref('')

const providerCredentialSummary = computed(() => {
  if (modelSettings.credentialStatuses.length === 0) return '等待凭据状态'
  const missing = modelSettings.credentialStatuses.filter((item) => item.status === 'missing').length
  return missing > 0 ? `${missing} 个 provider 缺少凭据` : '凭据状态正常'
})

const configuredProviderCount = computed(
  () => modelSettings.credentialStatuses.filter((item) => item.status === 'configured').length
)
const missingProviderCount = computed(
  () => modelSettings.credentialStatuses.filter((item) => item.status === 'missing').length
)
const oauthProviderCount = computed(
  () => modelSettings.credentialStatuses.filter((item) => item.oauthAvailable).length
)

const providerOptions = computed(() =>
  modelSettings.providers.map((provider) => ({ label: provider, value: provider }))
)

const oauthProviderOptions = computed(() =>
  modelSettings.credentialStatuses
    .filter((credential) => credential.oauthAvailable)
    .map((credential) => ({ label: credential.provider, value: credential.provider }))
)

const selectedOAuthState = computed(() =>
  oauthDraft.value.provider ? modelSettings.oauthLogins[oauthDraft.value.provider] : undefined
)
const selectedOAuthPrompt = computed(() => selectedOAuthState.value?.pendingPrompt)

const showOAuthMethod = computed(() => oauthDraft.value.provider === 'openai-codex')
const canSaveProviderApiKey = computed(() =>
  Boolean(apiKeyDraft.value.provider.trim() && apiKeyDraft.value.key.trim() && !modelSettings.saving)
)

function getCredentialTone(
  status: ProviderCredentialStatus['status']
): 'neutral' | 'success' | 'warning' | 'info' {
  if (status === 'configured') return 'success'
  if (status === 'missing' || status === 'invalid') return 'warning'
  return 'neutral'
}

function getCredentialStatusLabel(status: ProviderCredentialStatus['status']): string {
  switch (status) {
    case 'configured':
      return '已配置'
    case 'missing':
      return '缺少凭据'
    case 'invalid':
      return '无效'
    case 'unknown':
      return '未知'
  }
}

function getCredentialSourceLabel(source: ProviderCredentialStatus['source']): string {
  switch (source) {
    case 'credentialStore':
      return 'auth.json'
    case 'env':
      return '环境变量'
    case 'oauth':
      return 'OAuth'
    case 'runtime':
      return 'Runtime override'
    case 'models_json_key':
      return 'models.json key'
    case 'models_json_command':
      return 'models.json command'
    default:
      return '未配置来源'
  }
}

function selectApiKeyProvider(provider: string): void {
  apiKeyDraft.value.provider = provider
}

function selectOAuthProvider(provider: string): void {
  oauthDraft.value.provider = provider
}

async function saveProviderApiKey(): Promise<void> {
  if (!canSaveProviderApiKey.value) return
  await modelSettings.setProviderApiKey({
    provider: apiKeyDraft.value.provider.trim(),
    key: apiKeyDraft.value.key.trim()
  })
  apiKeyDraft.value.key = ''
}

async function loginProviderOAuth(): Promise<void> {
  const provider = oauthDraft.value.provider.trim()
  if (!provider) return
  oauthPromptInput.value = ''
  await modelSettings.loginProviderOAuth({
    provider,
    selectOptionId: showOAuthMethod.value ? oauthDraft.value.method : undefined
  })
}

async function submitOAuthPrompt(): Promise<void> {
  const prompt = selectedOAuthPrompt.value
  const provider = oauthDraft.value.provider.trim()
  if (!prompt || !provider) return
  if (prompt.allowEmpty === false && !oauthPromptInput.value.trim()) return
  await modelSettings.respondOAuthPrompt(provider, oauthPromptInput.value)
  oauthPromptInput.value = ''
}

async function cancelOAuthPrompt(): Promise<void> {
  const provider = oauthDraft.value.provider.trim()
  if (!selectedOAuthPrompt.value || !provider) return
  await modelSettings.respondOAuthPrompt(provider, '', true)
  oauthPromptInput.value = ''
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
      <BaseButton
        size="sm"
        variant="primary"
        :disabled="!canSaveProviderApiKey"
        @click="saveProviderApiKey"
      >
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
      <div class="credential-summary" aria-label="Provider credential summary">
        <div>
          <span>Configured</span>
          <strong>{{ configuredProviderCount }}</strong>
        </div>
        <div :class="{ 'has-warning': missingProviderCount > 0 }">
          <span>Missing</span>
          <strong>{{ missingProviderCount }}</strong>
        </div>
        <div>
          <span>OAuth</span>
          <strong>{{ oauthProviderCount }}</strong>
        </div>
      </div>
      <p class="muted-copy">保存后不回显明文；Pi CLI 与 Desktop 使用同一份 auth.json。</p>

      <ul v-if="modelSettings.credentialStatuses.length" class="credential-list">
        <li v-for="credential in modelSettings.credentialStatuses" :key="credential.provider">
          <div>
            <strong>{{ credential.provider }}</strong>
            <span>{{ credential.message ?? getCredentialSourceLabel(credential.source) }}</span>
          </div>
          <div class="credential-list__badges">
            <BaseBadge :tone="getCredentialTone(credential.status)">
              {{ getCredentialStatusLabel(credential.status) }}
            </BaseBadge>
            <BaseBadge v-if="credential.source" tone="neutral">
              {{ getCredentialSourceLabel(credential.source) }}
            </BaseBadge>
            <BaseBadge v-if="credential.oauthAvailable" tone="info">OAuth</BaseBadge>
          </div>
          <div class="credential-list__actions">
            <BaseButton size="sm" variant="ghost" @click="selectApiKeyProvider(credential.provider)">
              <template #icon>
                <KeyRound :size="14" />
              </template>
              API Key
            </BaseButton>
            <BaseButton
              v-if="credential.oauthAvailable"
              size="sm"
              variant="ghost"
              @click="selectOAuthProvider(credential.provider)"
            >
              <template #icon>
                <LogIn :size="14" />
              </template>
              OAuth
            </BaseButton>
          </div>
        </li>
      </ul>

      <div class="api-key-form">
        <SettingsSelectField
          v-model="apiKeyDraft.provider"
          label="Provider"
          placeholder="选择 provider"
          :options="providerOptions"
        />
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

    <BasePanel title="OAuth 登录" eyebrow="auth.json">
      <div class="status-row">
        <LogIn :size="16" />
        <span>使用 provider 的 OAuth 流程写入 Pi-compatible auth.json。</span>
      </div>

      <div v-if="oauthProviderOptions.length === 0" class="empty-state">
        <strong>暂无可登录的 OAuth provider</strong>
        <span>刷新模型 registry 后，支持 OAuth 的 provider 会出现在这里。</span>
      </div>

      <div v-else class="api-key-form">
        <SettingsSelectField
          v-model="oauthDraft.provider"
          label="OAuth Provider"
          placeholder="选择 OAuth provider"
          :options="oauthProviderOptions"
        />
        <SettingsSelectField
          v-if="showOAuthMethod"
          v-model="oauthDraft.method"
          label="登录方式"
          :options="[
            { label: '浏览器登录', value: 'browser' },
            { label: '设备码登录', value: 'device_code' }
          ]"
        />
        <BaseButton
          size="sm"
          variant="primary"
          :disabled="modelSettings.saving || !oauthDraft.provider"
          @click="loginProviderOAuth"
        >
          <template #icon>
            <LogIn :size="14" />
          </template>
          登录
        </BaseButton>
      </div>

      <article v-if="selectedOAuthState" class="oauth-status">
        <header>
          <strong>{{ selectedOAuthState.providerName ?? selectedOAuthState.provider }}</strong>
          <span>{{ selectedOAuthState.running ? '登录中' : selectedOAuthState.error ? '失败' : '完成' }}</span>
        </header>
        <div v-if="selectedOAuthState.userCode" class="oauth-code">
          <span>设备码</span>
          <strong>{{ selectedOAuthState.userCode }}</strong>
        </div>
        <p v-if="selectedOAuthState.verificationUri">
          {{ selectedOAuthState.verificationUri }}
        </p>
        <p v-else-if="selectedOAuthState.authUrl">
          {{ selectedOAuthState.authUrl }}
        </p>
        <p v-if="selectedOAuthState.instructions">{{ selectedOAuthState.instructions }}</p>
        <form v-if="selectedOAuthPrompt" class="oauth-prompt" @submit.prevent="submitOAuthPrompt">
          <BaseField
            id="oauth-prompt-input"
            v-model="oauthPromptInput"
            :label="selectedOAuthPrompt.manualCode ? '授权码' : '输入'"
            :placeholder="selectedOAuthPrompt.placeholder ?? selectedOAuthPrompt.message"
            :hint="selectedOAuthPrompt.message"
          />
          <div class="oauth-prompt__actions">
            <BaseButton size="sm" variant="ghost" type="button" @click="cancelOAuthPrompt">
              <template #icon>
                <X :size="14" />
              </template>
              取消
            </BaseButton>
            <BaseButton
              size="sm"
              variant="primary"
              type="submit"
              :disabled="selectedOAuthPrompt.allowEmpty === false && !oauthPromptInput.trim()"
            >
              <template #icon>
                <Check :size="14" />
              </template>
              提交
            </BaseButton>
          </div>
        </form>
        <ul v-if="selectedOAuthState.progress.length">
          <li v-for="(line, index) in selectedOAuthState.progress.slice(-4)" :key="index">
            {{ line }}
          </li>
        </ul>
      </article>
    </BasePanel>
  </div>
</template>

<style lang="scss" scoped>
.oauth-status {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  margin-top: var(--space-3);
  padding: var(--space-3);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);

  header {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    min-width: 0;
  }

  strong,
  span,
  p,
  li {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  header strong {
    color: var(--color-text);
    font-size: var(--font-size-ui-sm);
  }

  header span,
  p,
  li,
  .oauth-code span {
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-xs);
  }

  p,
  ul {
    margin: 0;
  }

  ul {
    display: grid;
    gap: 4px;
    padding-left: var(--space-4);
  }
}

.oauth-code {
  display: grid;
  gap: 2px;
  padding: var(--space-2);
  background: var(--color-surface);
  border: 1px solid var(--color-border-muted);
  border-radius: var(--radius-md);

  strong {
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: var(--font-size-ui-lg);
    letter-spacing: 0;
  }
}

.oauth-prompt {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2);
  background: var(--color-surface);
  border: 1px solid var(--color-border-muted);
  border-radius: var(--radius-md);
}

.oauth-prompt__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  min-width: 0;
  flex-wrap: wrap;
}
</style>
