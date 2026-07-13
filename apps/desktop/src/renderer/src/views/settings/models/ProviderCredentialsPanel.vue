<script setup lang="ts">
import { BaseBadge, BaseButton, BaseField, BasePanel } from '@renderer/components/base'
import { SettingsSelectField } from '@renderer/views/settings/components/form'
import useModelSettingsStore from '@renderer/stores/model-settings'
import { confirm } from '@renderer/composables/useConfirmDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { ProviderCredentialStatus } from '@shared/coding-agent/types'
import { Check, KeyRound, LogIn, Trash2, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'

const modelSettings = useModelSettingsStore()
const isApiKeyDialogOpen = ref(false)
const isOAuthDialogOpen = ref(false)
const apiKeySubmitAttempted = ref(false)
const oauthSubmitAttempted = ref(false)
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
  const missing = modelSettings.credentialStatuses.filter(
    (item) => item.status === 'missing'
  ).length
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
const oauthLoginBusy = computed(() =>
  Object.values(modelSettings.oauthLogins).some((state) =>
    Boolean(state.running || state.pendingPrompt)
  )
)
const canSaveProviderApiKey = computed(() =>
  Boolean(
    apiKeyDraft.value.provider.trim() && apiKeyDraft.value.key.trim() && !modelSettings.saving
  )
)
const apiKeyProviderError = computed(() =>
  apiKeySubmitAttempted.value && !apiKeyDraft.value.provider.trim() ? '请选择 provider' : ''
)
const apiKeyValueError = computed(() =>
  apiKeySubmitAttempted.value && !apiKeyDraft.value.key.trim()
    ? '请输入 API Key 或 Pi config value'
    : ''
)
const oauthProviderError = computed(() =>
  oauthSubmitAttempted.value && !oauthDraft.value.provider.trim() ? '请选择 OAuth provider' : ''
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

function openApiKeyDialog(provider: string): void {
  apiKeyDraft.value.provider = provider
  apiKeyDraft.value.key = ''
  apiKeySubmitAttempted.value = false
  isApiKeyDialogOpen.value = true
}

function openOAuthDialog(provider: string): void {
  oauthDraft.value.provider = provider
  oauthDraft.value.method = 'browser'
  oauthPromptInput.value = ''
  oauthSubmitAttempted.value = false
  isOAuthDialogOpen.value = true
}

function handleApiKeyDialogOpenChange(open: boolean): void {
  if (open) {
    isApiKeyDialogOpen.value = true
    return
  }
  closeApiKeyDialog()
}

function handleOAuthDialogOpenChange(open: boolean): void {
  if (open) {
    isOAuthDialogOpen.value = true
    return
  }
  if (oauthLoginBusy.value) return
  closeOAuthDialog()
}

function closeApiKeyDialog(): void {
  if (modelSettings.saving) return
  isApiKeyDialogOpen.value = false
  apiKeyDraft.value.key = ''
  apiKeySubmitAttempted.value = false
}

function closeOAuthDialog(): void {
  if (oauthLoginBusy.value) return
  isOAuthDialogOpen.value = false
  oauthPromptInput.value = ''
  oauthSubmitAttempted.value = false
}

async function saveProviderApiKey(): Promise<void> {
  apiKeySubmitAttempted.value = true
  if (!canSaveProviderApiKey.value) return
  await modelSettings.setProviderApiKey({
    provider: apiKeyDraft.value.provider.trim(),
    key: apiKeyDraft.value.key.trim()
  })
  apiKeyDraft.value.key = ''
  if (!modelSettings.error) {
    closeApiKeyDialog()
  }
}

async function loginProviderOAuth(): Promise<void> {
  oauthSubmitAttempted.value = true
  const provider = oauthDraft.value.provider.trim()
  if (!provider) return
  oauthPromptInput.value = ''
  await modelSettings.loginProviderOAuth({
    provider,
    selectOptionId: showOAuthMethod.value ? oauthDraft.value.method : undefined
  })
}

function canClearCredential(credential: ProviderCredentialStatus): boolean {
  return credential.source === 'credentialStore' || credential.source === 'oauth'
}

async function clearProviderCredential(provider: string): Promise<void> {
  const result = await confirm({
    title: '清除 Provider 凭据',
    description: `将从 auth.json 删除 ${provider} 的 API key 或 OAuth 凭据。`,
    confirmText: '清除',
    cancelText: '取消',
    tone: 'destructive'
  })
  if (!result.confirmed || modelSettings.saving) return
  await modelSettings.clearProviderCredential(provider)
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
          <BaseButton size="sm" variant="ghost" @click="openApiKeyDialog(credential.provider)">
            <template #icon>
              <KeyRound :size="14" />
            </template>
            API Key
          </BaseButton>
          <BaseButton
            v-if="credential.oauthAvailable"
            size="sm"
            variant="ghost"
            @click="openOAuthDialog(credential.provider)"
          >
            <template #icon>
              <LogIn :size="14" />
            </template>
            OAuth
          </BaseButton>
          <BaseButton
            v-if="canClearCredential(credential)"
            size="sm"
            variant="ghost"
            :disabled="modelSettings.saving"
            @click="clearProviderCredential(credential.provider)"
          >
            <template #icon>
              <Trash2 :size="14" />
            </template>
            清除
          </BaseButton>
        </div>
      </li>
    </ul>
  </BasePanel>

  <Dialog :open="isApiKeyDialogOpen" @update:open="handleApiKeyDialogOpenChange">
    <DialogContent class="auth-dialog">
      <form class="auth-dialog__form" @submit.prevent="saveProviderApiKey">
        <DialogHeader>
          <DialogTitle>保存 API Key</DialogTitle>
          <DialogDescription>
            写入 {{ apiKeyDraft.provider || 'provider' }} 的 auth.json 凭据；保存后不会回显明文。
          </DialogDescription>
        </DialogHeader>

        <div class="auth-dialog__body">
          <SettingsSelectField
            v-model="apiKeyDraft.provider"
            label="Provider"
            placeholder="选择 provider"
            :options="providerOptions"
            :disabled="modelSettings.saving"
          />
          <p v-if="apiKeyProviderError" class="auth-dialog__error">{{ apiKeyProviderError }}</p>

          <BaseField
            id="provider-api-key"
            v-model="apiKeyDraft.key"
            type="password"
            label="API Key"
            placeholder="$OPENAI_API_KEY、!op read ... 或 literal"
            hint="支持 Pi config value 语义；renderer 不持久化密钥。"
          />
          <p v-if="apiKeyValueError" class="auth-dialog__error">{{ apiKeyValueError }}</p>
        </div>

        <DialogFooter>
          <BaseButton type="button" size="sm" variant="ghost" @click="closeApiKeyDialog">
            取消
          </BaseButton>
          <BaseButton size="sm" variant="primary" type="submit" :disabled="modelSettings.saving">
            <template #icon>
              <Check :size="14" />
            </template>
            保存
          </BaseButton>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>

  <Dialog :open="isOAuthDialogOpen" @update:open="handleOAuthDialogOpenChange">
    <DialogContent class="auth-dialog auth-dialog--wide">
      <DialogHeader>
        <DialogTitle>OAuth 登录</DialogTitle>
        <DialogDescription
          >使用 provider 的 OAuth 流程写入 Pi-compatible auth.json。</DialogDescription
        >
      </DialogHeader>

      <div class="auth-dialog__body">
        <div v-if="oauthProviderOptions.length === 0" class="empty-state">
          <strong>暂无可登录的 OAuth provider</strong>
          <span>刷新模型 registry 后，支持 OAuth 的 provider 会出现在这里。</span>
        </div>

        <div v-else class="auth-dialog__form">
          <SettingsSelectField
            v-model="oauthDraft.provider"
            label="OAuth Provider"
            placeholder="选择 OAuth provider"
            :options="oauthProviderOptions"
            :disabled="oauthLoginBusy"
          />
          <p v-if="oauthProviderError" class="auth-dialog__error">{{ oauthProviderError }}</p>

          <SettingsSelectField
            v-if="showOAuthMethod"
            v-model="oauthDraft.method"
            label="登录方式"
            :disabled="oauthLoginBusy"
            :options="[
              { label: '浏览器登录', value: 'browser' },
              { label: '设备码登录', value: 'device_code' }
            ]"
          />

          <article v-if="selectedOAuthState" class="oauth-status">
            <header>
              <strong>{{ selectedOAuthState.providerName ?? selectedOAuthState.provider }}</strong>
              <span>{{
                selectedOAuthState.running ? '登录中' : selectedOAuthState.error ? '失败' : '完成'
              }}</span>
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
            <form
              v-if="selectedOAuthPrompt"
              class="oauth-prompt"
              @submit.prevent="submitOAuthPrompt"
            >
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

          <DialogFooter>
            <BaseButton
              type="button"
              size="sm"
              variant="ghost"
              :disabled="oauthLoginBusy"
              @click="closeOAuthDialog"
            >
              关闭
            </BaseButton>
            <BaseButton
              size="sm"
              variant="primary"
              type="button"
              :disabled="modelSettings.saving || oauthLoginBusy"
              @click="loginProviderOAuth"
            >
              <template #icon>
                <LogIn :size="14" />
              </template>
              开始登录
            </BaseButton>
          </DialogFooter>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style lang="scss" scoped>
.auth-dialog__form,
.auth-dialog__body {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.auth-dialog__error {
  margin: calc(var(--space-2) * -1) 0 0;
  color: var(--color-accent);
  font-size: var(--font-size-ui-xs);
  line-height: 1.4;
}

.oauth-status {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
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
    font-family: var(--font-mono) !important;
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
