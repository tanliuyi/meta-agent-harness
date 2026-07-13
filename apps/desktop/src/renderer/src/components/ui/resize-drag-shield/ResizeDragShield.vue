<template>
  <div class="resize-drag-shield" aria-hidden="true" />
</template>

<style lang="scss" scoped>
.resize-drag-shield {
  position: absolute;
  z-index: 100;
  inset: 0;
  cursor: col-resize;
}
</style>
