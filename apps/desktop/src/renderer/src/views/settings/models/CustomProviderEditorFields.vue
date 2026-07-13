<script setup lang="ts">
import { BaseBadge, BaseButton, BaseField, BaseSegmentedControl } from '@renderer/components/base'
import { SettingsSelectField } from '@renderer/views/settings/components/form'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ThinkingLevel } from '@shared/coding-agent/types'
import { Plus, Trash2 } from 'lucide-vue-next'
import { ref } from 'vue'

type ThinkingLevelDraft = {
  enabled: boolean
  value: string
}

type SensitiveConfigMode = 'preserve' | 'replace' | 'clear'

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

const sensitiveConfigModeOptions: Array<{ label: string; value: SensitiveConfigMode }> = [
  { label: '保留', value: 'preserve' },
  { label: '替换', value: 'replace' },
  { label: '清除', value: 'clear' }
]

const draft = defineModel<CustomProviderDraft>('draft', { required: true })

defineProps<{
  supportedApis: Array<{ label: string; value: string }>
  inheritProviderApiValue: string
  thinkingLevels: ThinkingLevel[]
}>()

const emit = defineEmits<{
  addModel: []
  removeModel: [index: number]
}>()

const activeModelTab = ref('0')

function addModel(): void {
  activeModelTab.value = String(draft.value.models.length)
  emit('addModel')
}

function removeModel(index: number): void {
  const activeIndex = Number(activeModelTab.value)
  if (activeIndex > index) {
    activeModelTab.value = String(activeIndex - 1)
  } else if (activeIndex === index) {
    activeModelTab.value = String(Math.max(0, index - 1))
  }
  emit('removeModel', index)
}

function sensitiveConfigHint(configured: boolean, mode: SensitiveConfigMode): string {
  if (mode === 'replace') {
    return configured
      ? '输入新值以替换现有配置；已保存的敏感原文不会显示。'
      : '输入要保存的新值；敏感原文不会在后续编辑中显示。'
  }
  if (mode === 'clear') {
    return configured ? '保存后删除现有配置。' : '保持未配置状态。'
  }
  return configured ? '保留现有配置，不读取或回显原文。' : '当前没有已保存配置。'
}
</script>

<template>
  <section class="provider-editor-section">
    <div class="provider-editor-section__heading">
      <div>
        <strong>连接配置</strong>
        <span>设置 Provider 标识、服务地址与认证方式。</span>
      </div>
    </div>

    <div class="provider-form provider-form--provider">
      <BaseField
        id="custom-provider-id"
        v-model="draft.provider"
        label="Provider ID"
        placeholder="local-openai"
      />
      <BaseField
        id="custom-provider-name"
        v-model="draft.name"
        label="显示名"
        placeholder="Local OpenAI"
      />
      <BaseField
        id="custom-provider-base-url"
        v-model="draft.baseUrl"
        label="Base URL"
        placeholder="http://localhost:11434/v1"
      />
      <SettingsSelectField v-model="draft.api" label="默认 API 协议" :options="supportedApis" />
      <div class="sensitive-config-field">
        <div class="sensitive-config-field__header">
          <span>API Key 配置</span>
          <BaseSegmentedControl
            v-model="draft.apiKeyMode"
            label="API Key 更新方式"
            size="small"
            :options="sensitiveConfigModeOptions"
          />
        </div>
        <BaseField
          v-if="draft.apiKeyMode === 'replace'"
          id="custom-provider-api-key"
          v-model="draft.apiKey"
          type="password"
          aria-label="新的 API Key 配置"
          placeholder="$LOCAL_MODEL_API_KEY 或 literal"
        />
        <p class="sensitive-config-field__hint">
          {{ sensitiveConfigHint(draft.hasApiKeyConfig, draft.apiKeyMode) }}
        </p>
      </div>
      <label class="settings-check-field">
        <input v-model="draft.authHeader" type="checkbox" />
        <span>自动添加 Authorization bearer header</span>
      </label>
    </div>

    <details class="provider-advanced">
      <summary>高级 Provider 配置</summary>
      <div class="json-field-grid json-field-grid--provider">
        <div class="json-field sensitive-config-field">
          <div class="sensitive-config-field__header">
            <span>Provider headers JSON</span>
            <BaseSegmentedControl
              v-model="draft.headersMode"
              label="Provider headers 更新方式"
              size="small"
              :options="sensitiveConfigModeOptions"
            />
          </div>
          <textarea
            v-if="draft.headersMode === 'replace'"
            v-model="draft.headersJson"
            aria-label="新的 Provider headers JSON"
            placeholder='{ "X-Header": "$ENV_OR_LITERAL" }'
          ></textarea>
          <p class="sensitive-config-field__hint">
            {{ sensitiveConfigHint(draft.hasHeadersConfig, draft.headersMode) }}
          </p>
        </div>
        <label class="json-field">
          <span>Provider compat JSON</span>
          <textarea
            v-model="draft.compatJson"
            placeholder='{ "supportsDeveloperRole": true }'
          ></textarea>
        </label>
        <label class="json-field is-wide">
          <span>Model overrides JSON</span>
          <textarea
            v-model="draft.modelOverridesJson"
            placeholder='{ "builtin-model-id": { "maxTokens": 8192 } }'
          ></textarea>
        </label>
        <div class="json-field is-wide sensitive-config-field">
          <div class="sensitive-config-field__header">
            <span>Model override headers JSON</span>
            <BaseSegmentedControl
              v-model="draft.modelOverrideHeadersMode"
              label="Model override headers 更新方式"
              size="small"
              :options="sensitiveConfigModeOptions"
            />
          </div>
          <textarea
            v-if="draft.modelOverrideHeadersMode === 'replace'"
            v-model="draft.modelOverrideHeadersJson"
            aria-label="新的 Model override headers JSON"
            placeholder='{ "builtin-model-id": { "X-Model": "value" } }'
          ></textarea>
          <p class="sensitive-config-field__hint">
            {{
              sensitiveConfigHint(
                draft.hasModelOverrideHeadersConfig,
                draft.modelOverrideHeadersMode
              )
            }}
          </p>
        </div>
      </div>
    </details>
  </section>

  <section class="custom-models-section">
    <div class="custom-models-section__header">
      <div>
        <strong>Models</strong>
        <span>一个 provider 可保存多个模型，模型级 API/Base URL 可覆盖默认值。</span>
      </div>
      <BaseButton size="sm" variant="secondary" type="button" @click="addModel">
        <template #icon>
          <Plus :size="14" />
        </template>
        添加 Model
      </BaseButton>
    </div>

    <Tabs v-model="activeModelTab" class="custom-model-tabs">
      <TabsList class="custom-model-tabs__list" aria-label="Models">
        <TabsTrigger
          v-for="(model, index) in draft.models"
          :key="index"
          :value="String(index)"
          class="custom-model-tabs__trigger"
        >
          {{ model.name || model.id || `Model ${index + 1}` }}
        </TabsTrigger>
      </TabsList>

      <TabsContent
        v-for="(model, index) in draft.models"
        :key="index"
        :value="String(index)"
        class="custom-model-tabs__content"
      >
        <div class="custom-model-editor">
          <div class="custom-model-editor__header">
            <div>
              <BaseBadge tone="neutral">Model {{ index + 1 }}</BaseBadge>
              <strong>{{ model.name || model.id || '未命名模型' }}</strong>
            </div>
            <BaseButton size="sm" variant="ghost" type="button" @click="removeModel(index)">
              <template #icon>
                <Trash2 :size="14" />
              </template>
              移除
            </BaseButton>
          </div>

          <div class="provider-form provider-form--model-main">
            <BaseField
              :id="`custom-model-id-${index}`"
              v-model="model.id"
              label="Model ID"
              placeholder="qwen2.5-coder:7b"
            />
            <BaseField
              :id="`custom-model-name-${index}`"
              v-model="model.name"
              label="Model 显示名"
              placeholder="Qwen Coder Local"
            />
            <SettingsSelectField
              v-model="model.api"
              label="Model API 协议覆盖"
              placeholder="留空继承 provider，或填写 openai-responses"
              :options="[
                { label: '继承 provider 默认', value: inheritProviderApiValue },
                ...supportedApis
              ]"
            />
            <BaseField
              :id="`custom-model-base-url-${index}`"
              v-model="model.baseUrl"
              label="模型 Base URL 覆盖"
              placeholder="留空继承 provider"
            />
            <BaseField
              :id="`custom-model-context-${index}`"
              v-model="model.contextWindow"
              label="Context Window"
              placeholder="128000"
            />
            <BaseField
              :id="`custom-model-max-tokens-${index}`"
              v-model="model.maxTokens"
              label="Max Tokens"
              placeholder="16384"
            />
          </div>

          <div class="provider-form provider-form--model-costs">
            <BaseField
              :id="`custom-model-cost-input-${index}`"
              v-model="model.costInput"
              label="Cost input"
              placeholder="0"
            />
            <BaseField
              :id="`custom-model-cost-output-${index}`"
              v-model="model.costOutput"
              label="Cost output"
              placeholder="0"
            />
            <BaseField
              :id="`custom-model-cost-cache-read-${index}`"
              v-model="model.costCacheRead"
              label="Cost cache read"
              placeholder="0"
            />
            <BaseField
              :id="`custom-model-cost-cache-write-${index}`"
              v-model="model.costCacheWrite"
              label="Cost cache write"
              placeholder="0"
            />
          </div>

          <div class="capability-grid">
            <label class="settings-check-field">
              <input v-model="model.inputText" type="checkbox" />
              <span>Text input</span>
            </label>
            <label class="settings-check-field">
              <input v-model="model.inputImage" type="checkbox" />
              <span>Image input</span>
            </label>
            <label class="settings-check-field">
              <input v-model="model.reasoning" type="checkbox" />
              <span>支持 reasoning / thinking</span>
            </label>
          </div>

          <div v-if="model.reasoning" class="thinking-map">
            <div class="thinking-map__header">
              <strong>Thinking levels</strong>
              <span>取消勾选会写入 null；值留空则使用等级名。</span>
            </div>
            <label v-for="level in thinkingLevels" :key="level" class="thinking-level-row">
              <input v-model="model.thinkingLevelMap[level].enabled" type="checkbox" />
              <span>{{ level }}</span>
              <input
                v-model="model.thinkingLevelMap[level].value"
                :disabled="!model.thinkingLevelMap[level].enabled"
                :placeholder="level"
              />
            </label>
          </div>

          <div class="json-field-grid json-field-grid--model">
            <div class="json-field sensitive-config-field">
              <div class="sensitive-config-field__header">
                <span>Model headers JSON</span>
                <BaseSegmentedControl
                  v-model="model.headersMode"
                  :label="`Model ${index + 1} headers 更新方式`"
                  size="small"
                  :options="sensitiveConfigModeOptions"
                />
              </div>
              <textarea
                v-if="model.headersMode === 'replace'"
                v-model="model.headersJson"
                :aria-label="`新的 Model ${index + 1} headers JSON`"
                placeholder='{ "X-Model": "value" }'
              ></textarea>
              <p class="sensitive-config-field__hint">
                {{ sensitiveConfigHint(model.hasHeadersConfig, model.headersMode) }}
              </p>
            </div>
            <label class="json-field">
              <span>Model compat JSON</span>
              <textarea
                v-model="model.compatJson"
                placeholder='{ "thinkingFormat": "openai" }'
              ></textarea>
            </label>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  </section>
</template>

<style lang="scss" scoped>
.sensitive-config-field {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.sensitive-config-field__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;

  > span {
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-xs);
    font-weight: 650;
  }
}

.sensitive-config-field__hint {
  margin: 0;
  color: var(--color-text-subtle);
  font-size: var(--font-size-ui-xs);
  line-height: 1.35;
}

.sensitive-config-field :deep(.base-segmented-control) {
  flex: 0 0 auto;
}

@media (width <= 980px) {
  .sensitive-config-field__header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
