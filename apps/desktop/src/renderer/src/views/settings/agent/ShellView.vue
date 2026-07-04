<script setup lang="ts">
import { BaseBadge, BaseButton, BasePanel } from '@renderer/components/base'
import { SettingsArrayField, SettingsTextField } from '@renderer/views/settings/components/form'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import { Save } from 'lucide-vue-next'
import { computed } from 'vue'

const agentSettings = useAgentSettingsStore()

const shellSummary = computed(() => {
  const shell = agentSettings.draft?.shell
  if (!shell) {
    return []
  }
  const npmCommandLabel = shell.npmCommand.length > 0 ? shell.npmCommand.join(' ') : 'npm'
  return [
    {
      label: 'Shell',
      value: shell.shellPath?.trim() || 'System default',
      detail: shell.shellPath?.trim() ? 'Bash tool 使用自定义 shell' : '使用 Pi/runtime 默认 shell',
      tone: shell.shellPath?.trim() ? 'info' : 'neutral',
      badgeLabel: shell.shellPath?.trim() ? 'Custom' : 'Default'
    },
    {
      label: 'Prefix',
      value: shell.shellCommandPrefix?.trim() ? 'Enabled' : 'None',
      detail: shell.shellCommandPrefix?.trim() || '每条 bash command 不追加前缀',
      tone: shell.shellCommandPrefix?.trim() ? 'info' : 'neutral',
      badgeLabel: shell.shellCommandPrefix?.trim() ? 'Prepended' : 'Off'
    },
    {
      label: 'NPM',
      value: npmCommandLabel,
      detail:
        shell.npmCommand.length > 0
          ? `${shell.npmCommand.length} argv entries`
          : '使用默认 npm 命令',
      tone: shell.npmCommand.length > 0 ? 'info' : 'neutral',
      badgeLabel: shell.npmCommand.length > 0 ? 'Custom' : 'Default'
    },
    {
      label: 'Sessions',
      value: shell.sessionDir?.trim() || 'Default dir',
      detail: shell.sessionDir?.trim()
        ? '写入自定义 session directory'
        : '使用 Pi 默认 session directory',
      tone: shell.sessionDir?.trim() ? 'info' : 'neutral',
      badgeLabel: shell.sessionDir?.trim() ? 'Custom' : 'Default'
    }
  ] as Array<{
    label: string
    value: string
    detail: string
    tone: 'neutral' | 'success' | 'warning' | 'info'
    badgeLabel: string
  }>
})
</script>

<template>
  <div class="agent-page">
    <header class="agent-page__header">
      <div>
        <p class="agent-page__eyebrow">Commands</p>
        <h1 class="agent-page__title">Shell</h1>
        <p class="agent-page__subtitle">只保存 shell、npm command 和 session 目录。</p>
      </div>
      <BaseButton
        size="sm"
        variant="primary"
        :disabled="!agentSettings.canSave"
        @click="agentSettings.saveShell"
      >
        <template #icon>
          <Save :size="14" />
        </template>
        保存 Shell
      </BaseButton>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="Shell" eyebrow="Commands">
      <div class="shell-summary" aria-label="Shell settings summary">
        <div v-for="item in shellSummary" :key="item.label">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
          <small>{{ item.detail }}</small>
          <BaseBadge :tone="item.tone">{{ item.badgeLabel }}</BaseBadge>
        </div>
      </div>

      <div class="shell-field-groups">
        <section>
          <header>
            <strong>Command Environment</strong>
            <span>Bash tool 使用的 shell 和命令前缀</span>
          </header>
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
          </div>
        </section>

        <section>
          <header>
            <strong>Package Command</strong>
            <span>npm lookup/install 使用的 argv-style 命令</span>
          </header>
          <SettingsArrayField
            v-model="agentSettings.draft.shell.npmCommand"
            label="NPM 命令参数 NPM command argv"
            description="每个 argv 独立一项，保存时仍写入 Pi 兼容的 string[]。"
            placeholder="例如 mise"
            add-label="添加 argv"
          />
        </section>

        <section>
          <header>
            <strong>Session Storage</strong>
            <span>Pi-compatible JSONL session 的全局存储目录</span>
          </header>
          <SettingsTextField
            v-model="agentSettings.draft.shell.sessionDir"
            label="会话目录 Session dir"
            placeholder="例如 ~/.pi/sessions"
          />
        </section>
      </div>
    </BasePanel>
  </div>
</template>
