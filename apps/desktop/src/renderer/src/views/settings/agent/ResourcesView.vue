<script setup lang="ts">
import { BaseButton, BasePanel } from '@renderer/components/base'
import { SettingsArrayField } from '@renderer/views/settings/components/form'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import { Boxes, Save } from 'lucide-vue-next'
import { computed } from 'vue'

const agentSettings = useAgentSettingsStore()

const resourceStats = computed(() => {
  const resources = agentSettings.draft?.resources
  if (!resources) {
    return []
  }
  return [
    { label: '技能', value: resources.skills.length },
    { label: '提示词', value: resources.prompts.length }
  ]
})
</script>

<template>
  <div class="agent-page">
    <header class="agent-page__header">
      <div>
        <p class="agent-page__eyebrow">资源</p>
        <h1 class="agent-page__title">资源路径</h1>
        <p class="agent-page__subtitle">只保存技能和提示词；包来源已移动到扩展设置。</p>
      </div>
      <BaseButton
        size="sm"
        variant="primary"
        :disabled="!agentSettings.canSave"
        @click="agentSettings.saveResources"
      >
        <template #icon><Save :size="14" /></template>
        保存资源路径
      </BaseButton>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="资源概览" eyebrow="发现">
      <div class="resource-summary">
        <Boxes :size="16" />
        <div>
          <strong>包来源在扩展设置中管理</strong>
          <span>桌面端按 Pi-compatible settings.json 与项目信任状态加载资源。</span>
        </div>
      </div>
      <div class="resource-stats" aria-label="资源路径统计">
        <div v-for="item in resourceStats" :key="item.label">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </div>
      </div>
    </BasePanel>

    <BasePanel v-if="agentSettings.draft" title="资源路径" eyebrow="资源">
      <div class="resource-grid">
        <SettingsArrayField
          v-model="agentSettings.draft.resources.skills"
          label="技能"
          description="每个技能目录单独一项。"
          placeholder="例如 /path/to/skill"
          select-title="选择技能目录"
          path-actions
        />
        <SettingsArrayField
          v-model="agentSettings.draft.resources.prompts"
          label="提示词"
          description="每个提示词资源路径单独一项。"
          placeholder="例如 /path/to/prompts"
          select-title="选择提示词路径"
          path-actions
          path-mode="any"
        />
      </div>
    </BasePanel>
  </div>
</template>

<style lang="scss" scoped>
.resource-summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-3);
  align-items: center;
  min-width: 0;
  padding: var(--space-3);
  color: var(--color-text-muted);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);

  svg {
    color: var(--color-primary);
  }

  div {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: var(--color-text);
    font-size: var(--font-size-ui-sm);
    font-weight: 700;
  }

  span {
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-xs);
  }
}

.resource-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.resource-stats div {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: var(--space-2);
  background: var(--color-surface);
  border: 1px solid var(--color-border-muted);
  border-radius: var(--radius-md);

  span,
  strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-2xs);
    font-weight: 650;
  }

  strong {
    color: var(--color-text);
    font-size: var(--font-size-ui-lg);
    line-height: 1.1;
  }
}

@media (width <= 720px) {
  .resource-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
