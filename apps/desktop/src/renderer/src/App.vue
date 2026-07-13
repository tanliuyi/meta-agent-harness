<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import ConfirmDialogProvider from './components/confirm/ConfirmDialogProvider.vue'
import BrowserPermissionRequestHost from './components/browser/BrowserPermissionRequestHost.vue'
import TitleBar from './components/title-bar/TitleBar.vue'
import ToastProvider from './components/toast/ToastProvider.vue'
import { useAppearanceSettings } from './composables/useAppearanceSettings'
import { useTheme } from './composables/useTheme'
import { resolveWorkspaceRouteHostState, WorkspaceRouteView } from './router/workspace-route-host'

useTheme()
useAppearanceSettings()

const route = useRoute()
const workspaceRouteState = ref(resolveWorkspaceRouteHostState(false, route.name))

watch(
  () => route.name,
  (routeName) => {
    workspaceRouteState.value = resolveWorkspaceRouteHostState(
      workspaceRouteState.value.workspaceMounted,
      routeName
    )
  },
  { flush: 'sync' }
)
</script>

<template>
  <ConfirmDialogProvider>
    <BrowserPermissionRequestHost />
    <div class="app-shell">
      <TitleBar />
      <div class="app-shell__content">
        <template v-if="workspaceRouteState.workspaceMounted">
          <div v-show="workspaceRouteState.workspaceVisible" class="app-shell__workspace-host">
            <WorkspaceRouteView />
          </div>
        </template>
        <RouterView v-if="workspaceRouteState.routerViewVisible" />
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

.app-shell__workspace-host {
  width: 100%;
  height: 100%;
  min-height: 0;
}
</style>
