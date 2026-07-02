<script setup lang="ts">
import useModelSettingsStore from '@renderer/stores/model-settings'
import { onMounted } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import './model-settings.scss'

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

onMounted(() => {
  if (!modelSettings.snapshot) {
    void modelSettings.load()
  }
})
</script>

<template>
  <div class="models-shell">
    <nav class="models-shell__nav">
      <div class="models-shell__nav-header">
        <h1>模型</h1>
        <p>每个配置项独立保存，切换页面会保留当前编辑状态。</p>
      </div>
      <RouterLink
        v-for="link in links"
        :key="link.to"
        class="models-shell__link"
        :to="link.to"
      >
        {{ link.label }}
      </RouterLink>
    </nav>
    <section class="models-shell__content">
      <RouterView v-slot="{ Component }">
        <KeepAlive>
          <component :is="Component" />
        </KeepAlive>
      </RouterView>
    </section>
  </div>
</template>
