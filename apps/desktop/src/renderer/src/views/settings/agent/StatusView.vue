<script setup lang="ts">
import { BaseBadge, BasePanel } from '@renderer/components/base'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import { AlertTriangle } from 'lucide-vue-next'

const agentSettings = useAgentSettingsStore()
</script>

<template>
  <div class="agent-page">
    <header class="agent-page__header">
      <div>
        <p class="agent-page__eyebrow">Storage</p>
        <h1 class="agent-page__title">状态</h1>
        <p class="agent-page__subtitle">查看 Pi-compatible settings.json 路径和加载诊断。</p>
      </div>
    </header>

    <BasePanel title="状态" eyebrow="Storage">
      <div class="storage-row">
        <span>配置文件</span>
        <strong>{{ agentSettings.storage?.settingsPath }}</strong>
      </div>
      <div class="storage-row">
        <span>Agent dir</span>
        <strong>{{ agentSettings.storage?.agentDir }}</strong>
      </div>

      <ul v-if="agentSettings.diagnostics.length > 0" class="diagnostic-list">
        <li v-for="diagnostic in agentSettings.diagnostics" :key="diagnostic.id">
          <AlertTriangle :size="15" />
          <div>
            <strong>{{ diagnostic.message }}</strong>
            <p>{{ diagnostic.details }}</p>
          </div>
        </li>
      </ul>
      <BaseBadge v-else tone="success">settings.json 状态正常</BaseBadge>
    </BasePanel>
  </div>
</template>
