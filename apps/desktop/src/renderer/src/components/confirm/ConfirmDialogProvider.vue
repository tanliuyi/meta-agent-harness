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
        cn('bg-popover text-popover-foreground shadow-md', isDestructive && 'border-destructive/45')
      "
    >
      <AlertDialogHeader class="text-left">
        <AlertDialogTitle>
          {{ activeDialog?.title }}
        </AlertDialogTitle>

        <AlertDialogDescription v-if="activeDialog?.description">
          {{ activeDialog.description }}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <AlertDialogFooter>
        <AlertDialogCancel @click="cancelActiveDialog">
          {{ activeDialog?.cancelText }}
        </AlertDialogCancel>
        <template v-if="actions.length > 0">
          <AlertDialogAction
            v-for="action in actions"
            :key="action.value"
            :variant="
              (action.tone ?? activeDialog?.tone) === 'destructive' ? 'destructive' : 'default'
            "
            @click="resolveAction(action.value)"
          >
            {{ action.label }}
          </AlertDialogAction>
        </template>
        <AlertDialogAction
          v-else
          :variant="isDestructive ? 'destructive' : 'default'"
          @click="confirmActiveDialog"
        >
          {{ activeDialog?.confirmText }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
