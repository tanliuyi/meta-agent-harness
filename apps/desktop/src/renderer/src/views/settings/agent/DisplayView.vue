<script setup lang="ts">
import { BaseBadge, BaseButton, BasePanel } from '@renderer/components/base'
import {
  SettingsSelectField,
  SettingsSwitchField,
  SettingsTextField
} from '@renderer/views/settings/components/form'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import type { AgentDoubleEscapeAction, AgentTreeFilterMode } from '@shared/coding-agent/types'
import { Save } from 'lucide-vue-next'
import { computed } from 'vue'

const agentSettings = useAgentSettingsStore()

const doubleEscapeOptions: Array<{ label: string; value: AgentDoubleEscapeAction }> = [
  { label: '分叉', value: 'fork' },
  { label: '树视图', value: 'tree' },
  { label: '无操作', value: 'none' }
]

const treeFilterOptions: Array<{ label: string; value: AgentTreeFilterMode }> = [
  { label: '默认', value: 'default' },
  { label: '无工具', value: 'no-tools' },
  { label: '仅用户', value: 'user-only' },
  { label: '有标签', value: 'labeled-only' },
  { label: '全部', value: 'all' }
]

const displaySummary = computed(() => {
  const display = agentSettings.draft?.display
  if (!display) {
    return []
  }
  return [
    {
      label: 'Theme',
      value: display.theme?.trim() || 'Default',
      detail: display.quietStartup ? '安静启动' : '显示启动输出',
      tone: display.theme?.trim() ? 'info' : 'neutral',
      badgeLabel: display.theme?.trim() ? 'Custom' : 'Default'
    },
    {
      label: 'Thinking',
      value: display.hideThinkingBlock ? 'Hidden' : 'Visible',
      detail: display.hideThinkingBlock
        ? '聊天中默认隐藏 reasoning block'
        : '聊天中显示 reasoning block',
      tone: display.hideThinkingBlock ? 'neutral' : 'success',
      badgeLabel: display.hideThinkingBlock ? 'Quiet' : 'Shown'
    },
    {
      label: 'Tree',
      value: getTreeFilterTitle(display.treeFilterMode),
      detail: '打开 session tree 时的默认过滤策略',
      tone: display.treeFilterMode === 'default' ? 'neutral' : 'info',
      badgeLabel: 'Filter'
    },
    {
      label: 'Escape',
      value: getDoubleEscapeTitle(display.doubleEscapeAction),
      detail: '空编辑器双击 Esc 的快捷动作',
      tone: display.doubleEscapeAction === 'none' ? 'neutral' : 'success',
      badgeLabel: display.doubleEscapeAction === 'none' ? 'Off' : 'Shortcut'
    }
  ] as Array<{
    label: string
    value: string
    detail: string
    tone: 'neutral' | 'success' | 'warning' | 'info'
    badgeLabel: string
  }>
})

function getDoubleEscapeTitle(action: AgentDoubleEscapeAction): string {
  switch (action) {
    case 'fork':
      return '分叉'
    case 'tree':
      return '打开树视图'
    case 'none':
      return '无操作'
  }
}

function getTreeFilterTitle(mode: AgentTreeFilterMode): string {
  switch (mode) {
    case 'default':
      return '默认'
    case 'no-tools':
      return '隐藏工具'
    case 'user-only':
      return '仅用户'
    case 'labeled-only':
      return '仅标签'
    case 'all':
      return '全部'
  }
}
</script>

<template>
  <div class="agent-page">
    <header class="agent-page__header">
      <div>
        <p class="agent-page__eyebrow">Display</p>
        <h1 class="agent-page__title">显示与交互</h1>
        <p class="agent-page__subtitle">只保存主题、启动输出、thinking 显示和输入交互。</p>
      </div>
      <BaseButton
        size="sm"
        variant="primary"
        :disabled="!agentSettings.canSave"
        @click="agentSettings.saveDisplay"
      >
        <template #icon>
          <Save :size="14" />
        </template>
        保存显示与交互
      </BaseButton>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="显示与交互" eyebrow="Display">
      <div class="display-summary" aria-label="Display settings summary">
        <div v-for="item in displaySummary" :key="item.label">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
          <small>{{ item.detail }}</small>
          <BaseBadge :tone="item.tone">{{ item.badgeLabel }}</BaseBadge>
        </div>
      </div>

      <div class="display-field-groups">
        <section>
          <header>
            <strong>Appearance</strong>
            <span>主题、启动输出和 thinking 可见性</span>
          </header>
          <SettingsTextField
            v-model="agentSettings.draft.display.theme"
            label="主题 Theme"
            placeholder="主题名称或 theme 路径"
          />
          <div class="switch-list">
            <SettingsSwitchField
              v-model="agentSettings.draft.display.quietStartup"
              title="安静启动"
              description="减少启动时的非必要输出。"
            />
            <SettingsSwitchField
              v-model="agentSettings.draft.display.collapseChangelog"
              title="折叠 Changelog"
              description="版本更新后显示精简 changelog。"
            />
            <SettingsSwitchField
              v-model="agentSettings.draft.display.hideThinkingBlock"
              title="隐藏 Thinking"
              description="隐藏 assistant thinking block。"
            />
            <SettingsSwitchField
              v-model="agentSettings.draft.display.showHardwareCursor"
              title="硬件光标"
              description="输入法定位场景中显示 terminal cursor。"
            />
          </div>
        </section>

        <section>
          <header>
            <strong>Interaction</strong>
            <span>编辑器快捷动作和辅助列表密度</span>
          </header>
          <div class="form-grid">
            <SettingsSelectField
              v-model="agentSettings.draft.display.doubleEscapeAction"
              label="双击 Esc Double Escape"
              :options="doubleEscapeOptions"
            />
            <SettingsSelectField
              v-model="agentSettings.draft.display.treeFilterMode"
              label="树过滤 Tree filter"
              :options="treeFilterOptions"
            />
            <SettingsTextField
              v-model="agentSettings.draft.display.editorPaddingX"
              label="编辑器边距 Editor padding"
              type="number"
              :min="0"
              :max="3"
            />
            <SettingsTextField
              v-model="agentSettings.draft.display.autocompleteMaxVisible"
              label="自动补全行数 Autocomplete rows"
              type="number"
              :min="3"
              :max="20"
            />
          </div>
        </section>
      </div>
    </BasePanel>
  </div>
</template>
