<script setup lang="ts">
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import { onMounted } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import './agent-settings.scss'

const agentSettings = useAgentSettingsStore()

const links = [
  { to: '/settings/agent/delivery', label: '消息投递' },
  { to: '/settings/agent/runtime', label: '运行时' },
  { to: '/settings/agent/display', label: '显示与交互' },
  { to: '/settings/agent/safety', label: '安全与遥测' },
  { to: '/settings/agent/media', label: '图片与终端' },
  { to: '/settings/agent/shell', label: 'Shell' },
  { to: '/settings/agent/resources', label: '资源路径' },
  { to: '/settings/agent/advanced', label: '高级' },
  { to: '/settings/agent/status', label: '状态' }
]

onMounted(() => {
  if (!agentSettings.snapshot) {
    void agentSettings.load()
  }
})
</script>

<template>
  <div class="agent-shell">
    <ScrollArea class="agent-shell__nav">
      <div class="agent-shell__nav-header">
        <h1>Agent</h1>
        <p>每个配置域独立保存，切换页面会保留当前编辑状态。</p>
      </div>
      <RouterLink
        v-for="link in links"
        :key="link.to"
        class="agent-shell__link"
        :to="link.to"
      >
        {{ link.label }}
      </RouterLink>
    </ScrollArea>
    <section class="agent-shell__content">
      <ScrollArea class="agent-shell__content-scroll">
        <RouterView v-slot="{ Component }">
          <KeepAlive>
            <component :is="Component" />
          </KeepAlive>
        </RouterView>
      </ScrollArea>
    </section>
  </div>
</template>
