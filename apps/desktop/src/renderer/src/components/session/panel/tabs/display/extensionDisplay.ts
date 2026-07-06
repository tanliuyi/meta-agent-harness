import type { ExtensionUiRequest } from '@shared/coding-agent/types'

export function getExtensionRequestTitle(request: ExtensionUiRequest): string {
  return 'title' in request ? request.title : request.type
}

export function getExtensionRequestDescription(request: ExtensionUiRequest): string {
  if (request.type === 'confirm') {
    return request.message
  }
  if (request.type === 'select') {
    return `${request.options.length} options`
  }
  if (request.type === 'input') {
    return request.placeholder || request.type
  }
  return request.type
}

export function getExtensionInitialDraft(request: ExtensionUiRequest): string {
  return request.type === 'editor' ? (request.prefill ?? '') : ''
}
