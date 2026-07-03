<script setup lang="ts">
import { BaseButton, BasePanel } from '@renderer/components/base'
import { SettingsArrayField } from '@renderer/views/settings/components/form'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import { Save } from 'lucide-vue-next'

const agentSettings = useAgentSettingsStore()
</script>

<template>
  <div class="agent-page">
    <header class="agent-page__header">
      <div>
        <p class="agent-page__eyebrow">Resources</p>
        <h1 class="agent-page__title">资源路径</h1>
        <p class="agent-page__subtitle">只保存 packages、extensions、skills、prompts 和 themes。</p>
      </div>
      <BaseButton size="sm" variant="primary" :disabled="!agentSettings.canSave" @click="agentSettings.saveResources">
        <template #icon><Save :size="14" /></template>
        保存资源路径
      </BaseButton>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="资源路径" eyebrow="Resources">
      <div class="resource-grid">
        <SettingsArrayField
          v-model="agentSettings.draft.resources.packages"
          label="包 Packages"
          description="npm、git 或本地 package source。"
          placeholder="例如 @scope/package 或 /path/to/package"
          select-title="选择 package 目录"
          path-actions
          path-mode="any"
        />
        <SettingsArrayField
          v-model="agentSettings.draft.resources.extensions"
          label="扩展 Extensions"
          description="每个 extension 单独一项。"
          placeholder="例如 /path/to/extension"
          select-title="选择 extension 目录"
          path-actions
        />
        <SettingsArrayField
          v-model="agentSettings.draft.resources.skills"
          label="技能 Skills"
          description="每个 skill 目录单独一项。"
          placeholder="例如 /path/to/skill"
          select-title="选择 skill 目录"
          path-actions
        />
        <SettingsArrayField
          v-model="agentSettings.draft.resources.prompts"
          label="提示词 Prompts"
          description="每个 prompt 资源路径单独一项。"
          placeholder="例如 /path/to/prompts"
          select-title="选择 prompt 路径"
          path-actions
          path-mode="any"
        />
        <SettingsArrayField
          v-model="agentSettings.draft.resources.themes"
          label="主题 Themes"
          description="每个 theme 路径单独一项。"
          placeholder="例如 /path/to/themes"
          select-title="选择 theme 路径"
          path-actions
          path-mode="any"
        />
      </div>
    </BasePanel>
  </div>
</template>
