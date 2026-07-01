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
