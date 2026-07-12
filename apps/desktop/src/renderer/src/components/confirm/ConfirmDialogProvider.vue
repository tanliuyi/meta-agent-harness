<script setup lang="ts">
import { MoreHorizontal } from 'lucide-vue-next'
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
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useConfirmDialog } from '@/composables/useConfirmDialog'

const { activeDialog, cancelActiveDialog, confirmActiveDialog, resolveActiveDialog } =
  useConfirmDialog()

const isOpen = computed(() => Boolean(activeDialog.value))

const isDestructive = computed(() => activeDialog.value?.tone === 'destructive')
const actions = computed(() => activeDialog.value?.actions ?? [])
const primaryAction = computed(() => actions.value[0])
const overflowActions = computed(() => actions.value.slice(1))

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
      class="confirm-dialog"
      :data-tone="isDestructive ? 'destructive' : 'default'"
    >
      <AlertDialogHeader class="confirm-dialog__header">
        <AlertDialogTitle>
          {{ activeDialog?.title }}
        </AlertDialogTitle>

        <AlertDialogDescription v-if="activeDialog?.description">
          {{ activeDialog.description }}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <AlertDialogFooter class="confirm-dialog__footer">
        <AlertDialogCancel @click="cancelActiveDialog">
          {{ activeDialog?.cancelText }}
        </AlertDialogCancel>
        <div
          v-if="primaryAction && overflowActions.length > 0"
          class="confirm-dialog__split-action"
        >
          <AlertDialogAction
            class="confirm-dialog__primary-action"
            :variant="primaryAction.tone === 'destructive' ? 'destructive' : 'default'"
            @click="resolveAction(primaryAction.value)"
          >
            {{ primaryAction.label }}
          </AlertDialogAction>

          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button
                class="confirm-dialog__more-action"
                size="sm"
                :variant="primaryAction.tone === 'destructive' ? 'destructive' : 'default'"
                aria-label="更多选项"
                title="更多选项"
              >
                <MoreHorizontal :size="16" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="confirm-dialog__action-menu">
              <template v-for="action in overflowActions" :key="action.value">
                <DropdownMenuSeparator v-if="action.tone === 'destructive'" />
                <DropdownMenuItem
                  :variant="action.tone === 'destructive' ? 'destructive' : 'default'"
                  @select="resolveAction(action.value)"
                >
                  {{ action.label }}
                </DropdownMenuItem>
              </template>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <AlertDialogAction
          v-else-if="primaryAction"
          :variant="
            (primaryAction.tone ?? activeDialog?.tone) === 'destructive' ? 'destructive' : 'default'
          "
          @click="resolveAction(primaryAction.value)"
        >
          {{ primaryAction.label }}
        </AlertDialogAction>
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

<style lang="scss" scoped>
.confirm-dialog {
  width: min(calc(100% - 32px), 420px);
  gap: 0;
  padding: 0;
  overflow: hidden;
}

.confirm-dialog[data-tone='destructive'] {
  border-color: var(--color-danger-outline);
}

.confirm-dialog__header {
  position: relative;
  gap: var(--space-1);
  padding: var(--space-4) var(--space-5) var(--space-4) calc(var(--space-5) + 14px);
  text-align: left;
  border-bottom: 1px solid var(--color-border);

  &::before {
    position: absolute;
    top: var(--space-5);
    left: var(--space-5);
    width: 6px;
    height: 6px;
    background: var(--color-primary);
    box-shadow: 0 8px 0 color-mix(in srgb, var(--color-primary) 42%, transparent);
    content: '';
  }
}

.confirm-dialog[data-tone='destructive'] .confirm-dialog__header::before {
  background: var(--color-danger);
  box-shadow: 0 8px 0 color-mix(in srgb, var(--color-danger) 42%, transparent);
}

.confirm-dialog__footer {
  padding: var(--space-3) var(--space-5);
}

.confirm-dialog__split-action {
  display: inline-flex;
  min-width: 0;
}

.confirm-dialog__primary-action {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.confirm-dialog__more-action {
  width: 32px;
  padding: 0;
  margin-left: -1px;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}

.confirm-dialog__action-menu {
  min-width: 144px;
}
</style>
