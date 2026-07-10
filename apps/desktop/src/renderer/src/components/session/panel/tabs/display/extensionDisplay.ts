import type { ExtensionDialogRequest } from '@shared/coding-agent/types'

export const extensionDialogTypeLabels: Record<ExtensionDialogRequest['type'], string> = {
  select: '选择请求',
  confirm: '确认请求',
  input: '输入请求',
  editor: '编辑请求'
}

export function getExtensionRequestTitle(request: ExtensionDialogRequest): string {
  return request.title
}

export function getExtensionRequestDescription(request: ExtensionDialogRequest): string {
  if (request.type === 'confirm') {
    return request.message
  }
  if (request.type === 'select') {
    return `${request.options.length} 个选项`
  }
  if (request.type === 'input') {
    return request.placeholder || extensionDialogTypeLabels[request.type]
  }
  return extensionDialogTypeLabels[request.type]
}

const legacyExtensionDisplayText: Record<string, string> = {
  'ui-compat': 'UI 兼容',
  'ui-compat-lines': 'UI 兼容信息',
  'ui-compat-factory': 'UI 兼容组件工厂',
  extensionFooter: '扩展页脚',
  extensionHeader: '扩展页头',
  extensionCustom: '扩展自定义组件',
  extensionEditorComponent: '扩展编辑器组件',
  terminalInput: '终端输入',
  autocomplete: '自动补全',
  theme: '主题',
  working: '工作状态',
  indicator: '指示器',
  'UI compat loaded (rpc)': 'UI 兼容测试已加载（rpc）',
  'Extension UI compatibility test': '扩展 UI 兼容性测试',
  'mode: rpc': '模式：rpc',
  'theme: available': '主题：可用',
  '1 custom frames': '1 个自定义帧',
  'Default indicator': '默认指示器'
}

export function getExtensionRequestTypeLabel(request: ExtensionDialogRequest): string {
  return extensionDialogTypeLabels[request.type]
}

export function getExtensionInitialDraft(request: ExtensionDialogRequest): string {
  return request.type === 'editor' ? (request.prefill ?? '') : ''
}

export function getExtensionDisplayText(text: string | undefined): string {
  if (!text) {
    return ''
  }
  return legacyExtensionDisplayText[text] ?? text
}
