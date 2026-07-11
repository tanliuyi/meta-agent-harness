<script setup lang="ts">
import BaseButton from '@/components/base/BaseButton.vue'
import { Download, RotateCcw } from 'lucide-vue-next'
import { computed } from 'vue'
import { useUpdater } from '@/composables/useUpdater'

const updater = useUpdater()
const visible = computed(() =>
  ['available', 'downloading', 'ready'].includes(updater.state.value.status)
)
const progress = computed(() => Math.max(0, Math.min(100, updater.state.value.percent ?? 0)))
</script>

<template>
  <aside v-if="visible" class="update-banner" aria-live="polite">
    <div class="update-banner__copy">
      <strong v-if="updater.state.value.status === 'available'">
        Meta Agent {{ updater.state.value.availableVersion }} 可用
      </strong>
      <strong v-else-if="updater.state.value.status === 'downloading'">
        正在下载更新 {{ progress.toFixed(0) }}%
      </strong>
      <strong v-else>更新已就绪</strong>
      <span v-if="updater.state.value.status === 'ready'">重启应用以完成安装</span>
      <span v-else-if="updater.state.value.status === 'available'"
        >可在后台下载，当前工作不会中断</span
      >
    </div>

    <progress
      v-if="updater.state.value.status === 'downloading'"
      class="update-banner__progress"
      :value="progress"
      max="100"
    />

    <BaseButton
      v-if="updater.state.value.status === 'available'"
      size="sm"
      variant="primary"
      @click="updater.download"
    >
      <template #icon><Download :size="14" /></template>
      下载
    </BaseButton>
    <BaseButton
      v-else-if="updater.state.value.status === 'ready'"
      size="sm"
      variant="primary"
      @click="updater.install"
    >
      <template #icon><RotateCcw :size="14" /></template>
      重启更新
    </BaseButton>
  </aside>
</template>

<style lang="scss" scoped>
.update-banner {
  position: fixed;
  right: var(--space-4);
  bottom: var(--space-4);
  z-index: 45;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: center;
  width: min(380px, calc(100vw - 24px));
  min-height: 56px;
  padding: var(--space-3) var(--space-4);
  color: var(--color-text);
  background: color-mix(in srgb, var(--color-surface) 96%, transparent);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(16px);
}

.update-banner__copy {
  min-width: 0;

  strong,
  span {
    display: block;
  }

  strong {
    font-size: var(--font-size-ui-sm);
    font-weight: 650;
  }

  span {
    margin-top: 2px;
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-xs);
  }
}

.update-banner__progress {
  grid-column: 1 / -1;
  width: 100%;
  height: 4px;
  accent-color: var(--color-primary);
}

@media (width <= 520px) {
  .update-banner {
    right: var(--space-3);
    bottom: var(--space-3);
    grid-template-columns: minmax(0, 1fr);
  }

  .update-banner :deep(.base-button) {
    justify-self: end;
  }
}
</style>
