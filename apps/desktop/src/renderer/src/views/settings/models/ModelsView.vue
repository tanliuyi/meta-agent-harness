<script setup lang="ts">
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'
import useModelSettingsStore from '@renderer/stores/model-settings'
import { computed, onMounted } from 'vue'
import { RouterLink, RouterView } from 'vue-router'

const modelSettings = useModelSettingsStore()

const links = [
  { to: '/settings/models/default', label: '默认模型' },
  { to: '/settings/models/thinking', label: 'Thinking' },
  { to: '/settings/models/registry', label: '可用模型' },
  { to: '/settings/models/tasks', label: '任务模型' },
  { to: '/settings/models/api-keys', label: 'API Key' },
  { to: '/settings/models/providers', label: '自定义 Provider' },
  { to: '/settings/models/diagnostics', label: '诊断' }
]

const defaultModelLabel = computed(() => {
  const { provider, modelId } = modelSettings.draft.defaultModel
  if (!provider || !modelId) return '未配置默认模型'
  return `${provider}/${modelId}`
})

const availableModelCount = computed(
  () => modelSettings.models.filter((model) => model.status === 'available').length
)

const credentialIssueCount = computed(
  () =>
    modelSettings.credentialStatuses.filter(
      (credential) => credential.status === 'missing' || credential.status === 'invalid'
    ).length
)

const modelIssueCount = computed(
  () => modelSettings.diagnostics.filter((item) => item.severity !== 'info').length
)

onMounted(() => {
  if (!modelSettings.snapshot) {
    void modelSettings.load()
  }
})
</script>

<template>
  <div class="models-shell">
    <ScrollArea class="models-shell__nav">
      <div class="models-shell__nav-header">
        <h1>模型</h1>
        <p>每个配置项独立保存，切换页面会保留当前编辑状态。</p>
      </div>
      <RouterLink v-for="link in links" :key="link.to" class="models-shell__link" :to="link.to">
        {{ link.label }}
      </RouterLink>
    </ScrollArea>
    <section class="models-shell__content">
      <ScrollArea class="models-shell__content-scroll">
        <RouterView v-slot="{ Component }">
          <KeepAlive>
            <component :is="Component" />
          </KeepAlive>
        </RouterView>
      </ScrollArea>
    </section>
  </div>
</template>
