import { computed, readonly, shallowRef } from 'vue'
import type { ComputedRef, Ref } from 'vue'

export type ConfirmDialogTone = 'default' | 'destructive'

export type ConfirmDialogAction = {
  label: string
  tone?: ConfirmDialogTone
  value: string
}

export type ConfirmDialogRequest = {
  actions?: readonly ConfirmDialogAction[]
  cancelText?: string
  confirmText?: string
  description?: string
  id?: string
  title: string
  tone?: ConfirmDialogTone
}

export type ConfirmDialogResult = {
  action?: string
  confirmed: boolean
  id: string
}

type PendingConfirmDialog = Required<Pick<ConfirmDialogRequest, 'confirmText' | 'id' | 'tone'>> &
  Omit<ConfirmDialogRequest, 'confirmText' | 'id' | 'tone'> & {
    cancelText: string
    resolve: (result: ConfirmDialogResult) => void
  }

type ConfirmDialogState = {
  activeDialog: Readonly<Ref<PendingConfirmDialog | undefined>>
  cancelActiveDialog: () => void
  confirm: (request: ConfirmDialogRequest) => Promise<ConfirmDialogResult>
  confirmActiveDialog: () => void
  hasQueuedDialogs: ComputedRef<boolean>
  queueLength: ComputedRef<number>
  rejectAllDialogs: () => void
  resolveActiveDialog: (confirmed: boolean, action?: string) => void
}

const DEFAULT_CANCEL_TEXT = '取消'
const DEFAULT_CONFIRM_TEXT = '确认'

const queue = shallowRef<PendingConfirmDialog[]>([])
const activeDialog = shallowRef<PendingConfirmDialog>()
let nextDialogId = 1

const queueLength = computed(() => queue.value.length + (activeDialog.value ? 1 : 0))
const hasQueuedDialogs = computed(() => queueLength.value > 0)

function createDialogId(): string {
  const id = `confirm-dialog-${nextDialogId}`
  nextDialogId += 1
  return id
}

function showNextDialog(): void {
  if (activeDialog.value || queue.value.length === 0) {
    return
  }

  const [nextDialog, ...waitingDialogs] = queue.value
  activeDialog.value = nextDialog
  queue.value = waitingDialogs
}

function settleActiveDialog(confirmed: boolean, action?: string): void {
  const dialog = activeDialog.value

  if (!dialog) {
    return
  }

  activeDialog.value = undefined
  dialog.resolve({ action, confirmed, id: dialog.id })
  showNextDialog()
}

export function confirm(request: ConfirmDialogRequest): Promise<ConfirmDialogResult> {
  return new Promise((resolve) => {
    queue.value = [
      ...queue.value,
      {
        cancelText: request.cancelText ?? DEFAULT_CANCEL_TEXT,
        confirmText: request.confirmText ?? DEFAULT_CONFIRM_TEXT,
        description: request.description,
        id: request.id ?? createDialogId(),
        resolve,
        title: request.title,
        tone: request.tone ?? 'default'
      }
    ]

    showNextDialog()
  })
}

export function useConfirmDialog(): ConfirmDialogState {
  return {
    activeDialog: readonly(activeDialog),
    cancelActiveDialog: () => settleActiveDialog(false),
    confirm,
    confirmActiveDialog: () => settleActiveDialog(true, 'confirm'),
    hasQueuedDialogs,
    queueLength,
    rejectAllDialogs: () => {
      settleActiveDialog(false)

      const pendingDialogs = queue.value
      queue.value = []
      for (const dialog of pendingDialogs) {
        dialog.resolve({ confirmed: false, id: dialog.id })
      }
    },
    resolveActiveDialog: settleActiveDialog
  }
}
