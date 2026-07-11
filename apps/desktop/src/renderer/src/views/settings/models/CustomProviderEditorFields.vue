<script setup lang="ts">
import { BaseBadge, BaseButton, BaseField } from '@renderer/components/base'
import { SettingsSelectField } from '@renderer/views/settings/components/form'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ThinkingLevel } from '@shared/coding-agent/types'
import { Plus, Trash2 } from 'lucide-vue-next'
import { ref } from 'vue'

type ThinkingLevelDraft = {
  enabled: boolean
  value: string
}

type CustomModelDraft = {
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
  apiKey: string
  authHeader: boolean
  headersJson: string
  compatJson: string
  modelOverridesJson: string
  models: CustomModelDraft[]
}

const props = defineProps<{
  draft: CustomProviderDraft
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
  activeModelTab.value = String(props.draft.models.length)
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
      <BaseField
        id="custom-provider-api-key"
        v-model="draft.apiKey"
        type="password"
        label="API Key 配置"
        placeholder="$LOCAL_MODEL_API_KEY 或 literal"
        hint="编辑 Provider 时会回填当前配置值。"
      />
      <label class="settings-check-field">
        <input v-model="draft.authHeader" type="checkbox" />
        <span>自动添加 Authorization bearer header</span>
      </label>
    </div>

    <details class="provider-advanced">
      <summary>高级 Provider 配置</summary>
      <div class="json-field-grid json-field-grid--provider">
        <label class="json-field">
          <span>Provider headers JSON</span>
          <textarea
            v-model="draft.headersJson"
            placeholder='{ "X-Header": "$ENV_OR_LITERAL" }'
          ></textarea>
        </label>
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
            <label class="json-field">
              <span>Model headers JSON</span>
              <textarea v-model="model.headersJson" placeholder='{ "X-Model": "value" }'></textarea>
            </label>
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
