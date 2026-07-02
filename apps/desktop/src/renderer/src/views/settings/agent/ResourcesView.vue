<script setup lang="ts">
import { BaseButton, BasePanel } from '@renderer/components/base'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import { Save } from 'lucide-vue-next'
import { computed } from 'vue'

const agentSettings = useAgentSettingsStore()

const resourcesText = computed({
  get: () => ({
    packages: joinLines(agentSettings.draft?.resources.packages ?? []),
    extensions: joinLines(agentSettings.draft?.resources.extensions ?? []),
    skills: joinLines(agentSettings.draft?.resources.skills ?? []),
    prompts: joinLines(agentSettings.draft?.resources.prompts ?? []),
    themes: joinLines(agentSettings.draft?.resources.themes ?? [])
  }),
  set: () => {}
})

function setList(
  key: 'packages' | 'extensions' | 'skills' | 'prompts' | 'themes',
  value: string
): void {
  if (!agentSettings.draft) return
  agentSettings.draft.resources[key] = splitLines(value)
}

function joinLines(values: string[]): string {
  return values.join('\n')
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}
</script>

<template>
  <div class="agent-page">
    <header class="agent-page__header">
      <div>
        <p class="agent-page__eyebrow">Resources</p>
        <h1 class="agent-page__title">资源路径</h1>
        <p class="agent-page__subtitle">只保存 packages、extensions、skills、prompts 和 themes。</p>
      </div>
      <BaseButton variant="primary" :disabled="!agentSettings.canSave" @click="agentSettings.saveResources">
        <template #icon><Save :size="14" /></template>
        保存资源路径
      </BaseButton>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="资源路径" eyebrow="Resources">
      <div class="resource-grid">
        <label class="textarea-field">
          <span>Packages</span>
          <textarea :value="resourcesText.packages" rows="6" placeholder="每行一个 npm/git package source" @input="setList('packages', ($event.target as HTMLTextAreaElement).value)" />
        </label>
        <label class="textarea-field">
          <span>Extensions</span>
          <textarea :value="resourcesText.extensions" rows="6" placeholder="每行一个 extension 路径" @input="setList('extensions', ($event.target as HTMLTextAreaElement).value)" />
        </label>
        <label class="textarea-field">
          <span>Skills</span>
          <textarea :value="resourcesText.skills" rows="6" placeholder="每行一个 skill 路径" @input="setList('skills', ($event.target as HTMLTextAreaElement).value)" />
        </label>
        <label class="textarea-field">
          <span>Prompts</span>
          <textarea :value="resourcesText.prompts" rows="6" placeholder="每行一个 prompt 路径" @input="setList('prompts', ($event.target as HTMLTextAreaElement).value)" />
        </label>
        <label class="textarea-field">
          <span>Themes</span>
          <textarea :value="resourcesText.themes" rows="6" placeholder="每行一个 theme 路径" @input="setList('themes', ($event.target as HTMLTextAreaElement).value)" />
        </label>
      </div>
    </BasePanel>
  </div>
</template>
