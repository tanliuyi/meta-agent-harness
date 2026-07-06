<script setup lang="ts">
import { BaseButton, BaseField, BasePanel } from '@renderer/components/base'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import { PackagePlus, RefreshCw, Trash2 } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'

const agentSettings = useAgentSettingsStore()
const packageDraft = ref({
  source: '',
  local: false
})
const refreshSpinKey = ref(0)

const packageRows = computed(() => agentSettings.resourcePackages)
const installedPackageCount = computed(
  () => packageRows.value.filter((item) => Boolean(item.installedPath)).length
)
const packageSummaryLabel = computed(() => {
  if (packageRows.value.length === 0) return '未配置包来源'
  return `已安装 ${installedPackageCount.value}/${packageRows.value.length} 个包来源`
})

onMounted(() => {
  void agentSettings.loadResourcePackages()
})

async function refreshResourcePackages(): Promise<void> {
  refreshSpinKey.value += 1
  await agentSettings.loadResourcePackages()
}

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

function getPackageScopeLabel(scope: string): string {
  return (
    {
      project: '项目',
      user: '用户'
    }[scope] ?? scope
  )
}
</script>

<template>
  <div class="extensions-page">
    <header class="extensions-page__header">
      <div>
        <p class="extensions-page__eyebrow">来源</p>
        <h1 class="extensions-page__title">包来源</h1>
        <p class="extensions-page__subtitle">
          包来源可以提供扩展、技能、提示词或主题。
        </p>
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

      <div class="package-manager-form">
        <div class="package-manager-form__field">
          <BaseField
            id="extension-package-source"
            v-model="packageDraft.source"
            label="包来源"
            placeholder="npm:@scope/package、Git URL 或 /path/to/package"
          />
          <p>新增后会写入 Pi-compatible settings.json 的 packages 配置。</p>
        </div>
        <div class="package-manager-form__actions">
          <label class="package-scope-toggle">
            <input v-model="packageDraft.local" type="checkbox" />
            <span>项目本地</span>
          </label>
          <BaseButton
            size="sm"
            variant="primary"
            :disabled="agentSettings.resourcePackagesLoading || !packageDraft.source.trim()"
            @click="addPackageSource"
          >
            <template #icon><PackagePlus :size="14" /></template>
            添加
          </BaseButton>
        </div>
      </div>

      <div class="package-toolbar">
        <span>{{ packageSummaryLabel }}</span>
      </div>

      <div v-if="agentSettings.resourcePackagesLoading" class="empty-state">
        <strong>正在加载包来源</strong>
      </div>
      <div v-else-if="packageRows.length === 0" class="empty-state">
        <strong>暂无包来源</strong>
        <span>添加 npm、Git 或本地包后，扩展能力会按 Pi 规则解析。</span>
      </div>
      <ul v-else class="package-list">
        <li v-for="item in packageRows" :key="`${item.scope}:${item.source}`">
          <div class="package-list__copy">
            <strong>{{ item.source }}</strong>
            <span>
              {{ getPackageScopeLabel(item.scope) }}
              <template v-if="item.filtered"> · 已过滤</template>
              <template v-if="item.installedPath"> · 已安装：{{ item.installedPath }}</template>
              <template v-else> · 未安装</template>
            </span>
            <small
              v-if="getPackageProgress(item.source)"
              :class="{ 'is-error': getPackageProgress(item.source)?.error }"
            >
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
              安装
            </BaseButton>
            <BaseButton
              size="sm"
              variant="ghost"
              :disabled="agentSettings.resourcePackagesLoading"
              @click="agentSettings.updateResourcePackage({ source: item.source })"
            >
              更新
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
              移除
            </BaseButton>
          </div>
        </li>
      </ul>
    </BasePanel>
  </div>
</template>
