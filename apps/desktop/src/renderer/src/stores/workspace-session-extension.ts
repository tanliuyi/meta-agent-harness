import type { ExtensionDialogRequest, ExtensionUiResponseInput } from '@shared/coding-agent/types'

type ExtensionUiResponse = ExtensionUiResponseInput['response']

/** 将请求加入有序队列；相同 ID 的更新保留原有位置。 */
export function enqueueExtensionDialog(
  queue: ExtensionDialogRequest[],
  request: ExtensionDialogRequest
): ExtensionDialogRequest[] {
  const index = queue.findIndex((item) => item.id === request.id)
  if (index < 0) {
    return [...queue, request]
  }
  const next = [...queue]
  next[index] = request
  return next
}

/** 从有序队列移除已完成的请求。 */
export function removeExtensionDialog(
  queue: ExtensionDialogRequest[],
  requestId: string
): ExtensionDialogRequest[] {
  return queue.filter((request) => request.id !== requestId)
}

/** 将组件提交值转换成 desktop transport 响应。 */
export function createExtensionDialogResponse(
  request: ExtensionDialogRequest,
  value?: string | boolean
): ExtensionUiResponse | undefined {
  if (request.type === 'confirm') {
    return { id: request.id, confirmed: value === true }
  }
  if (typeof value !== 'string') {
    return undefined
  }
  return { id: request.id, value }
}

/** 创建统一的取消响应。 */
export function createExtensionDialogCancellation(
  request: ExtensionDialogRequest
): ExtensionUiResponse {
  return { id: request.id, cancelled: true }
}
