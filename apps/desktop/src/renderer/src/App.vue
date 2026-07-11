<script setup lang="ts">
import ConfirmDialogProvider from './components/confirm/ConfirmDialogProvider.vue'
import TitleBar from './components/title-bar/TitleBar.vue'
import ToastProvider from './components/toast/ToastProvider.vue'
import { useAppearanceSettings } from './composables/useAppearanceSettings'
import { useTheme } from './composables/useTheme'

useTheme()
useAppearanceSettings()
</script>

<template>
  <ConfirmDialogProvider>
    <div class="app-shell">
      <TitleBar />
      <div class="app-shell__content">
        <RouterView />
      </div>
      <ToastProvider />
    </div>
  </ConfirmDialogProvider>
</template>

<style lang="scss">
#app {
  isolation: isolate;
}

.app-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
}

.app-shell__content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  background: transparent;
}
</style>
