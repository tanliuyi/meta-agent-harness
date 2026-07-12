<script setup lang="ts">
/**
 * WindowDragStrip.vue - macOS 窗口拖拽区域。
 *
 * @description
 * 在 macOS 上提供一段占位式顶部透明拖拽条。
 * 渲染平台由父级布局控制；Windows/Linux 使用自定义 TitleBar。
 */
</script>

<template>
  <div class="window-drag-strip" aria-hidden="true" />
</template>

<style lang="scss" scoped>
.window-drag-strip {
  width: 100%;
  height: 100%;
  background: var(--color-canvas);
  -webkit-app-region: drag;
  app-region: drag;
  pointer-events: auto;
}
</style>
