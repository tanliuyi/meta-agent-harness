<script setup lang="ts">
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'
import { BaseButton, BasePanel } from '@renderer/components/base'
import { SettingsArrayField } from '@renderer/views/settings/components/form'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import { RefreshCw, Save } from 'lucide-vue-next'
import { computed, onMounted } from 'vue'

const agentSettings = useAgentSettingsStore()

const extensionRows = computed(() => agentSettings.discoveredExtensions)
const extensionPathRows = computed(() => agentSettings.resolvedExtensionPaths)
const resourceSnapshot = computed(() => agentSettings.resourceSnapshot)
const discoveredStats = computed(() => {
  const resources = resourceSnapshot.value?.resources
  return [
    { label: 'Loaded extensions', value: extensionRows.value.length },
    { label: 'Resolved extension paths', value: resources?.extensions.length ?? 0 },
    { label: 'Diagnostics', value: agentSettings.resourceDiagnostics.length }
  ]
})

onMounted(() => {
  if (!agentSettings.snapshot) {
    void agentSettings.load()
  }
  void agentSettings.loadResourceSnapshot()
})

function canToggleExtensionPath(path: (typeof extensionPathRows.value)[number]): boolean {
  return path.sourceInfo.origin === 'top-level'
}

function getExtensionPathMeta(path: (typeof extensionPathRows.value)[number]): string {
  return [path.sourceInfo.scope, path.sourceInfo.origin, path.sourceInfo.source].join(' · ')
}

function getExtensionMeta(extension: (typeof extensionRows.value)[number]): string {
  const counts = [
    getCountLabel(extension.commands.length, 'command'),
    getCountLabel(extension.tools.length, 'tool'),
    getCountLabel(extension.flags.length, 'flag')
  ].filter(Boolean)
  return [
    extension.sourceInfo.scope,
    extension.sourceInfo.origin,
    extension.sourceInfo.source,
    ...counts
  ].join(' · ')
}

function getCountLabel(count: number, label: string): string | undefined {
  if (count === 0) return undefined
  return `${count} ${label}${count === 1 ? '' : 's'}`
}
</script>

<template>
  <ScrollArea class="extensions-page-scroll">
    <div class="extensions-page">
      <header class="extensions-page__header">
        <div>
          <p class="extensions-page__eyebrow">Extensions</p>
          <h1 class="extensions-page__title">扩展</h1>
          <p class="extensions-page__subtitle">
            管理 extension 路径，并按 Pi core 规则查看当前已发现的扩展。
          </p>
        </div>
        <BaseButton
          size="sm"
          variant="primary"
          :disabled="!agentSettings.canSave"
          @click="agentSettings.saveResources"
        >
          <template #icon><Save :size="14" /></template>
          保存扩展路径
        </BaseButton>
      </header>

      <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

      <BasePanel v-if="agentSettings.draft" title="扩展路径" eyebrow="Paths">
        <SettingsArrayField
          v-model="agentSettings.draft.resources.extensions"
          label="扩展 Extensions"
          description="每个 extension 单独一项。"
          placeholder="例如 /path/to/extension"
          select-title="选择 extension 目录"
          path-actions
        />
      </BasePanel>

      <BasePanel title="已发现扩展" eyebrow="Discovery">
        <div class="extension-toolbar">
          <div class="extension-stats" aria-label="扩展发现统计">
            <span v-for="item in discoveredStats" :key="item.label">
              {{ item.label }}: <strong>{{ item.value }}</strong>
            </span>
          </div>
          <BaseButton size="sm" variant="ghost" @click="agentSettings.loadResourceSnapshot">
            <template #icon><RefreshCw :size="14" /></template>
            Refresh
          </BaseButton>
        </div>

        <div v-if="!resourceSnapshot" class="empty-state">
          <strong>尚未加载 resource snapshot</strong>
        </div>
        <div v-else-if="extensionRows.length === 0" class="empty-state">
          <strong>暂无已加载 extension</strong>
          <span>添加 package 或 extension 路径后，Desktop 会按 Pi core 规则发现。</span>
        </div>
        <ul v-else class="extension-list">
          <li v-for="extension in extensionRows" :key="extension.resolvedPath">
            <div class="extension-list__copy">
              <strong>{{ extension.path }}</strong>
              <span>{{ getExtensionMeta(extension) }}</span>
            </div>
            <div class="extension-list__chips" aria-label="extension capabilities">
              <span v-for="command in extension.commands" :key="`command:${command.name}`">
                /{{ command.name }}
              </span>
              <span v-for="tool in extension.tools" :key="`tool:${tool.name}`">
                tool: {{ tool.name }}
              </span>
              <span v-for="flag in extension.flags" :key="`flag:${flag.name}`">
                --{{ flag.name }}
              </span>
            </div>
          </li>
        </ul>

        <div v-if="extensionPathRows.length" class="extension-paths">
          <h3>Resolved extension paths</h3>
          <ul>
            <li v-for="path in extensionPathRows" :key="path.path">
              <div>
                <strong>{{ path.path }}</strong>
                <span>{{ getExtensionPathMeta(path) }}</span>
              </div>
              <BaseButton
                v-if="canToggleExtensionPath(path)"
                size="sm"
                variant="ghost"
                @click="agentSettings.setExtensionPathEnabled(path.path, !path.enabled)"
              >
                {{ path.enabled ? 'Disable' : 'Enable' }}
              </BaseButton>
              <span v-else class="extension-paths__state">
                {{ path.enabled ? 'Enabled' : 'Disabled' }}
              </span>
            </li>
          </ul>
        </div>

        <ul v-if="agentSettings.resourceDiagnostics.length" class="resource-diagnostics">
          <li
            v-for="diagnostic in agentSettings.resourceDiagnostics"
            :key="`${diagnostic.path}:${diagnostic.message}`"
          >
            <strong>{{ diagnostic.type }}</strong>
            <span>{{ diagnostic.message }}</span>
            <small v-if="diagnostic.path">{{ diagnostic.path }}</small>
          </li>
        </ul>
      </BasePanel>
    </div>
  </ScrollArea>
</template>

<style lang="scss" scoped>
.extensions-page-scroll {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.extension-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
}

.extension-stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-width: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);

  strong {
    color: var(--color-text);
  }
}

.extension-list,
.resource-diagnostics,
.extension-paths ul {
  display: grid;
  gap: 1px;
  padding: 0;
  margin: var(--space-3) 0 0;
  overflow: hidden;
  list-style: none;
  background: var(--color-border);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.extension-list li,
.resource-diagnostics li,
.extension-paths li {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-3);
  background: var(--color-surface);
}

.extension-list__copy {
  min-width: 0;
}

.extension-list__copy strong,
.extension-list__copy span,
.extension-paths strong,
.extension-paths span,
.resource-diagnostics strong,
.resource-diagnostics span,
.resource-diagnostics small {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.extension-list__copy strong {
  color: var(--color-text);
  font-size: var(--font-size-ui-sm);
}

.extension-list__copy span,
.extension-paths span,
.resource-diagnostics span,
.resource-diagnostics small {
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);
}

.extension-paths {
  margin-top: var(--space-3);

  h3 {
    margin: 0 0 var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-xs);
    font-weight: 700;
  }

  li {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  div {
    min-width: 0;
  }

  strong {
    color: var(--color-text);
    font-size: var(--font-size-ui-xs);
  }
}

.extension-paths__state {
  color: var(--color-text-subtle);
  font-size: var(--font-size-ui-2xs);
  font-weight: 700;
}

.resource-diagnostics strong {
  color: var(--color-accent);
  font-size: var(--font-size-ui-xs);
  text-transform: capitalize;
}

.extension-list__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  min-width: 0;

  span {
    max-width: 100%;
    padding: 2px 6px;
    overflow: hidden;
    color: var(--color-text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border-muted);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-ui-2xs);
    font-weight: 650;
  }
}

@media (width <= 720px) {
  .extension-paths li {
    grid-template-columns: 1fr;
  }

  .extension-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
