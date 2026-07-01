/** * App.vue - 桌面端 renderer 应用的根组件。 * * @description * 挂载全局
<RouterView />
，并通过 useTheme 初始化应用主题。 */
<script setup lang="ts">
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
