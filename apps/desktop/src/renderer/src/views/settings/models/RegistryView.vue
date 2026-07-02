<script setup lang="ts">
import { BaseBadge, BaseField, BasePanel } from '@renderer/components/base'
import useModelSettingsStore, { type ModelStatus } from '@renderer/stores/model-settings'
import { Database, Search } from 'lucide-vue-next'
import { computed, ref } from 'vue'

const modelSettings = useModelSettingsStore()
const searchQuery = ref('')
const statusFilter = ref<'all' | ModelStatus>('all')

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

const filteredModels = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return modelSettings.models.filter((model) => {
    const matchesStatus = statusFilter.value === 'all' || model.status === statusFilter.value
    const label = `${model.provider} ${model.id} ${model.displayName ?? ''}`.toLowerCase()
    return matchesStatus && (!query || label.includes(query))
  })
})

const groupedModels = computed(() => {
  return filteredModels.value.reduce<Record<string, typeof filteredModels.value>>(
    (groups, model) => {
      groups[model.provider] ??= []
      groups[model.provider].push(model)
      return groups
    },
    {}
  )
})

function badgeToneForStatus(status: ModelStatus): 'neutral' | 'success' | 'warning' | 'info' {
  if (status === 'available') return 'success'
  if (status === 'missingAuth' || status === 'invalid') return 'warning'
  return 'neutral'
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
        <BaseBadge :tone="modelSettings.models.length > 0 ? 'success' : 'warning'">
          {{ modelSettings.models.length > 0 ? `${modelSettings.models.length} 个模型` : '空' }}
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
        <label class="select-field">
          <span>状态</span>
          <select v-model="statusFilter">
            <option v-for="option in statusFilters" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
      </div>

      <div v-if="modelSettings.models.length === 0" class="empty-state">
        <Database :size="22" />
        <strong>没有可展示的模型</strong>
        <span>请检查模型注册表、凭据状态或自定义 provider 配置。</span>
      </div>

      <div v-else-if="filteredModels.length === 0" class="empty-state">
        <Search :size="22" />
        <strong>没有匹配的模型</strong>
        <span>调整搜索词或状态筛选后再试。</span>
      </div>

      <div v-else class="provider-list">
        <section v-for="(items, provider) in groupedModels" :key="provider" class="provider-group">
          <h3>{{ provider }}</h3>
          <ul class="plain-list">
            <li v-for="model in items" :key="`${model.provider}:${model.id}`">
              <div>
                <strong>{{ model.displayName ?? model.id }}</strong>
                <span>{{ model.provider }}/{{ model.id }}</span>
              </div>
              <div class="model-badges">
                <BaseBadge :tone="badgeToneForStatus(model.status)">
                  {{ statusLabels[model.status] }}
                </BaseBadge>
                <BaseBadge v-if="model.supportsTools" tone="info">Tools</BaseBadge>
                <BaseBadge v-if="model.supportsImages" tone="info">Images</BaseBadge>
                <BaseBadge v-if="model.supportsReasoning" tone="info">Reasoning</BaseBadge>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </BasePanel>
  </div>
</template>
