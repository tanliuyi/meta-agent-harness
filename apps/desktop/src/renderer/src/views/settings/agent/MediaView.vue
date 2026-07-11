<script setup lang="ts">
import { BaseButton, BasePanel } from '@renderer/components/base'
import { SettingsSliderField, SettingsSwitchField } from '@renderer/views/settings/components/form'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import { computed } from 'vue'
import { Image, Save } from 'lucide-vue-next'

const agentSettings = useAgentSettingsStore()

const imageModeLabel = computed(() => {
  const media = agentSettings.draft?.media
  if (!media) return '未加载'
  if (media.blockImages) return '图片不会发送给模型'
  return media.imageAutoResize ? '发送前自动压缩大图' : '按原始图片发送'
})
</script>

<template>
  <div class="agent-page">
    <header class="agent-page__header">
      <div>
        <p class="agent-page__eyebrow">Media</p>
        <h1 class="agent-page__title">图片输入</h1>
        <p class="agent-page__subtitle">只保存发送给 provider 前的图片处理设置。</p>
      </div>
      <BaseButton
        size="sm"
        variant="primary"
        :disabled="!agentSettings.canSave"
        @click="agentSettings.saveMedia"
      >
        <template #icon><Save :size="14" /></template>
        保存图片设置
      </BaseButton>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="图片输入" eyebrow="Prompt images">
      <div class="media-summary">
        <Image :size="16" />
        <div>
          <strong>{{ imageModeLabel }}</strong>
          <span>{{ agentSettings.draft.media.imageWidthCells }} cells preview width</span>
        </div>
      </div>

      <div class="switch-list">
        <SettingsSwitchField
          v-model="agentSettings.draft.media.imageAutoResize"
          title="自动缩放图片"
          description="发送前缩放过大的图片，提高 provider 兼容性。"
        />
        <SettingsSwitchField
          v-model="agentSettings.draft.media.blockImages"
          title="阻止图片发送"
          description="禁止所有图片进入 LLM provider 请求，但保留普通文本输入。"
        />
      </div>

      <SettingsSliderField
        v-model="agentSettings.draft.media.imageWidthCells"
        label="图片宽度单元 Image width cells"
        :min="1"
        :max="120"
        :step="1"
        description="控制对话中图片预览的目标宽度，使用 Pi-compatible imageWidthCells 设置。"
      />
    </BasePanel>
  </div>
</template>
