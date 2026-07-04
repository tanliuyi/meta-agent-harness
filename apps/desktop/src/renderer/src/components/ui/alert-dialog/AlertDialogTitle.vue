<script setup lang="ts">
import type { AlertDialogTitleProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { AlertDialogTitle } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<AlertDialogTitleProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')
const rootClass = computed(() => cn('text-base font-semibold leading-5', props.class))
</script>

<template>
  <AlertDialogTitle data-slot="alert-dialog-title" v-bind="delegatedProps" :class="rootClass">
    <slot />
  </AlertDialogTitle>
</template>
