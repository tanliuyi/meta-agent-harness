<script setup lang="ts">
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'
import useModelSettingsStore from '@renderer/stores/model-settings'
import { onMounted } from 'vue'
import { RouterLink, RouterView } from 'vue-router'

const modelSettings = useModelSettingsStore()

const links = [
  { to: '/settings/models/default', label: '默认模型' },
  { to: '/settings/models/thinking', label: '思考' },
  { to: '/settings/models/registry', label: '模型' },
  { to: '/settings/models/tasks', label: '任务模型' },
  { to: '/settings/models/providers', label: '自定义模型' },
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
    <ScrollArea class="models-shell__nav">
      <div class="models-shell__nav-header">
        <h1>模型</h1>
        <p>每个配置项独立保存</p>
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
