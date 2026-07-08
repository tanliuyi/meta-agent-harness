import type { ExtensionUiRequest } from '@shared/coding-agent/types'

export const extensionRequestTypeLabels: Record<ExtensionUiRequest['type'], string> = {
  select: '选择请求',
  confirm: '确认请求',
  input: '输入请求',
  editor: '编辑请求',
  notify: '通知',
  setStatus: '状态更新',
  setTitle: '标题更新',
  setEditorText: '编辑器文本更新',
  getEditorText: '读取编辑器文本',
  setWorkingMessage: '工作消息更新',
  setWorkingVisible: '工作行可见性更新',
  setWorkingIndicator: '工作指示器更新',
  setHiddenThinkingLabel: '隐藏思考标签更新',
  getToolsExpanded: '读取工具展开状态',
  setToolsExpanded: '工具展开状态更新'
}

export function getExtensionRequestTitle(request: ExtensionUiRequest): string {
  return 'title' in request ? request.title : extensionRequestTypeLabels[request.type]
}

export function getExtensionRequestDescription(request: ExtensionUiRequest): string {
  if (request.type === 'confirm') {
    return request.message
  }
  if (request.type === 'select') {
    return `${request.options.length} 个选项`
  }
  if (request.type === 'input') {
    return request.placeholder || extensionRequestTypeLabels[request.type]
  }
  return extensionRequestTypeLabels[request.type]
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

export function getExtensionRequestTypeLabel(request: ExtensionUiRequest): string {
  return extensionRequestTypeLabels[request.type]
}

export function getExtensionInitialDraft(request: ExtensionUiRequest): string {
  return request.type === 'editor' ? (request.prefill ?? '') : ''
}

export function getExtensionDisplayText(text: string | undefined): string {
  if (!text) {
    return ''
  }
  return legacyExtensionDisplayText[text] ?? text
}
