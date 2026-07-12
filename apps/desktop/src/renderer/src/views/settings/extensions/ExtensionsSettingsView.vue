<script setup lang="ts">
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import { onMounted } from 'vue'
import { RouterLink, RouterView } from 'vue-router'

const agentSettings = useAgentSettingsStore()

const links = [
  { to: '/settings/extensions/discovery', label: '扩展列表' },
  { to: '/settings/extensions/packages', label: '包来源' }
]

onMounted(() => {
  if (!agentSettings.snapshot) {
    void agentSettings.load()
  }
})
</script>

<template>
  <div class="extensions-shell">
    <ScrollArea class="extensions-shell__nav">
      <div class="extensions-shell__nav-header">
        <h1>扩展</h1>
        <p>查看已发现扩展，并管理包来源与本地扩展路径。</p>
      </div>
      <RouterLink v-for="link in links" :key="link.to" class="extensions-shell__link" :to="link.to">
        {{ link.label }}
      </RouterLink>
    </ScrollArea>
    <section class="extensions-shell__content">
      <ScrollArea class="extensions-shell__content-scroll">
        <RouterView v-slot="{ Component }">
          <KeepAlive>
            <component :is="Component" />
          </KeepAlive>
        </RouterView>
      </ScrollArea>
    </section>
  </div>
</template>
