<script setup lang="ts">
import { BaseButton, BasePanel } from '@renderer/components/base'
import { SettingsSwitchField, SettingsTextField } from '@renderer/views/settings/components/form'
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
      <BaseButton size="sm" variant="primary" :disabled="!agentSettings.canSave" @click="agentSettings.saveMedia">
        <template #icon><Save :size="14" /></template>
        保存图片与终端
      </BaseButton>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="图片与终端" eyebrow="Media">
      <div class="switch-list">
        <SettingsSwitchField v-model="agentSettings.draft.media.imageAutoResize" title="自动缩放图片" description="发送前缩放过大的图片，提高 provider 兼容性。" />
        <SettingsSwitchField v-model="agentSettings.draft.media.blockImages" title="阻止图片发送" description="禁止所有图片进入 LLM provider 请求。" />
        <SettingsSwitchField v-model="agentSettings.draft.media.showImages" title="终端内联图片" description="允许支持图片协议的 terminal 显示图片。" />
        <SettingsSwitchField v-model="agentSettings.draft.media.clearOnShrink" title="收缩时清屏" description="内容变短时清理终端空白行。" />
        <SettingsSwitchField v-model="agentSettings.draft.media.showTerminalProgress" title="终端进度" description="使用 OSC 9;4 显示进度。" />
      </div>

      <SettingsTextField
        v-model="agentSettings.draft.media.imageWidthCells"
        label="图片宽度单元 Image width cells"
        type="number"
        :min="1"
      />
    </BasePanel>
  </div>
</template>
