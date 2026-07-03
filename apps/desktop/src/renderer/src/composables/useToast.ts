import { readonly, ref } from 'vue'

export interface ToastMessage {
  id: number
  type: 'success' | 'error'
  title: string
  description?: string
}

const toasts = ref<ToastMessage[]>([])
let nextToastId = 1

function showToast(input: Omit<ToastMessage, 'id'>): void {
  const id = nextToastId++
  toasts.value = [...toasts.value, { ...input, id }]
  window.setTimeout(() => dismissToast(id), 3200)
}

function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((toast) => toast.id !== id)
}

export function useToast() {
  return {
    toasts: readonly(toasts),
    dismissToast,
    success: (title: string, description?: string) => showToast({ type: 'success', title, description }),
    error: (title: string, description?: string) => showToast({ type: 'error', title, description })
  }
}
