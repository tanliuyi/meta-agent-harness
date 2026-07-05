<script setup lang="ts">
import { BaseBadge, BaseButton, BasePanel } from '@renderer/components/base'
import { SettingsSelectField, SettingsTextField } from '@renderer/views/settings/components/form'
import useModelSettingsStore from '@renderer/stores/model-settings'
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-vue-next'
import { computed, ref } from 'vue'

const modelSettings = useModelSettingsStore()
const CUSTOM_PATTERN_VALUE = '__custom_pattern__'
const newProviderValue = ref(CUSTOM_PATTERN_VALUE)
const newModelValue = ref('')
const newCustomPattern = ref('')

const defaultModelLabel = computed(() => {
  if (modelSettings.selectedModel?.displayName) {
    return modelSettings.selectedModel.displayName
  }
  const { provider, modelId } = modelSettings.draft.defaultModel
  if (!provider || !modelId) {
    return '未设置默认模型'
  }
  return `${provider}/${modelId}`
})
const patternCount = computed(() => modelSettings.draft.enabledModels.length)
const cyclingSummaryLabel = computed(() =>
  patternCount.value === 0 ? '未启用模型循环' : `${patternCount.value} 个 pattern 参与循环`
)
const initialModelLabel = computed(
  () => modelSettings.draft.enabledModels[0]?.trim() || defaultModelLabel.value
)
const providerSelectOptions = computed(() => [
  ...modelSettings.providers.map((provider) => ({ value: provider, label: provider })),
  { value: CUSTOM_PATTERN_VALUE, label: '自定义 pattern' }
])
const modelOptionsByProvider = computed(() => {
  const groups = new Map<string, Array<{ value: string; label: string }>>()
  for (const model of modelSettings.models) {
    const options = groups.get(model.provider) ?? []
    options.push({
      value: model.id,
      label: model.displayName ? `${model.displayName} (${model.id})` : model.id
    })
    groups.set(model.provider, options)
  }
  return groups
})
const newModelOptions = computed(
  () => modelOptionsByProvider.value.get(newProviderValue.value) ?? []
)
const newPatternValue = computed(() => {
  if (newProviderValue.value === CUSTOM_PATTERN_VALUE) {
    return newCustomPattern.value.trim()
  }
  const modelId = newModelValue.value || newModelOptions.value[0]?.value
  return modelId ? toModelPattern(newProviderValue.value, modelId) : ''
})
const canAddPattern = computed(() => Boolean(newPatternValue.value))

function getPatternForIndex(index: number): string {
  return modelSettings.draft.enabledModels[index] ?? ''
}

function getPatternProviderValue(index: number): string {
  const pattern = getPatternForIndex(index)
  const provider = getKnownModelProvider(pattern)
  return provider ?? CUSTOM_PATTERN_VALUE
}

function getPatternModelValue(index: number): string {
  const pattern = getPatternForIndex(index)
  const parsed = parseModelPattern(pattern)
  return parsed?.modelId ?? ''
}

function getModelOptionsForPattern(index: number): Array<{ value: string; label: string }> {
  const provider = getPatternProviderValue(index)
  return modelOptionsByProvider.value.get(provider) ?? []
}

function updatePatternProvider(index: number, value: string | number): void {
  const nextValue = String(value)
  const nextPatterns = [...modelSettings.draft.enabledModels]
  if (nextValue === CUSTOM_PATTERN_VALUE) {
    nextPatterns[index] = getPatternForIndex(index) || '*'
  } else {
    const firstModel = modelOptionsByProvider.value.get(nextValue)?.[0]?.value
    nextPatterns[index] = firstModel ? toModelPattern(nextValue, firstModel) : ''
  }
  modelSettings.updateEnabledModels(cleanPatterns(nextPatterns))
}

function updatePatternModel(index: number, value: string | number): void {
  const provider = getPatternProviderValue(index)
  if (provider === CUSTOM_PATTERN_VALUE) {
    return
  }
  const nextPatterns = [...modelSettings.draft.enabledModels]
  nextPatterns[index] = toModelPattern(provider, String(value))
  modelSettings.updateEnabledModels(cleanPatterns(nextPatterns))
}

function updateCustomPattern(index: number, value: string | number): void {
  const nextPatterns = [...modelSettings.draft.enabledModels]
  nextPatterns[index] = String(value)
  modelSettings.updateEnabledModels(nextPatterns)
}

function normalizePatterns(): void {
  modelSettings.updateEnabledModels(cleanPatterns(modelSettings.draft.enabledModels))
}

function updateNewProvider(value: string | number): void {
  newProviderValue.value = String(value)
  newModelValue.value = newModelOptions.value[0]?.value ?? ''
}

function addPattern(): void {
  const pattern = newPatternValue.value
  if (!pattern) {
    return
  }
  modelSettings.updateEnabledModels(cleanPatterns([...modelSettings.draft.enabledModels, pattern]))
  if (newProviderValue.value === CUSTOM_PATTERN_VALUE) {
    newCustomPattern.value = ''
  }
}

function removePattern(index: number): void {
  modelSettings.updateEnabledModels(
    modelSettings.draft.enabledModels.filter((_, itemIndex) => itemIndex !== index)
  )
}

function movePattern(index: number, direction: -1 | 1): void {
  const targetIndex = index + direction
  if (targetIndex < 0 || targetIndex >= modelSettings.draft.enabledModels.length) {
    return
  }
  const nextPatterns = [...modelSettings.draft.enabledModels]
  const [pattern] = nextPatterns.splice(index, 1)
  nextPatterns.splice(targetIndex, 0, pattern)
  modelSettings.updateEnabledModels(nextPatterns)
}

function clearPatterns(): void {
  modelSettings.updateEnabledModels([])
}

function getKnownModelProvider(pattern: string): string | undefined {
  const parsed = parseModelPattern(pattern)
  if (!parsed) {
    return undefined
  }
  const hasModel = modelOptionsByProvider.value
    .get(parsed.provider)
    ?.some((option) => option.value === parsed.modelId)
  return hasModel ? parsed.provider : undefined
}

function parseModelPattern(pattern: string): { provider: string; modelId: string } | undefined {
  const separatorIndex = pattern.indexOf('/')
  if (separatorIndex <= 0 || separatorIndex === pattern.length - 1) {
    return undefined
  }
  return {
    provider: pattern.slice(0, separatorIndex),
    modelId: pattern.slice(separatorIndex + 1)
  }
}

function toModelPattern(provider: string, modelId: string): string {
  return `${provider}/${modelId}`
}

function cleanPatterns(patterns: string[]): string[] {
  return patterns.map((pattern) => pattern.trim()).filter(Boolean)
}
</script>

<template>
  <div class="models-page">
    <header class="models-page__header">
      <div>
        <p class="models-page__eyebrow">enabledModels</p>
        <h1 class="models-page__title">模型循环列表</h1>
        <p class="models-page__subtitle">
          配置 Pi-compatible model patterns，用于初始模型和模型切换顺序。
        </p>
      </div>
      <BaseButton
        size="sm"
        variant="primary"
        :disabled="modelSettings.saving"
        @click="modelSettings.saveEnabledModels"
      >
        <template #icon>
          <Save :size="14" />
        </template>
        保存模型列表
      </BaseButton>
    </header>

    <div v-if="modelSettings.error" class="state-strip is-error">{{ modelSettings.error }}</div>

    <BasePanel title="模型循环顺序" eyebrow="enabledModels">
      <div class="routing-summary" aria-label="Model cycling summary">
        <div>
          <span>Cycling</span>
          <strong>{{ cyclingSummaryLabel }}</strong>
        </div>
        <div>
          <span>Default</span>
          <strong>{{ defaultModelLabel }}</strong>
        </div>
        <div>
          <span>Initial</span>
          <strong>{{ initialModelLabel }}</strong>
        </div>
      </div>

      <section class="scoped-pattern-editor" aria-label="模型循环列表">
        <div class="scoped-pattern-editor__header">
          <div>
            <h3>循环 Patterns</h3>
            <p>列表第 1 项会作为新会话初始 scoped model；后续切换按列表顺序循环。</p>
          </div>
          <BaseButton
            size="sm"
            variant="secondary"
            :disabled="patternCount === 0"
            @click="clearPatterns"
          >
            清空列表
          </BaseButton>
        </div>

        <div class="scoped-pattern-bulk" aria-label="添加模型 pattern">
          <span class="scoped-pattern-bulk__label">
            <strong>添加模型</strong>
            <span>追加到循环末尾</span>
          </span>
          <SettingsSelectField
            class="scoped-pattern-bulk__provider"
            :model-value="newProviderValue"
            label="模型来源"
            :options="providerSelectOptions"
            @update:model-value="updateNewProvider"
          />
          <SettingsSelectField
            v-if="newProviderValue !== CUSTOM_PATTERN_VALUE"
            class="scoped-pattern-bulk__model"
            :model-value="newModelValue"
            label="模型"
            :options="newModelOptions"
            virtual
            @update:model-value="newModelValue = String($event)"
          />
          <SettingsTextField
            v-if="newProviderValue === CUSTOM_PATTERN_VALUE"
            class="scoped-pattern-bulk__custom"
            :model-value="newCustomPattern"
            label="Pattern"
            placeholder="例如 claude-* 或 openai/gpt-*"
            @update:model-value="newCustomPattern = String($event)"
            @blur="newCustomPattern = newCustomPattern.trim()"
          />
          <BaseButton
            class="scoped-pattern-bulk__action"
            size="sm"
            variant="secondary"
            :disabled="!canAddPattern"
            @click="addPattern"
          >
            <template #icon>
              <Plus :size="14" />
            </template>
            添加
          </BaseButton>
        </div>

        <div v-if="patternCount > 0" class="scoped-pattern-list">
          <div class="scoped-pattern-list__header" aria-hidden="true">
            <span>顺序</span>
            <span>类型</span>
            <span>模型来源</span>
            <span>模型 / Pattern</span>
            <span>操作</span>
          </div>
          <div
            v-for="(pattern, index) in modelSettings.draft.enabledModels"
            :key="index"
            class="scoped-pattern-row"
            :title="pattern"
          >
            <span class="scoped-pattern-row__scope">
              <strong>#{{ index + 1 }}</strong>
              <span>{{ index === 0 ? '初始模型' : '循环项' }}</span>
            </span>
            <BaseBadge :tone="index === 0 ? 'info' : 'neutral'">
              {{ index === 0 ? 'Initial' : 'Cycle' }}
            </BaseBadge>
            <SettingsSelectField
              class="scoped-pattern-row__provider"
              :model-value="getPatternProviderValue(index)"
              label="模型来源"
              :options="providerSelectOptions"
              @update:model-value="updatePatternProvider(index, $event)"
            />
            <SettingsSelectField
              v-if="getPatternProviderValue(index) !== CUSTOM_PATTERN_VALUE"
              class="scoped-pattern-row__model"
              :model-value="getPatternModelValue(index)"
              label="模型"
              :options="getModelOptionsForPattern(index)"
              virtual
              @update:model-value="updatePatternModel(index, $event)"
            />
            <SettingsTextField
              v-if="getPatternProviderValue(index) === CUSTOM_PATTERN_VALUE"
              class="scoped-pattern-row__custom"
              :model-value="getPatternForIndex(index)"
              label="Pattern"
              placeholder="例如 claude-* 或 openai/gpt-*"
              @update:model-value="updateCustomPattern(index, $event)"
              @blur="normalizePatterns"
            />
            <span class="scoped-pattern-row__actions">
              <BaseButton
                size="sm"
                variant="ghost"
                :disabled="index === 0"
                aria-label="上移"
                @click.prevent="movePattern(index, -1)"
              >
                <template #icon>
                  <ArrowUp :size="14" />
                </template>
              </BaseButton>
              <BaseButton
                size="sm"
                variant="ghost"
                :disabled="index === patternCount - 1"
                aria-label="下移"
                @click.prevent="movePattern(index, 1)"
              >
                <template #icon>
                  <ArrowDown :size="14" />
                </template>
              </BaseButton>
              <BaseButton
                size="sm"
                variant="ghost"
                aria-label="删除"
                @click.prevent="removePattern(index)"
              >
                <template #icon>
                  <Trash2 :size="14" />
                </template>
              </BaseButton>
            </span>
          </div>
        </div>
        <div v-else class="scoped-pattern-empty">
          未配置 enabledModels；新会话会使用默认模型，模型切换使用可用模型列表。
        </div>
      </section>
    </BasePanel>
  </div>
</template>
