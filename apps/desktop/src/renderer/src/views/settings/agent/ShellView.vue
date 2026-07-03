<script setup lang="ts">
import { BaseButton, BasePanel } from '@renderer/components/base'
import { SettingsArrayField, SettingsTextField } from '@renderer/views/settings/components/form'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import { Save } from 'lucide-vue-next'

const agentSettings = useAgentSettingsStore()
</script>

<template>
  <div class="agent-page">
    <header class="agent-page__header">
      <div>
        <p class="agent-page__eyebrow">Commands</p>
        <h1 class="agent-page__title">Shell</h1>
        <p class="agent-page__subtitle">只保存 shell、npm command 和 session 目录。</p>
      </div>
      <BaseButton size="sm" variant="primary" :disabled="!agentSettings.canSave" @click="agentSettings.saveShell">
        <template #icon><Save :size="14" /></template>
        保存 Shell
      </BaseButton>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="Shell" eyebrow="Commands">
      <div class="field-stack">
        <SettingsTextField
          v-model="agentSettings.draft.shell.shellPath"
          label="Shell 路径 Shell path"
          placeholder="例如 /bin/zsh"
        />
        <SettingsTextField
          v-model="agentSettings.draft.shell.shellCommandPrefix"
          label="Shell 命令前缀 Shell command prefix"
          placeholder="例如 shopt -s expand_aliases"
        />
        <SettingsArrayField
          v-model="agentSettings.draft.shell.npmCommand"
          label="NPM 命令参数 NPM command argv"
          description="每个 argv 独立一项，保存时仍写入 Pi 兼容的 string[]。"
          placeholder="例如 mise"
          add-label="添加 argv"
        />
        <SettingsTextField
          v-model="agentSettings.draft.shell.sessionDir"
          label="会话目录 Session dir"
          placeholder="例如 ~/.pi/sessions"
        />
      </div>
    </BasePanel>
  </div>
</template>
