<script setup lang="ts">
import { BaseBadge, BaseField, BasePanel } from '@renderer/components/base'
import { SettingsSelectField } from '@renderer/views/settings/components/form'
import useModelSettingsStore, { type ModelStatus } from '@renderer/stores/model-settings'
import { ChevronRight, Database, Search } from 'lucide-vue-next'
import { computed, ref } from 'vue'

const modelSettings = useModelSettingsStore()
const searchQuery = ref('')
const statusFilter = ref('all')
const expandedProviderGroups = ref<Record<string, boolean>>({})

const statusFilters: Array<{ label: string; value: 'all' | ModelStatus }> = [
  { label: '全部', value: 'all' },
  { label: '可用', value: 'available' },
  { label: '缺凭据', value: 'missingAuth' },
  { label: '无效', value: 'invalid' },
  { label: '禁用', value: 'disabled' }
]

const statusLabels: Record<ModelStatus, string> = {
  available: '可用',
  missingAuth: '缺凭据',
  invalid: '无效',
  disabled: '禁用'
}

type ModelListItem = {
  model: (typeof modelSettings.models)[number]
  statusLabel: string
  badgeTone: 'neutral' | 'success' | 'warning' | 'info'
}

type ModelProviderGroup = {
  provider: string
  items: ModelListItem[]
}

const modelCount = computed(() => modelSettings.models.length)
const hasModels = computed(() => modelCount.value > 0)
const availableCount = computed(
  () => modelSettings.models.filter((model) => model.status === 'available').length
)
const missingAuthCount = computed(
  () => modelSettings.models.filter((model) => model.status === 'missingAuth').length
)
const invalidCount = computed(
  () => modelSettings.models.filter((model) => model.status === 'invalid').length
)
const disabledCount = computed(
  () => modelSettings.models.filter((model) => model.status === 'disabled').length
)
const providerCount = computed(
  () => new Set(modelSettings.models.map((model) => model.provider)).size
)
const toolsCount = computed(
  () => modelSettings.models.filter((model) => model.supportsTools).length
)
const imagesCount = computed(
  () => modelSettings.models.filter((model) => model.supportsImages).length
)
const reasoningCount = computed(
  () => modelSettings.models.filter((model) => model.supportsReasoning).length
)
const filteredModels = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return modelSettings.models.filter((model) => {
    const matchesStatus = statusFilter.value === 'all' || model.status === statusFilter.value
    const label = `${model.provider} ${model.id} ${model.displayName ?? ''}`.toLowerCase()
    return matchesStatus && (!query || label.includes(query))
  })
})
const hasFilteredModels = computed(() => filteredModels.value.length > 0)

const modelGroups = computed<ModelProviderGroup[]>(() => {
  const groups = new Map<string, ModelListItem[]>()
  for (const model of filteredModels.value) {
    const items = groups.get(model.provider) ?? []
    items.push({
      model,
      statusLabel: statusLabels[model.status],
      badgeTone: badgeToneForStatus(model.status)
    })
    groups.set(model.provider, items)
  }
  return [...groups.entries()].map(([provider, items]) => ({ provider, items }))
})

function badgeToneForStatus(status: ModelStatus): 'neutral' | 'success' | 'warning' | 'info' {
  if (status === 'available') return 'success'
  if (status === 'missingAuth' || status === 'invalid') return 'warning'
  return 'neutral'
}

function isProviderGroupExpanded(provider: string): boolean {
  return expandedProviderGroups.value[provider] === true
}

function toggleProviderGroup(provider: string): void {
  expandedProviderGroups.value = {
    ...expandedProviderGroups.value,
    [provider]: !isProviderGroupExpanded(provider)
  }
}

function formatTokenLimit(value: number | undefined, fallback: string): string {
  return value ? `${value.toLocaleString()} tokens` : fallback
}

function formatSource(source: string | undefined): string {
  switch (source) {
    case 'builtin':
      return '内置'
    case 'global':
      return 'Global'
    case 'project':
      return 'Project'
    case 'custom':
      return 'Custom'
    case 'extension':
      return 'Extension'
    case 'runtime':
      return 'Runtime'
    default:
      return source ?? '未知来源'
  }
}

function formatThinkingLevels(levels: string[] | undefined): string {
  if (!levels || levels.length === 0) return '未声明 thinking levels'
  return levels.join(' / ')
}
</script>

<template>
  <div class="models-page">
    <header class="models-page__header">
      <div>
        <p class="models-page__eyebrow">Registry</p>
        <h1 class="models-page__title">可用模型</h1>
        <p class="models-page__subtitle">查看当前 registry 中可选择的 provider 和 model。</p>
      </div>
    </header>

    <BasePanel title="模型注册表" eyebrow="Read only">
      <template #actions>
        <BaseBadge :tone="hasModels ? 'success' : 'warning'">
          {{ hasModels ? `${modelCount} 个模型` : '空' }}
        </BaseBadge>
      </template>

      <div class="toolbar">
        <BaseField
          id="model-search"
          v-model="searchQuery"
          type="search"
          label="搜索"
          placeholder="provider、model id 或显示名"
        />
        <SettingsSelectField v-model="statusFilter" label="状态 Status" :options="statusFilters" />
      </div>

      <div v-if="hasModels" class="registry-summary" aria-label="模型注册表摘要">
        <div>
          <span>Provider</span>
          <strong>{{ providerCount }}</strong>
        </div>
        <div>
          <span>可用</span>
          <strong>{{ availableCount }}</strong>
        </div>
        <div :class="{ 'has-warning': missingAuthCount > 0 }">
          <span>缺凭据</span>
          <strong>{{ missingAuthCount }}</strong>
        </div>
        <div :class="{ 'has-warning': invalidCount > 0 }">
          <span>无效</span>
          <strong>{{ invalidCount }}</strong>
        </div>
        <div>
          <span>禁用</span>
          <strong>{{ disabledCount }}</strong>
        </div>
        <div>
          <span>能力覆盖</span>
          <strong>{{ toolsCount }}T / {{ imagesCount }}I / {{ reasoningCount }}R</strong>
        </div>
      </div>

      <div v-if="!hasModels" class="empty-state">
        <Database :size="22" />
        <strong>没有可展示的模型</strong>
        <span>请检查模型注册表、凭据状态或自定义 provider 配置。</span>
      </div>

      <div v-else-if="!hasFilteredModels" class="empty-state">
        <Search :size="22" />
        <strong>没有匹配的模型</strong>
        <span>调整搜索词或状态筛选后再试。</span>
      </div>

      <div v-else class="provider-list">
        <section v-for="group in modelGroups" :key="group.provider" class="provider-group">
          <button
            class="provider-group__header"
            type="button"
            :aria-expanded="isProviderGroupExpanded(group.provider)"
            @click="toggleProviderGroup(group.provider)"
          >
            <ChevronRight
              class="provider-group__chevron"
              :class="{ 'is-expanded': isProviderGroupExpanded(group.provider) }"
              :size="16"
              aria-hidden="true"
            />
            <span>{{ group.provider }}</span>
            <BaseBadge tone="neutral">{{ group.items.length }} models</BaseBadge>
          </button>
          <ul v-if="isProviderGroupExpanded(group.provider)" class="plain-list registry-list">
            <li v-for="item in group.items" :key="`${item.model.provider}:${item.model.id}`">
              <div class="registry-list__copy">
                <strong>{{ item.model.displayName ?? item.model.id }}</strong>
                <span>{{ item.model.provider }}/{{ item.model.id }}</span>
                <div class="model-meta">
                  <span>
                    Context
                    {{ formatTokenLimit(item.model.contextWindow, '未知') }}
                  </span>
                  <span>
                    Output
                    {{ formatTokenLimit(item.model.maxOutputTokens, '未知') }}
                  </span>
                  <span>{{ formatSource(item.model.source) }}</span>
                </div>
                <div v-if="item.model.supportsReasoning" class="model-meta">
                  <span>{{ formatThinkingLevels(item.model.thinkingLevels) }}</span>
                </div>
              </div>
              <div class="model-badges">
                <BaseBadge :tone="item.badgeTone">
                  {{ item.statusLabel }}
                </BaseBadge>
                <BaseBadge v-if="item.model.supportsTools" tone="info">Tools</BaseBadge>
                <BaseBadge v-if="item.model.supportsImages" tone="info">Images</BaseBadge>
                <BaseBadge v-if="item.model.supportsReasoning" tone="info">Reasoning</BaseBadge>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </BasePanel>
  </div>
</template>
