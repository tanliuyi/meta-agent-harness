<script setup lang="ts">
/**
 * 本文件挂载 desktop renderer 应用根视图和主题状态。
 */

import { useTheme } from './composables/useTheme'

useTheme()
</script>

<template>
  <RouterView />
</template>

<style lang="scss">
#app {
  isolation: isolate;
}
</style>
