<script setup lang="ts">
import { BaseButton, BasePanel } from '@renderer/components/base'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import { Save } from 'lucide-vue-next'

const agentSettings = useAgentSettingsStore()
</script>

<template>
  <div class="agent-page">
    <header class="agent-page__header">
      <div>
        <p class="agent-page__eyebrow">Media</p>
        <h1 class="agent-page__title">图片与终端</h1>
        <p class="agent-page__subtitle">只保存图片处理和终端呈现设置。</p>
      </div>
      <BaseButton variant="primary" :disabled="!agentSettings.canSave" @click="agentSettings.saveMedia">
        <template #icon><Save :size="14" /></template>
        保存图片与终端
      </BaseButton>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="图片与终端" eyebrow="Media">
      <div class="switch-list">
        <label class="switch-row">
          <input v-model="agentSettings.draft.media.imageAutoResize" type="checkbox" />
          <span><strong>自动缩放图片</strong><small>发送前缩放过大的图片，提高 provider 兼容性。</small></span>
        </label>
        <label class="switch-row">
          <input v-model="agentSettings.draft.media.blockImages" type="checkbox" />
          <span><strong>阻止图片发送</strong><small>禁止所有图片进入 LLM provider 请求。</small></span>
        </label>
        <label class="switch-row">
          <input v-model="agentSettings.draft.media.showImages" type="checkbox" />
          <span><strong>终端内联图片</strong><small>允许支持图片协议的 terminal 显示图片。</small></span>
        </label>
        <label class="switch-row">
          <input v-model="agentSettings.draft.media.clearOnShrink" type="checkbox" />
          <span><strong>收缩时清屏</strong><small>内容变短时清理终端空白行。</small></span>
        </label>
        <label class="switch-row">
          <input v-model="agentSettings.draft.media.showTerminalProgress" type="checkbox" />
          <span><strong>终端进度</strong><small>使用 OSC 9;4 显示进度。</small></span>
        </label>
      </div>

      <label class="number-field" style="margin-top: var(--space-3)">
        <span>图片宽度 cells</span>
        <input v-model.number="agentSettings.draft.media.imageWidthCells" min="1" type="number" />
      </label>
    </BasePanel>
  </div>
</template>
