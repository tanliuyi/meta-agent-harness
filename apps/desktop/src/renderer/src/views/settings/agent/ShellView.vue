<script setup lang="ts">
import { BaseButton, BasePanel } from '@renderer/components/base'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import { Save } from 'lucide-vue-next'
import { computed } from 'vue'

const agentSettings = useAgentSettingsStore()

const npmCommandText = computed({
  get: () => (agentSettings.draft?.shell.npmCommand ?? []).join('\n'),
  set: (value: string) => {
    if (!agentSettings.draft) return
    agentSettings.draft.shell.npmCommand = splitLines(value)
  }
})

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
        <p class="agent-page__eyebrow">Commands</p>
        <h1 class="agent-page__title">Shell</h1>
        <p class="agent-page__subtitle">只保存 shell、npm command 和 session 目录。</p>
      </div>
      <BaseButton variant="primary" :disabled="!agentSettings.canSave" @click="agentSettings.saveShell">
        <template #icon><Save :size="14" /></template>
        保存 Shell
      </BaseButton>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="Shell" eyebrow="Commands">
      <div class="field-stack">
        <label class="text-field">
          <span>Shell path</span>
          <input v-model="agentSettings.draft.shell.shellPath" placeholder="例如 /bin/zsh" />
        </label>
        <label class="text-field">
          <span>Shell command prefix</span>
          <input v-model="agentSettings.draft.shell.shellCommandPrefix" placeholder="例如 shopt -s expand_aliases" />
        </label>
        <label class="textarea-field">
          <span>NPM command argv</span>
          <textarea v-model="npmCommandText" rows="4" placeholder="每行一个 argv，例如 mise" />
        </label>
        <label class="text-field">
          <span>Session dir</span>
          <input v-model="agentSettings.draft.shell.sessionDir" placeholder="例如 ~/.pi/sessions" />
        </label>
      </div>
    </BasePanel>
  </div>
</template>
