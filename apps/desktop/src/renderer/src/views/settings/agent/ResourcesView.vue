<script setup lang="ts">
import { BaseButton, BasePanel } from '@renderer/components/base'
import BaseField from '@renderer/components/base/BaseField.vue'
import { SettingsArrayField } from '@renderer/views/settings/components/form'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import { Boxes, PackagePlus, RefreshCw, Save, Trash2 } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'

const agentSettings = useAgentSettingsStore()
const packageDraft = ref({
  source: '',
  local: false
})

const packageRows = computed(() => agentSettings.resourcePackages)
const extensionRows = computed(() => agentSettings.discoveredExtensions)
const extensionPathRows = computed(() => agentSettings.resolvedExtensionPaths)
const resourceSnapshot = computed(() => agentSettings.resourceSnapshot)
const resourceStats = computed(() => {
  const resources = agentSettings.draft?.resources
  if (!resources) {
    return []
  }
  return [
    { label: 'Packages', value: resources.packages.length },
    { label: 'Extensions', value: resources.extensions.length },
    { label: 'Skills', value: resources.skills.length },
    { label: 'Prompts', value: resources.prompts.length },
    { label: 'Themes', value: resources.themes.length }
  ]
})
const discoveredStats = computed(() => {
  const resources = resourceSnapshot.value?.resources
  return [
    { label: 'Loaded extensions', value: extensionRows.value.length },
    { label: 'Resolved extension paths', value: resources?.extensions.length ?? 0 },
    { label: 'Diagnostics', value: agentSettings.resourceDiagnostics.length }
  ]
})
const installedPackageCount = computed(
  () => packageRows.value.filter((item) => Boolean(item.installedPath)).length
)
const packageSummaryLabel = computed(() => {
  if (packageRows.value.length === 0) return '未配置 package source'
  return `${installedPackageCount.value}/${packageRows.value.length} installed package sources`
})

onMounted(() => {
  void agentSettings.loadResourcePackages()
  void agentSettings.loadResourceSnapshot()
})

async function addPackageSource(): Promise<void> {
  const source = packageDraft.value.source.trim()
  if (!source) return
  await agentSettings.addResourcePackage({
    source,
    local: packageDraft.value.local
  })
  packageDraft.value.source = ''
}

function getPackageProgress(source: string) {
  return agentSettings.resourcePackageProgress[source]
}

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
  <div class="agent-page">
    <header class="agent-page__header">
      <div>
        <p class="agent-page__eyebrow">Resources</p>
        <h1 class="agent-page__title">资源路径</h1>
        <p class="agent-page__subtitle">只保存 packages、extensions、skills、prompts 和 themes。</p>
      </div>
      <BaseButton size="sm" variant="primary" :disabled="!agentSettings.canSave" @click="agentSettings.saveResources">
        <template #icon><Save :size="14" /></template>
        保存资源路径
      </BaseButton>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel v-if="agentSettings.draft" title="资源概览" eyebrow="Discovery">
      <div class="resource-summary">
        <Boxes :size="16" />
        <div>
          <strong>{{ packageSummaryLabel }}</strong>
          <span>Desktop 按 Pi-compatible settings.json 与 Project trust 加载资源。</span>
        </div>
      </div>
      <div class="resource-stats" aria-label="资源路径统计">
        <div v-for="item in resourceStats" :key="item.label">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </div>
      </div>
    </BasePanel>

    <BasePanel v-if="agentSettings.draft" title="资源路径" eyebrow="Resources">
      <div class="resource-grid">
        <SettingsArrayField
          v-model="agentSettings.draft.resources.packages"
          label="包 Packages"
          description="npm、git 或本地 package source。"
          placeholder="例如 @scope/package 或 /path/to/package"
          select-title="选择 package 目录"
          path-actions
          path-mode="any"
        />
        <SettingsArrayField
          v-model="agentSettings.draft.resources.extensions"
          label="扩展 Extensions"
          description="每个 extension 单独一项。"
          placeholder="例如 /path/to/extension"
          select-title="选择 extension 目录"
          path-actions
        />
        <SettingsArrayField
          v-model="agentSettings.draft.resources.skills"
          label="技能 Skills"
          description="每个 skill 目录单独一项。"
          placeholder="例如 /path/to/skill"
          select-title="选择 skill 目录"
          path-actions
        />
        <SettingsArrayField
          v-model="agentSettings.draft.resources.prompts"
          label="提示词 Prompts"
          description="每个 prompt 资源路径单独一项。"
          placeholder="例如 /path/to/prompts"
          select-title="选择 prompt 路径"
          path-actions
          path-mode="any"
        />
        <SettingsArrayField
          v-model="agentSettings.draft.resources.themes"
          label="主题 Themes"
          description="每个 theme 路径单独一项。"
          placeholder="例如 /path/to/themes"
          select-title="选择 theme 路径"
          path-actions
          path-mode="any"
        />
      </div>
    </BasePanel>

    <BasePanel title="已发现扩展" eyebrow="Extensions">
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
        <li v-for="diagnostic in agentSettings.resourceDiagnostics" :key="`${diagnostic.path}:${diagnostic.message}`">
          <strong>{{ diagnostic.type }}</strong>
          <span>{{ diagnostic.message }}</span>
          <small v-if="diagnostic.path">{{ diagnostic.path }}</small>
        </li>
      </ul>
    </BasePanel>

    <BasePanel title="Package 管理" eyebrow="Pi package manager">
      <div class="package-manager-form">
        <BaseField
          id="resource-package-source"
          v-model="packageDraft.source"
          label="Package source"
          placeholder="npm:@scope/package、git URL 或 /path/to/package"
          hint="新增后写入 Pi-compatible settings.json packages。"
        />
        <label class="package-scope-toggle">
          <input v-model="packageDraft.local" type="checkbox" />
          <span>Project local</span>
        </label>
        <BaseButton
          size="sm"
          variant="primary"
          :disabled="agentSettings.resourcePackagesLoading || !packageDraft.source.trim()"
          @click="addPackageSource"
        >
          <template #icon><PackagePlus :size="14" /></template>
          Add
        </BaseButton>
      </div>

      <div class="package-toolbar">
        <span>{{ packageRows.length }} configured package sources</span>
        <BaseButton
          size="sm"
          variant="ghost"
          :disabled="agentSettings.resourcePackagesLoading"
          @click="agentSettings.loadResourcePackages"
        >
          <template #icon><RefreshCw :size="14" /></template>
          Refresh
        </BaseButton>
      </div>

      <div v-if="agentSettings.resourcePackagesLoading" class="empty-state">
        <strong>正在加载 packages</strong>
      </div>
      <div v-else-if="packageRows.length === 0" class="empty-state">
        <strong>暂无 package source</strong>
        <span>添加 npm、git 或本地 package 后，extensions / skills / prompts 会按 Pi 规则解析。</span>
      </div>
      <ul v-else class="package-list">
        <li v-for="item in packageRows" :key="`${item.scope}:${item.source}`">
          <div class="package-list__copy">
            <strong>{{ item.source }}</strong>
            <span>
              {{ item.scope }}
              <template v-if="item.filtered"> · filtered</template>
              <template v-if="item.installedPath"> · {{ item.installedPath }}</template>
              <template v-else> · not installed</template>
            </span>
            <small v-if="getPackageProgress(item.source)" :class="{ 'is-error': getPackageProgress(item.source)?.error }">
              {{ getPackageProgress(item.source)?.error ?? getPackageProgress(item.source)?.message }}
            </small>
          </div>
          <div class="package-list__actions">
            <BaseButton
              v-if="!item.installedPath"
              size="sm"
              variant="ghost"
              :disabled="agentSettings.resourcePackagesLoading"
              @click="
                agentSettings.installResourcePackage({
                  source: item.source,
                  local: item.scope === 'project'
                })
              "
            >
              Install
            </BaseButton>
            <BaseButton
              size="sm"
              variant="ghost"
              :disabled="agentSettings.resourcePackagesLoading"
              @click="agentSettings.updateResourcePackage({ source: item.source })"
            >
              Update
            </BaseButton>
            <BaseButton
              size="sm"
              variant="ghost"
              :disabled="agentSettings.resourcePackagesLoading"
              @click="
                agentSettings.removeResourcePackage({
                  source: item.source,
                  local: item.scope === 'project'
                })
              "
            >
              <template #icon><Trash2 :size="14" /></template>
              Remove
            </BaseButton>
          </div>
        </li>
      </ul>
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
  grid-template-columns: repeat(5, minmax(0, 1fr));
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

.package-manager-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: var(--space-2);
  align-items: end;
  min-width: 0;
}

.package-scope-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--field-control-height);
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);
  font-weight: 650;
  white-space: nowrap;
}

.package-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-top: var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);
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
  text-transform: uppercase;
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

.package-list {
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

.package-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
  padding: var(--space-3);
  background: var(--color-surface);
}

.package-list__copy {
  min-width: 0;
}

.package-list__copy strong,
.package-list__copy span,
.package-list__copy small {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.package-list__copy strong {
  color: var(--color-text);
  font-size: var(--font-size-ui-sm);
}

.package-list__copy span {
  margin-top: 2px;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);
}

.package-list__copy small {
  margin-top: 2px;
  color: var(--color-text-subtle);
  font-size: var(--font-size-ui-2xs);

  &.is-error {
    color: var(--color-accent);
  }
}

.package-list__actions {
  display: flex;
  gap: var(--space-1);
}

@media (width <= 720px) {
  .resource-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .package-manager-form,
  .package-list li,
  .extension-paths li {
    grid-template-columns: 1fr;
  }

  .extension-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .package-list__actions {
    justify-content: flex-start;
  }
}
</style>
