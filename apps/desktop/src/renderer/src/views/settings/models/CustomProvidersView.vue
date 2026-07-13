<script setup lang="ts">
import { BaseBadge, BaseButton, BasePanel } from '@renderer/components/base'
import useModelSettingsStore from '@renderer/stores/model-settings'
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type {
  CustomModelConfigInput,
  CustomModelConfigSummary,
  CustomModelOverrideInput,
  CustomModelOverrideSummary,
  SensitiveConfigUpdate,
  ThinkingLevel
} from '@shared/coding-agent/types'
import { Database, Pencil, Plus, Save } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import ProviderEditorFields from './CustomProviderEditorFields.vue'

type ThinkingLevelDraft = {
  enabled: boolean
  value: string
}

type SensitiveConfigMode = SensitiveConfigUpdate<unknown>['mode']

type CustomModelDraft = {
  previousId: string
  id: string
  name: string
  api: string
  baseUrl: string
  reasoning: boolean
  inputText: boolean
  inputImage: boolean
  contextWindow: string
  maxTokens: string
  costInput: string
  costOutput: string
  costCacheRead: string
  costCacheWrite: string
  headersMode: SensitiveConfigMode
  hasHeadersConfig: boolean
  headersJson: string
  compatJson: string
  thinkingLevelMap: Record<ThinkingLevel, ThinkingLevelDraft>
}

type CustomProviderDraft = {
  originalProvider: string
  provider: string
  name: string
  baseUrl: string
  api: string
  apiKeyMode: SensitiveConfigMode
  hasApiKeyConfig: boolean
  apiKey: string
  authHeader: boolean
  headersMode: SensitiveConfigMode
  hasHeadersConfig: boolean
  headersJson: string
  compatJson: string
  modelOverridesJson: string
  modelOverrideHeadersMode: SensitiveConfigMode
  hasModelOverrideHeadersConfig: boolean
  modelOverrideHeadersJson: string
  models: CustomModelDraft[]
}

type CustomProviderListItem = {
  provider: (typeof modelSettings.customProviders)[number]
  title: string
  subtitle: string
  credentialTone: 'success' | 'warning'
  credentialLabel: string
}

const modelSettings = useModelSettingsStore()

const inheritProviderApiValue = '__inherit_provider_api__'
const supportedApis = [
  { label: 'OpenAI Completions', value: 'openai-completions' },
  { label: 'OpenAI Responses', value: 'openai-responses' },
  { label: 'Anthropic Messages', value: 'anthropic-messages' },
  { label: 'Google Generative AI', value: 'google-generative-ai' }
]

const thinkingLevels: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']

const isCustomProviderDialogOpen = ref(false)
const customProviderDraft = ref<CustomProviderDraft>(createBlankProviderDraft())

const customProviderCount = computed(() => modelSettings.customProviders.length)
const hasCustomProviders = computed(() => customProviderCount.value > 0)
const isEditingCustomProvider = computed(() => Boolean(customProviderDraft.value.originalProvider))
const customProviderDialogTitle = computed(() =>
  isEditingCustomProvider.value ? '编辑自定义 Provider' : '新增自定义 Provider'
)
const customProviderDialogDescription = computed(() =>
  isEditingCustomProvider.value
    ? '更新 Pi-compatible models.json provider；敏感配置仅显示状态，不回显原文。'
    : '添加 Pi-compatible models.json provider；可配置模型、思考等级和兼容字段。'
)
const customProviderItems = computed<CustomProviderListItem[]>(() =>
  modelSettings.customProviders.map((provider) => ({
    provider,
    title: provider.name ?? provider.provider,
    subtitle: [provider.provider, provider.api ?? 'api 未指定', provider.baseUrl]
      .filter(Boolean)
      .join(' · '),
    credentialTone: provider.hasApiKeyConfig ? 'success' : 'warning',
    credentialLabel: provider.hasApiKeyConfig ? '凭据来源已配置' : '缺凭据来源'
  }))
)

function createThinkingLevelMap(
  source?: Partial<Record<ThinkingLevel, string | null>>
): Record<ThinkingLevel, ThinkingLevelDraft> {
  return Object.fromEntries(
    thinkingLevels.map((level) => {
      const value = source?.[level]
      return [
        level,
        {
          enabled: value !== null,
          value: typeof value === 'string' ? value : level
        }
      ]
    })
  ) as Record<ThinkingLevel, ThinkingLevelDraft>
}

function createBlankModelDraft(model?: CustomModelConfigSummary): CustomModelDraft {
  const input = model?.input ?? ['text']
  return {
    previousId: model?.id ?? '',
    id: model?.id ?? '',
    name: model?.name ?? '',
    api: model?.api ?? inheritProviderApiValue,
    baseUrl: model?.baseUrl ?? '',
    reasoning: Boolean(model?.reasoning),
    inputText: input.includes('text'),
    inputImage: input.includes('image'),
    contextWindow: model?.contextWindow ? String(model.contextWindow) : '128000',
    maxTokens: model?.maxTokens ? String(model.maxTokens) : '16384',
    costInput: model?.cost?.input !== undefined ? String(model.cost.input) : '',
    costOutput: model?.cost?.output !== undefined ? String(model.cost.output) : '',
    costCacheRead: model?.cost?.cacheRead !== undefined ? String(model.cost.cacheRead) : '',
    costCacheWrite: model?.cost?.cacheWrite !== undefined ? String(model.cost.cacheWrite) : '',
    headersMode: model?.hasHeadersConfig ? 'preserve' : 'clear',
    hasHeadersConfig: Boolean(model?.hasHeadersConfig),
    headersJson: '',
    compatJson: formatJson(model?.compat),
    thinkingLevelMap: createThinkingLevelMap(model?.thinkingLevelMap)
  }
}

function createBlankProviderDraft(): CustomProviderDraft {
  return {
    originalProvider: '',
    provider: '',
    name: '',
    baseUrl: '',
    api: 'openai-completions',
    apiKeyMode: 'clear',
    hasApiKeyConfig: false,
    apiKey: '',
    authHeader: true,
    headersMode: 'clear',
    hasHeadersConfig: false,
    headersJson: '',
    compatJson: '',
    modelOverridesJson: '',
    modelOverrideHeadersMode: 'clear',
    hasModelOverrideHeadersConfig: false,
    modelOverrideHeadersJson: '',
    models: [createBlankModelDraft()]
  }
}

function createDraftFromProvider(
  provider: CustomProviderListItem['provider']
): CustomProviderDraft {
  return {
    originalProvider: provider.provider,
    provider: provider.provider,
    name: provider.name ?? '',
    baseUrl: provider.baseUrl ?? '',
    api: provider.api ?? 'openai-completions',
    apiKeyMode: provider.hasApiKeyConfig ? 'preserve' : 'clear',
    hasApiKeyConfig: provider.hasApiKeyConfig,
    apiKey: '',
    authHeader: provider.authHeader ?? true,
    headersMode: provider.hasHeadersConfig ? 'preserve' : 'clear',
    hasHeadersConfig: provider.hasHeadersConfig,
    headersJson: '',
    compatJson: formatJson(provider.compat),
    modelOverridesJson: formatModelOverrides(provider.modelOverrides),
    modelOverrideHeadersMode: hasModelOverrideHeaders(provider.modelOverrides)
      ? 'preserve'
      : 'clear',
    hasModelOverrideHeadersConfig: hasModelOverrideHeaders(provider.modelOverrides),
    modelOverrideHeadersJson: '',
    models: provider.models?.length
      ? provider.models.map(createBlankModelDraft)
      : [createBlankModelDraft()]
  }
}

function openProviderDialog(provider: CustomProviderListItem['provider']): void {
  customProviderDraft.value = createDraftFromProvider(provider)
  isCustomProviderDialogOpen.value = true
}

function openNewProviderDialog(): void {
  customProviderDraft.value = createBlankProviderDraft()
  isCustomProviderDialogOpen.value = true
}

function handleProviderDialogOpenChange(open: boolean): void {
  if (open) {
    isCustomProviderDialogOpen.value = true
    return
  }
  closeProviderDialog()
}

function closeProviderDialog(): void {
  if (modelSettings.saving) return
  isCustomProviderDialogOpen.value = false
  customProviderDraft.value = createBlankProviderDraft()
}

function addModel(): void {
  customProviderDraft.value.models.push(createBlankModelDraft())
}

function removeModel(index: number): void {
  if (customProviderDraft.value.models.length === 1) {
    customProviderDraft.value.models = [createBlankModelDraft()]
    return
  }
  customProviderDraft.value.models.splice(index, 1)
}

async function saveCustomProvider(): Promise<void> {
  const draft = customProviderDraft.value
  const originalProvider = draft.originalProvider
  const nextProvider = draft.provider.trim()
  await modelSettings.upsertCustomProvider({
    provider: nextProvider,
    originalProvider: originalProvider || undefined,
    name: draft.name.trim() || undefined,
    baseUrl: draft.baseUrl.trim() || undefined,
    api: draft.api || undefined,
    apiKeyUpdate: toSensitiveStringUpdate(draft.apiKeyMode, draft.apiKey),
    authHeader: draft.authHeader,
    headersUpdate: toSensitiveHeadersUpdate(
      draft.headersMode,
      draft.headersJson,
      'Provider headers'
    ),
    compat: parseJsonObject(draft.compatJson, 'Provider compat'),
    modelOverrides: parseJsonObject<Record<string, CustomModelOverrideInput>>(
      draft.modelOverridesJson,
      'Model overrides'
    ),
    modelOverrideHeadersUpdate: toSensitiveNestedHeadersUpdate(
      draft.modelOverrideHeadersMode,
      draft.modelOverrideHeadersJson,
      'Model override headers'
    ),
    models: draft.models.map(toModelConfigInput)
  })
  if (modelSettings.error) return
  closeProviderDialog()
}

function toModelConfigInput(model: CustomModelDraft): CustomModelConfigInput {
  const thinkingLevelMap = Object.fromEntries(
    thinkingLevels.map((level) => {
      const draft = model.thinkingLevelMap[level]
      return [level, draft.enabled ? draft.value.trim() || level : null]
    })
  ) as Partial<Record<ThinkingLevel, string | null>>

  const hasCost = [
    model.costInput,
    model.costOutput,
    model.costCacheRead,
    model.costCacheWrite
  ].some((value) => value.trim())

  return {
    previousId: model.previousId || undefined,
    id: model.id.trim(),
    name: model.name.trim() || undefined,
    api: model.api === inheritProviderApiValue ? undefined : model.api.trim() || undefined,
    baseUrl: model.baseUrl.trim() || undefined,
    reasoning: model.reasoning,
    thinkingLevelMap: model.reasoning ? thinkingLevelMap : undefined,
    input: [model.inputText ? 'text' : undefined, model.inputImage ? 'image' : undefined].filter(
      Boolean
    ) as CustomModelConfigInput['input'],
    contextWindow: model.contextWindow.trim() ? Number(model.contextWindow) : undefined,
    maxTokens: model.maxTokens.trim() ? Number(model.maxTokens) : undefined,
    cost: hasCost
      ? {
          input: numberOrZero(model.costInput),
          output: numberOrZero(model.costOutput),
          cacheRead: numberOrZero(model.costCacheRead),
          cacheWrite: numberOrZero(model.costCacheWrite)
        }
      : undefined,
    headersUpdate: toSensitiveHeadersUpdate(
      model.headersMode,
      model.headersJson,
      `Model ${model.id || '未命名'} headers`
    ),
    compat: parseJsonObject(model.compatJson, `Model ${model.id || '未命名'} compat`)
  }
}

function formatJson(value: unknown): string {
  if (value === undefined || value === null) {
    return ''
  }
  return JSON.stringify(value, null, 2)
}

function formatModelOverrides(
  value: Record<string, CustomModelOverrideSummary> | undefined
): string {
  if (!value) {
    return ''
  }
  return formatJson(
    Object.fromEntries(
      Object.entries(value).map(([modelId, modelOverride]) => [
        modelId,
        toEditableModelOverride(modelOverride)
      ])
    )
  )
}

function toEditableModelOverride(
  modelOverride: CustomModelOverrideSummary
): CustomModelOverrideInput {
  return {
    name: modelOverride.name,
    reasoning: modelOverride.reasoning,
    thinkingLevelMap: modelOverride.thinkingLevelMap,
    input: modelOverride.input,
    contextWindow: modelOverride.contextWindow,
    maxTokens: modelOverride.maxTokens,
    cost: modelOverride.cost,
    compat: modelOverride.compat
  }
}

function hasModelOverrideHeaders(
  value: Record<string, CustomModelOverrideSummary> | undefined
): boolean {
  return Object.values(value ?? {}).some((modelOverride) => modelOverride.hasHeadersConfig)
}

function toSensitiveStringUpdate(
  mode: SensitiveConfigMode,
  value: string
): SensitiveConfigUpdate<string> {
  if (mode !== 'replace') {
    return { mode }
  }
  return { mode, value: value.trim() }
}

function toSensitiveHeadersUpdate(
  mode: SensitiveConfigMode,
  value: string,
  label: string
): SensitiveConfigUpdate<Record<string, string>> {
  if (mode !== 'replace') {
    return { mode }
  }
  return { mode, value: parseJsonStringRecord(value, label) ?? {} }
}

function toSensitiveNestedHeadersUpdate(
  mode: SensitiveConfigMode,
  value: string,
  label: string
): SensitiveConfigUpdate<Record<string, Record<string, string>>> {
  if (mode !== 'replace') {
    return { mode }
  }
  const parsed = parseJsonObject<Record<string, Record<string, string>>>(value, label) ?? {}
  for (const [modelId, headers] of Object.entries(parsed)) {
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
      throw new Error(`${label}.${modelId} 必须是 JSON object`)
    }
    for (const [key, item] of Object.entries(headers)) {
      if (typeof item !== 'string') {
        throw new Error(`${label}.${modelId}.${key} 必须是字符串`)
      }
    }
  }
  return { mode, value: parsed }
}

function parseJsonObject<T extends Record<string, unknown> = Record<string, unknown>>(
  value: string,
  label: string
): T | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }
  const parsed = JSON.parse(trimmed) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON object`)
  }
  return parsed as T
}

function parseJsonStringRecord(value: string, label: string): Record<string, string> | undefined {
  const parsed = parseJsonObject(value, label)
  if (!parsed) {
    return undefined
  }
  for (const [key, item] of Object.entries(parsed)) {
    if (typeof item !== 'string') {
      throw new Error(`${label}.${key} 必须是字符串`)
    }
  }
  return parsed as Record<string, string>
}

function numberOrZero(value: string): number {
  return value.trim() ? Number(value) : 0
}
</script>

<template>
  <div class="models-page">
    <header class="models-page__header">
      <div>
        <p class="models-page__eyebrow">Custom</p>
        <h1 class="models-page__title">自定义 Provider</h1>
        <p class="models-page__subtitle">
          管理 Pi-compatible models.json provider；展开后编辑模型与思考等级。
        </p>
      </div>
      <BaseButton
        size="sm"
        variant="primary"
        :disabled="modelSettings.saving"
        @click="openNewProviderDialog"
      >
        <template #icon>
          <Plus :size="14" />
        </template>
        新增 Provider
      </BaseButton>
    </header>

    <div v-if="modelSettings.error" class="state-strip is-error">{{ modelSettings.error }}</div>

    <BasePanel title="自定义 Provider" eyebrow="models.json">
      <template #actions>
        <BaseBadge :tone="hasCustomProviders ? 'success' : 'neutral'">
          {{ customProviderCount }} 个
        </BaseBadge>
      </template>

      <ul v-if="hasCustomProviders" class="custom-provider-list">
        <li
          v-for="item in customProviderItems"
          :key="item.provider.provider"
          class="custom-provider-list__item"
        >
          <button
            class="custom-provider-row"
            type="button"
            @click="openProviderDialog(item.provider)"
          >
            <span class="custom-provider-row__chevron" aria-hidden="true">
              <Pencil :size="15" />
            </span>
            <span class="custom-provider-row__copy">
              <strong>{{ item.title }}</strong>
              <span>{{ item.subtitle }}</span>
            </span>
            <span class="model-badges">
              <BaseBadge tone="info">{{ item.provider.modelCount }} models</BaseBadge>
              <BaseBadge :tone="item.credentialTone">
                {{ item.credentialLabel }}
              </BaseBadge>
            </span>
          </button>
        </li>
      </ul>

      <div v-else class="empty-state">
        <Database :size="18" />
        <strong>尚未添加自定义 provider</strong>
        <span>可添加 Ollama、LM Studio、vLLM 或 OpenAI-compatible proxy。</span>
        <BaseButton size="sm" variant="secondary" @click="openNewProviderDialog">
          <template #icon>
            <Plus :size="14" />
          </template>
          新增 Provider
        </BaseButton>
      </div>
    </BasePanel>

    <Dialog :open="isCustomProviderDialogOpen" @update:open="handleProviderDialogOpenChange">
      <DialogContent class="custom-provider-dialog">
        <form class="custom-provider-dialog__form" @submit.prevent="saveCustomProvider">
          <DialogHeader class="custom-provider-dialog__header">
            <DialogTitle>{{ customProviderDialogTitle }}</DialogTitle>
            <DialogDescription>{{ customProviderDialogDescription }}</DialogDescription>
          </DialogHeader>

          <ScrollArea class="custom-provider-dialog__scroll">
            <div class="custom-provider-dialog__body">
              <ProviderEditorFields
                v-model:draft="customProviderDraft"
                :supported-apis="supportedApis"
                :inherit-provider-api-value="inheritProviderApiValue"
                :thinking-levels="thinkingLevels"
                @add-model="addModel"
                @remove-model="removeModel"
              />
            </div>
          </ScrollArea>

          <div class="custom-provider-dialog__footer">
            <BaseButton size="sm" variant="ghost" type="button" @click="closeProviderDialog">
              取消
            </BaseButton>
            <BaseButton size="sm" variant="primary" type="submit" :disabled="modelSettings.saving">
              <template #icon>
                <Save :size="14" />
              </template>
              保存 Provider
            </BaseButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style lang="scss" scoped>
.custom-provider-dialog__form {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
  height: min(calc(100svh - 40px), 720px);
}

.custom-provider-dialog__header {
  position: relative;
  gap: var(--space-1);
  padding: var(--space-4) var(--space-5) var(--space-3) calc(var(--space-5) + 14px);
  background: var(--color-surface-raised);
  border-bottom: 1px solid var(--color-border);

  &::before {
    position: absolute;
    top: var(--space-5);
    left: var(--space-5);
    width: 6px;
    height: 6px;
    background: var(--color-primary);
    box-shadow: 0 8px 0 color-mix(in srgb, var(--color-primary) 42%, transparent);
    content: '';
  }

  :deep([data-slot='dialog-title']) {
    font-family: var(--font-mono);
    font-size: var(--font-size-ui);
    letter-spacing: 0;
  }

  :deep([data-slot='dialog-description']) {
    font-size: var(--font-size-ui-xs);
  }
}

.custom-provider-dialog__scroll {
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.custom-provider-dialog__scroll :deep([data-slot='scroll-area-viewport']) {
  height: 100%;
}

.custom-provider-dialog__body {
  min-width: 0;
  padding: var(--space-4) var(--space-5) var(--space-6);
}

.custom-provider-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-5);
  background: var(--color-surface-raised);
  border-top: 1px solid var(--color-border-strong);
  box-shadow: 0 -4px 0 color-mix(in srgb, var(--color-border) 35%, transparent);
}
</style>
