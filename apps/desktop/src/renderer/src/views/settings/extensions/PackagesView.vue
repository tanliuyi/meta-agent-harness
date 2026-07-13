<script setup lang="ts">
import { BaseBadge, BaseButton, BaseField, BasePanel } from '@renderer/components/base'
import { confirm } from '@renderer/composables/useConfirmDialog'
import useAgentSettingsStore, {
  type ResourcePackageProgressState
} from '@renderer/stores/agent-settings'
import useWorkspaceProjectStore from '@renderer/stores/workspace-project'
import type { ResourcePackageSummary } from '@shared/coding-agent/types'
import { PackagePlus, RefreshCw, Trash2 } from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'

const agentSettings = useAgentSettingsStore()
const workspaceProject = useWorkspaceProjectStore()
const packageDraft = ref({
  source: '',
  local: false
})
const refreshSpinKey = ref(0)
const addingPackageSource = ref(false)
const removingPackageSource = ref<string>()
const activeProjectId = computed(() => workspaceProject.activeProjectId)
const canUseProjectScope = computed(() => {
  const state = workspaceProject.activeProject?.trust?.state
  return Boolean(activeProjectId.value) && (state === 'trusted' || state === 'notRequired')
})

const packageRows = computed(() => agentSettings.resourcePackages)
const normalizedPackageSource = computed(() => packageDraft.value.source.trim())
const packageAlreadyConfigured = computed(() =>
  packageRows.value.some(
    (item) =>
      item.source === normalizedPackageSource.value &&
      item.scope === (packageDraft.value.local ? 'project' : 'user')
  )
)
const canAddPackageSource = computed(
  () =>
    Boolean(normalizedPackageSource.value) &&
    (!packageDraft.value.local || canUseProjectScope.value) &&
    !packageAlreadyConfigured.value &&
    !agentSettings.resourcePackagesLoading &&
    !addingPackageSource.value
)
const installedPackageCount = computed(
  () => packageRows.value.filter((item) => Boolean(item.installedPath)).length
)
const packageSummaryLabel = computed(() => {
  if (packageRows.value.length === 0) return '未配置包来源'
  return `已安装 ${installedPackageCount.value}/${packageRows.value.length} 个包来源`
})

onMounted(() => {
  void loadPackagesForActiveProject()
})

watch(activeProjectId, () => {
  if (!canUseProjectScope.value) packageDraft.value.local = false
  void loadPackagesForActiveProject()
})

function loadPackagesForActiveProject(): Promise<void> {
  return agentSettings.loadResourcePackages(
    activeProjectId.value ? { projectId: activeProjectId.value } : {}
  )
}

async function refreshResourcePackages(): Promise<void> {
  refreshSpinKey.value += 1
  await loadPackagesForActiveProject()
}

async function addPackageSource(): Promise<void> {
  const source = normalizedPackageSource.value
  if (!canAddPackageSource.value) return
  addingPackageSource.value = true
  try {
    await agentSettings.addResourcePackage({
      source,
      ...(packageDraft.value.local ? { projectId: activeProjectId.value } : {})
    })
    if (!agentSettings.error) {
      packageDraft.value.source = ''
    }
  } finally {
    addingPackageSource.value = false
  }
}

function getPackageProgress(source: string): ResourcePackageProgressState | undefined {
  return agentSettings.resourcePackageProgress[source]
}

function getPackageScopeLabel(scope: string): string {
  return (
    {
      project: '项目',
      user: '用户'
    }[scope] ?? scope
  )
}

function getPackageActionLabel(source: string): string | undefined {
  const progress = getPackageProgress(source)
  if (!progress?.running) return undefined
  return progress.action === 'install' ? '安装中…' : '更新中…'
}

async function removePackageSource(item: ResourcePackageSummary): Promise<void> {
  const projectId = item.scope === 'project' ? activeProjectId.value : undefined
  if (item.scope === 'project' && !projectId) return
  const result = await confirm({
    cancelText: '取消',
    confirmText: '移除',
    description: `将从${getPackageScopeLabel(item.scope)}设置中移除 ${item.source}，已安装文件不会自动删除。`,
    id: `remove-package-${item.scope}-${item.source}`,
    title: '移除这个包来源？',
    tone: 'destructive'
  })
  if (!result.confirmed) return
  if (projectId && projectId !== activeProjectId.value) return

  removingPackageSource.value = item.source
  try {
    await agentSettings.removeResourcePackage({
      source: item.source,
      ...(projectId ? { projectId } : {})
    })
  } finally {
    removingPackageSource.value = undefined
  }
}
</script>

<template>
  <div class="extensions-page">
    <header class="extensions-page__header">
      <div>
        <p class="extensions-page__eyebrow">来源</p>
        <h1 class="extensions-page__title">包来源</h1>
        <p class="extensions-page__subtitle">包来源可以提供扩展、技能、提示词或主题。</p>
      </div>
    </header>

    <div v-if="agentSettings.error" class="state-strip is-error">{{ agentSettings.error }}</div>

    <BasePanel title="包来源管理" eyebrow="Pi 包管理">
      <template #actions>
        <BaseButton
          size="sm"
          variant="ghost"
          :disabled="agentSettings.resourcePackagesLoading"
          @click="refreshResourcePackages"
        >
          <template #icon>
            <RefreshCw :key="refreshSpinKey" class="refresh-spin-icon" :size="14" />
          </template>
          刷新
        </BaseButton>
      </template>

      <form class="package-manager-form" @submit.prevent="addPackageSource">
        <div class="package-manager-form__field">
          <BaseField
            id="extension-package-source"
            v-model="packageDraft.source"
            label="包来源"
            placeholder="npm:@scope/package、Git URL 或 /path/to/package"
            :disabled="agentSettings.resourcePackagesLoading || addingPackageSource"
          />
          <p :class="{ 'is-warning': packageAlreadyConfigured }">
            {{
              packageAlreadyConfigured
                ? '该包来源已存在于当前作用域。'
                : '支持 npm 包、Git URL 和本地路径。按 Enter 可直接添加。'
            }}
          </p>
        </div>
        <div class="package-manager-form__actions">
          <label class="package-scope-toggle">
            <input
              v-model="packageDraft.local"
              type="checkbox"
              :disabled="
                !canUseProjectScope || agentSettings.resourcePackagesLoading || addingPackageSource
              "
            />
            <span>项目本地</span>
          </label>
          <BaseButton size="sm" variant="primary" type="submit" :disabled="!canAddPackageSource">
            <template #icon><PackagePlus :size="14" /></template>
            {{ addingPackageSource ? '添加中…' : '添加' }}
          </BaseButton>
        </div>
      </form>

      <div class="package-toolbar">
        <span>{{ packageSummaryLabel }}</span>
      </div>

      <div
        v-if="agentSettings.resourcePackagesLoading && packageRows.length === 0"
        class="empty-state"
      >
        <strong>正在加载包来源</strong>
      </div>
      <div v-else-if="packageRows.length === 0" class="empty-state">
        <strong>暂无包来源</strong>
        <span>添加 npm、Git 或本地包后，扩展能力会按 Pi 规则解析。</span>
      </div>
      <ul v-else class="package-list">
        <li v-for="item in packageRows" :key="`${item.scope}:${item.source}`">
          <div class="package-list__copy">
            <div class="package-list__heading">
              <strong>{{ item.source }}</strong>
              <BaseBadge :tone="item.scope === 'project' ? 'info' : 'neutral'">
                {{ getPackageScopeLabel(item.scope) }}
              </BaseBadge>
              <BaseBadge v-if="item.filtered" tone="warning">已过滤</BaseBadge>
            </div>
            <span v-if="item.installedPath" :title="item.installedPath">
              已安装于 {{ item.installedPath }}
            </span>
            <span v-else>尚未安装</span>
            <small
              v-if="getPackageProgress(item.source)"
              :class="{ 'is-error': getPackageProgress(item.source)?.error }"
            >
              {{
                getPackageProgress(item.source)?.error ?? getPackageProgress(item.source)?.message
              }}
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
                  ...(item.scope === 'project' ? { projectId: activeProjectId } : {})
                })
              "
            >
              {{ getPackageActionLabel(item.source) ?? '安装' }}
            </BaseButton>
            <BaseButton
              size="sm"
              variant="ghost"
              :disabled="agentSettings.resourcePackagesLoading"
              @click="
                agentSettings.updateResourcePackage({
                  source: item.source,
                  ...(item.scope === 'project' ? { projectId: activeProjectId } : {})
                })
              "
            >
              <template #icon><RefreshCw :size="14" /></template>
              {{ getPackageActionLabel(item.source) ?? '更新' }}
            </BaseButton>
            <BaseButton
              size="sm"
              variant="ghost"
              :disabled="agentSettings.resourcePackagesLoading"
              @click="removePackageSource(item)"
            >
              <template #icon><Trash2 :size="14" /></template>
              {{ removingPackageSource === item.source ? '移除中…' : '移除' }}
            </BaseButton>
          </div>
        </li>
      </ul>
    </BasePanel>
  </div>
</template>
