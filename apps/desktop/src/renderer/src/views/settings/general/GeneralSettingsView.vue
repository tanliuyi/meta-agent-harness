<script setup lang="ts">
import { BaseButton, BasePanel, BaseSegmentedControl } from '@renderer/components/base'
import { useAppearanceSettings } from '@renderer/composables/useAppearanceSettings'
import { useTheme } from '@renderer/composables/useTheme'
import { useWorkspaceViewSettings } from '@renderer/composables/useWorkspaceViewSettings'
import { RotateCcw } from 'lucide-vue-next'
import { computed } from 'vue'

const appearanceSettings = useAppearanceSettings()
const { setThemeMode, themeMode, themeOptions } = useTheme()
const workspaceViewSettings = useWorkspaceViewSettings()

const uiFontSizeModel = computed({
  get: () => appearanceSettings.uiFontSize.value,
  set: (value: number | string | null | undefined) => appearanceSettings.setUiFontSize(value)
})

const codeFontSizeModel = computed({
  get: () => appearanceSettings.codeFontSize.value,
  set: (value: number | string | null | undefined) => appearanceSettings.setCodeFontSize(value)
})
</script>

<template>
  <div class="general-page">
    <header class="general-page__header">
      <div>
        <p class="general-page__eyebrow">General</p>
        <h1 class="general-page__title">通用</h1>
        <p class="general-page__subtitle">调整应用主题与阅读密度，设置会即时生效并保存在本机。</p>
      </div>
      <BaseButton size="sm" variant="secondary" @click="appearanceSettings.resetFontSizes">
        <template #icon><RotateCcw :size="14" /></template>
        重置字体
      </BaseButton>
    </header>

    <BasePanel title="主题" eyebrow="Theme">
      <div class="general-field">
        <span>主题模式</span>
        <BaseSegmentedControl
          label="主题模式"
          :model-value="themeMode"
          :options="themeOptions"
          @update:model-value="setThemeMode"
        />
      </div>
    </BasePanel>

    <BasePanel title="项目视图" eyebrow="Workspace">
      <div class="general-field">
        <span>Thread 排序模式</span>
        <BaseSegmentedControl
          label="Thread 排序模式"
          :model-value="workspaceViewSettings.threadSortMode.value"
          :options="workspaceViewSettings.threadSortModeOptions"
          @update:model-value="workspaceViewSettings.setThreadSortMode"
        />
      </div>
      <p class="general-field__hint">
        决定侧边栏中每个项目下的 Thread 按最近活动时间排序，还是按 Fork 层级嵌套展示。
      </p>
    </BasePanel>

    <BasePanel title="字体大小" eyebrow="Typography">
      <div class="font-size-grid">
        <label class="font-size-field">
          <span>UI 字体大小</span>
          <div class="font-size-field__control">
            <input
              v-model.number="uiFontSizeModel"
              :min="appearanceSettings.uiFontSizeRange.min"
              :max="appearanceSettings.uiFontSizeRange.max"
              :step="appearanceSettings.uiFontSizeRange.step"
              type="range"
            />
            <input
              v-model.number="uiFontSizeModel"
              :min="appearanceSettings.uiFontSizeRange.min"
              :max="appearanceSettings.uiFontSizeRange.max"
              :step="appearanceSettings.uiFontSizeRange.step"
              type="number"
            />
          </div>
          <small>当前 {{ uiFontSizeModel }}px</small>
        </label>

        <label class="font-size-field">
          <span>代码字体大小</span>
          <div class="font-size-field__control">
            <input
              v-model.number="codeFontSizeModel"
              :min="appearanceSettings.codeFontSizeRange.min"
              :max="appearanceSettings.codeFontSizeRange.max"
              :step="appearanceSettings.codeFontSizeRange.step"
              type="range"
            />
            <input
              v-model.number="codeFontSizeModel"
              :min="appearanceSettings.codeFontSizeRange.min"
              :max="appearanceSettings.codeFontSizeRange.max"
              :step="appearanceSettings.codeFontSizeRange.step"
              type="number"
            />
          </div>
          <small>当前 {{ codeFontSizeModel }}px</small>
        </label>
      </div>
    </BasePanel>
  </div>
</template>
