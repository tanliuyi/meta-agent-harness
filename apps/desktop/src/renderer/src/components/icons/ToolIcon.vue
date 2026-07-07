<script setup lang="ts">
import { Cog } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    /** 图标尺寸（像素）。 */
    size?: number
    /** 图标描边颜色。 */
    color?: string
  }>(),
  {
    size: 16,
    color: 'currentColor'
  }
)
</script>

<template>
  <Cog :size="size" :color="color" :stroke-width="1.75" />
</template>
