<script setup lang="ts">
import { computed } from 'vue'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { useConfirmDialog } from '@/composables/useConfirmDialog'

const { activeDialog, cancelActiveDialog, confirmActiveDialog, resolveActiveDialog } =
  useConfirmDialog()

const isOpen = computed(() => Boolean(activeDialog.value))

const isDestructive = computed(() => activeDialog.value?.tone === 'destructive')
const actions = computed(() => activeDialog.value?.actions ?? [])

function resolveAction(value: string): void {
  resolveActiveDialog(true, value)
}

function handleOpenChange(open: boolean): void {
  if (open) {
    return
  }

  const closingDialog = activeDialog.value
  queueMicrotask(() => {
    if (activeDialog.value === closingDialog) {
      cancelActiveDialog()
    }
  })
}
</script>

<template>
  <slot />

  <AlertDialog :open="isOpen" @update:open="handleOpenChange">
    <AlertDialogContent
      :class="
        cn(
          'max-w-[min(420px,calc(100vw-32px))] gap-5 rounded-md border-border bg-popover p-5 text-popover-foreground shadow-md',
          isDestructive && 'border-destructive/45'
        )
      "
    >
      <AlertDialogHeader class="gap-2 text-left">
        <AlertDialogTitle class="text-base font-semibold leading-6">
          {{ activeDialog?.title }}
        </AlertDialogTitle>

        <AlertDialogDescription
          v-if="activeDialog?.description"
          class="text-sm leading-6 text-muted-foreground"
        >
          {{ activeDialog.description }}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <AlertDialogFooter class="gap-2">
        <AlertDialogCancel class="mt-0 min-w-20" @click="cancelActiveDialog">
          {{ activeDialog?.cancelText }}
        </AlertDialogCancel>
        <template v-if="actions.length > 0">
          <AlertDialogAction
            v-for="action in actions"
            :key="action.value"
            :class="
              cn(
                'min-w-20',
                (action.tone ?? activeDialog?.tone) === 'destructive' &&
                  'bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/30'
              )
            "
            @click="resolveAction(action.value)"
          >
            {{ action.label }}
          </AlertDialogAction>
        </template>
        <AlertDialogAction
          v-else
          :class="
            cn(
              'min-w-20',
              isDestructive &&
                'bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/30'
            )
          "
          @click="confirmActiveDialog"
        >
          {{ activeDialog?.confirmText }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
