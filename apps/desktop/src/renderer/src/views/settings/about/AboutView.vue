<script setup lang="ts">
import BaseButton from '@/components/base/BaseButton.vue'
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'
import { useUpdater } from '@/composables/useUpdater'
import appIconUrl from '../../../../../../resources/icon.png'
import {
  Bot,
  Braces,
  Download,
  GitBranch,
  MessagesSquare,
  RefreshCw,
  RotateCcw
} from 'lucide-vue-next'
import { computed } from 'vue'

const updater = useUpdater()
const statusText = computed(() => {
  switch (updater.state.value.status) {
    case 'checking':
      return '正在检查更新...'
    case 'available':
      return `发现新版本 ${updater.state.value.availableVersion}`
    case 'downloading':
      return `正在下载 ${Math.round(updater.state.value.percent ?? 0)}%`
    case 'ready':
      return `版本 ${updater.state.value.availableVersion} 已准备就绪`
    case 'up-to-date':
      return '当前已是最新版本'
    case 'error':
      return updater.state.value.error ?? '更新检查失败'
    case 'unsupported':
      return '开发环境不执行自动更新'
    default:
      return '可通过 GitHub Releases 检查新版本'
  }
})

const capabilities = [
  {
    icon: MessagesSquare,
    title: '任务协作',
    description: '通过桌面会话承载需求沟通、执行状态、结果反馈与用户确认。'
  },
  {
    icon: Bot,
    title: '智能体运行时',
    description: '负责理解代码任务、规划步骤、调用工具并持续推进执行循环。'
  },
  {
    icon: GitBranch,
    title: '工作区集成',
    description: '连接本地仓库、终端、文件系统、Git 与常用开发工具链。'
  },
  {
    icon: Braces,
    title: '模型与上下文',
    description: '封装模型调用、上下文组装、提示策略与多模型适配能力。'
  }
]
</script>

<template>
  <ScrollArea class="about-page-scroll">
    <div class="about-page">
      <header class="about-page__header">
        <img class="about-page__mark" :src="appIconUrl" alt="Meta Agent 应用图标" />
        <div>
          <h1>Meta Agent</h1>
          <p>面向代码任务的桌面端智能体工作台</p>
        </div>
      </header>

      <section class="about-page__intro" aria-labelledby="about-intro-title">
        <h2 id="about-intro-title">关于项目</h2>
        <p>
          Meta Agent 是一个 AI Coding Agent GUI
          项目，专注于为代码任务提供清晰、可控的桌面协作体验。它将智能体执行、代码变更预览和开发工作区整合在同一环境中，让用户能够持续了解任务进展并参与关键决策。
        </p>
        <p>
          项目基于 Electron 构建桌面应用，并通过 pnpm workspace 组织界面、Agent Runtime、AI
          能力封装等模块。智能体设计参考
          Pi，重点关注任务规划、工具调用、上下文管理、执行反馈和人机协作。
        </p>
      </section>

      <section class="about-page__update" aria-labelledby="about-update-title">
        <div class="about-page__section-heading">
          <div>
            <h2 id="about-update-title">软件更新</h2>
            <p>当前版本 {{ updater.state.value.currentVersion || '未知' }}</p>
          </div>
          <BaseButton
            v-if="updater.state.value.status === 'available'"
            size="sm"
            variant="primary"
            @click="updater.download"
          >
            <template #icon><Download :size="14" /></template>
            下载更新
          </BaseButton>
          <BaseButton
            v-else-if="updater.state.value.status === 'ready'"
            size="sm"
            variant="primary"
            @click="updater.install"
          >
            <template #icon><RotateCcw :size="14" /></template>
            重启并安装
          </BaseButton>
          <BaseButton
            v-else
            size="sm"
            :disabled="updater.isBusy.value || updater.state.value.status === 'unsupported'"
            @click="updater.check"
          >
            <template #icon><RefreshCw :size="14" /></template>
            检查更新
          </BaseButton>
        </div>
        <div
          class="about-page__update-status"
          :class="{ 'is-error': updater.state.value.status === 'error' }"
        >
          <span>{{ statusText }}</span>
          <progress
            v-if="updater.state.value.status === 'downloading'"
            :value="updater.state.value.percent ?? 0"
            max="100"
          />
        </div>
        <ScrollArea
          v-if="updater.state.value.releaseNotes"
          class="about-page__release-notes"
          scrollbars="vertical"
          :vertical-size="6"
        >
          <p class="about-page__release-notes-text">
            {{ updater.state.value.releaseNotes }}
          </p>
        </ScrollArea>
      </section>

      <section class="about-page__capabilities" aria-labelledby="about-capabilities-title">
        <h2 id="about-capabilities-title">核心能力</h2>
        <ul>
          <li v-for="capability in capabilities" :key="capability.title">
            <component :is="capability.icon" :size="17" aria-hidden="true" />
            <div>
              <strong>{{ capability.title }}</strong>
              <span>{{ capability.description }}</span>
            </div>
          </li>
        </ul>
      </section>

      <footer class="about-page__footer">
        <span>Meta Agent Desktop</span>
        <span>Electron · Vue · TypeScript</span>
      </footer>
    </div>
  </ScrollArea>
</template>

<style lang="scss" scoped>
.about-page-scroll {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.about-page-scroll :deep([data-slot='scroll-area-viewport']) {
  height: 100%;
}

.about-page {
  box-sizing: border-box;
  width: 100%;
  max-width: var(--settings-page-max-width);
  min-width: 0;
  margin: 0 auto;
  padding: 48px 36px 56px;
}

.about-page__header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding-bottom: 32px;
  border-bottom: 1px solid var(--color-border-muted);

  h1,
  p {
    margin: 0;
  }

  h1 {
    color: var(--color-text);
    font-size: var(--font-size-ui-xl);
    font-weight: 700;
    line-height: 1.3;
  }

  p {
    margin-top: var(--space-1);
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-sm);
    line-height: 1.5;
  }
}

.about-page__mark {
  display: block;
  flex: 0 0 auto;
  width: 52px;
  height: 52px;
  object-fit: cover;
  border: 1px solid var(--color-border-muted);
  border-radius: var(--radius-lg);
}

.about-page__intro,
.about-page__update,
.about-page__capabilities {
  padding-top: 32px;

  h2 {
    margin: 0 0 var(--space-3);
    color: var(--color-text);
    font-size: var(--font-size-ui-md);
    font-weight: 650;
    line-height: 1.4;
  }
}

.about-page__section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);

  h2,
  p {
    margin: 0;
  }

  p {
    margin-top: 2px;
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-xs);
  }
}

.about-page__update-status {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding: var(--space-3);
  color: var(--color-text-muted);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-ui-sm);

  &.is-error {
    color: var(--color-danger);
    border-color: var(--color-danger-outline);
  }

  progress {
    width: 100%;
    height: 4px;
    accent-color: var(--color-primary);
  }
}

.about-page__release-notes {
  max-height: 120px;
  margin: var(--space-3) 0 0;
}

.about-page__release-notes :deep([data-slot='scroll-area-viewport']) {
  max-height: inherit;
}

.about-page__release-notes-text {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);
  line-height: 1.6;
  white-space: pre-wrap;
}

.about-page__intro p {
  max-width: 680px;
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-sm);
  line-height: 1.75;

  + p {
    margin-top: var(--space-3);
  }
}

.about-page__capabilities ul {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 var(--space-5);
  padding: 0;
  margin: 0;
  list-style: none;
  border-top: 1px solid var(--color-border-muted);
}

.about-page__capabilities li {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-4) 0;
  border-bottom: 1px solid var(--color-border-muted);

  svg {
    margin-top: 2px;
    color: var(--color-text-subtle);
  }

  strong,
  span {
    display: block;
  }

  strong {
    color: var(--color-text);
    font-size: var(--font-size-ui-sm);
    font-weight: 650;
  }

  span {
    margin-top: 3px;
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-xs);
    line-height: 1.55;
  }
}

.about-page__footer {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: 36px;
  color: var(--color-text-subtle);
  font-size: var(--font-size-ui-xs);
}

@media (width <= 720px) {
  .about-page {
    padding: 32px var(--space-4) 40px;
  }

  .about-page__section-heading {
    align-items: stretch;
    flex-direction: column;
  }

  .about-page__section-heading :deep(.base-button) {
    align-self: flex-end;
  }

  .about-page__capabilities ul {
    grid-template-columns: minmax(0, 1fr);
  }

  .about-page__footer {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
