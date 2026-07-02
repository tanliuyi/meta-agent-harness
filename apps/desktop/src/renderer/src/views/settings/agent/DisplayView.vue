<script setup lang="ts">
import { BaseButton, BasePanel } from '@renderer/components/base'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import type { AgentDoubleEscapeAction, AgentTreeFilterMode } from '@shared/coding-agent/types'
import { Save } from 'lucide-vue-next'

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
</script>

<template>
  <div class="agent-page">
    <header class="agent-page__header">
      <div>
        <p class="agent-page__eyebrow">Display</p>
        <h1 class="agent-page__title">显示与交互</h1>
        <p class="agent-page__subtitle">只保存主题、启动输出、thinking 显示和输入交互。</p>
      </div>
      <BaseButton variant="primary" :disabled="!agentSettings.canSave" @click="agentSettings.saveDisplay">
        <template #icon><Save :size="14" /></template>
        保存显示与交互
      </BaseButton>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="显示与交互" eyebrow="Display">
      <label class="text-field">
        <span>Theme</span>
        <input v-model="agentSettings.draft.display.theme" placeholder="主题名称或 theme 路径" />
      </label>

      <div class="switch-list" style="margin-top: var(--space-3)">
        <label class="switch-row">
          <input v-model="agentSettings.draft.display.quietStartup" type="checkbox" />
          <span><strong>安静启动</strong><small>减少启动时的非必要输出。</small></span>
        </label>
        <label class="switch-row">
          <input v-model="agentSettings.draft.display.collapseChangelog" type="checkbox" />
          <span><strong>折叠 Changelog</strong><small>版本更新后显示精简 changelog。</small></span>
        </label>
        <label class="switch-row">
          <input v-model="agentSettings.draft.display.hideThinkingBlock" type="checkbox" />
          <span><strong>隐藏 Thinking</strong><small>隐藏 assistant thinking block。</small></span>
        </label>
        <label class="switch-row">
          <input v-model="agentSettings.draft.display.showHardwareCursor" type="checkbox" />
          <span><strong>硬件光标</strong><small>输入法定位场景中显示 terminal cursor。</small></span>
        </label>
      </div>

      <div class="form-grid" style="margin-top: var(--space-4)">
        <label class="select-field">
          <span>Double Escape</span>
          <select v-model="agentSettings.draft.display.doubleEscapeAction">
            <option v-for="option in doubleEscapeOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
        <label class="select-field">
          <span>Tree filter</span>
          <select v-model="agentSettings.draft.display.treeFilterMode">
            <option v-for="option in treeFilterOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
        <label class="number-field">
          <span>Editor padding</span>
          <input v-model.number="agentSettings.draft.display.editorPaddingX" min="0" max="3" type="number" />
        </label>
        <label class="number-field">
          <span>Autocomplete rows</span>
          <input v-model.number="agentSettings.draft.display.autocompleteMaxVisible" min="3" max="20" type="number" />
        </label>
      </div>
    </BasePanel>
  </div>
</template>
