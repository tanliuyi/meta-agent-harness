<script setup lang="ts">
/**
 * SessionPanel.vue - 当前活跃会话右侧面板的容器组件。
 *
 * 只负责面板外壳与折叠动作，具体 tabs 由 SessionPanelTabs 持有。
 */

import { BaseIconButton } from '@renderer/components/base'
import SessionPanelTabs from './panel/SessionPanelTabs.vue'

defineProps<{
  collapsed?: boolean
  disabled?: boolean
}>()

defineEmits<{
  toggle: []
}>()
</script>

<template>
  <section class="session-panel" :class="{ 'session-panel--collapsed': collapsed }">
    <SessionPanelTabs :collapsed="collapsed">
      <template #actions="{ hasAttention }">
        <div class="session-panel__actions">
          <BaseIconButton
            class="session-panel__collapse"
            :class="{ 'has-attention': collapsed && hasAttention }"
            :active="!collapsed"
            :disabled="disabled"
            :label="
              collapsed && hasAttention
                ? '展开会话面板，有新活动'
                : collapsed
                  ? '展开会话面板'
                  : '收起会话面板'
            "
            @click="$emit('toggle')"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              width="16"
              height="16"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </BaseIconButton>
        </div>
      </template>
    </SessionPanelTabs>
  </section>
</template>

<style lang="scss" src="./panel/session-panel.scss"></style>
