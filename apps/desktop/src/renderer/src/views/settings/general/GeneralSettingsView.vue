<script setup lang="ts">
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'
import { BasePanel, BaseSegmentedControl } from '@renderer/components/base'
import { useWorkspaceViewSettings } from '@renderer/composables/useWorkspaceViewSettings'

const workspaceViewSettings = useWorkspaceViewSettings()
</script>

<template>
  <ScrollArea class="general-page-scroll">
    <div class="general-page">
      <header class="general-page__header">
        <div>
          <p class="general-page__eyebrow">General</p>
          <h1 class="general-page__title">通用</h1>
          <p class="general-page__subtitle">调整工作区的默认显示与操作方式。</p>
        </div>
      </header>

      <BasePanel title="项目视图" eyebrow="Workspace">
        <div class="general-field">
          <div class="general-field__copy">
            <strong>Thread 排序模式</strong>
            <span>按最近活动时间排序，或按 Fork 层级嵌套展示。</span>
          </div>
          <BaseSegmentedControl
            label="Thread 排序模式"
            :model-value="workspaceViewSettings.threadSortMode.value"
            :options="workspaceViewSettings.threadSortModeOptions"
            @update:model-value="workspaceViewSettings.setThreadSortMode"
          />
        </div>
      </BasePanel>
    </div>
  </ScrollArea>
</template>
