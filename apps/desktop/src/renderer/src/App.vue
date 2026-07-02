<script setup lang="ts">
import ConfirmDialogProvider from './components/confirm/ConfirmDialogProvider.vue'
import { useTheme } from './composables/useTheme'

useTheme()
</script>

<template>
  <ConfirmDialogProvider>
    <RouterView />
  </ConfirmDialogProvider>
</template>

<style lang="scss">
#app {
  isolation: isolate;
}
</style>
