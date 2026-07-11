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
    <strong v-if="updater.state.value.status === 'available'">
      新版本 {{ updater.state.value.availableVersion }}
    </strong>
    <strong v-else-if="updater.state.value.status === 'downloading'">
      下载中 {{ progress.toFixed(0) }}%
    </strong>
    <strong v-else>{{ updater.state.value.availableVersion }} 已就绪</strong>

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
      重启
    </BaseButton>
  </aside>
</template>

<style lang="scss" scoped>
.update-banner {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  height: 2.4em;
  margin: 0 var(--space-2) var(--space-2);
  padding: 0 var(--space-2) 0 var(--space-3);
  color: var(--color-text);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
}

.update-banner > strong {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: var(--font-size-ui-xs);
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.update-banner__progress {
  flex: 0 1 72px;
  width: 72px;
  height: 4px;
  accent-color: var(--color-primary);
}

.update-banner :deep(.base-button) {
  flex: 0 0 auto;
}
</style>
