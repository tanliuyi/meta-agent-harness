/**
 * Project-local extension UI compatibility test.
 *
 * This is intentionally placed under .pi/extensions so the desktop app loads it
 * as a real project extension. It exercises extension UI APIs across desktop
 * and RPC hosts, including component, theme, editor, and status projections.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export default function (pi: ExtensionAPI) {
  pi.on('session_start', async (_event, ctx) => {
    ctx.ui.onTerminalInput((data) => ({ data }))

    const themes = ctx.ui.getAllThemes()
    const defaultTheme = ctx.ui.getTheme('default')
    const themeResult = ctx.ui.setTheme('default')
    const editorComponent = () => undefined
    ctx.ui.setEditorComponent(editorComponent)

    ctx.ui.setStatus('UI 兼容', ctx.ui.theme.fg('accent', `UI 兼容测试已加载（${ctx.mode}）`))
    ctx.ui.setWidget('UI 兼容信息', [
      '扩展 UI 兼容性测试',
      `模式：${ctx.mode}`,
      `主题：${ctx.ui.theme.bold(themeResult.success ? '可用' : '不可用')}`,
      `主题数量：${themes.length}`,
      `默认主题：${defaultTheme ? '存在' : '缺失'}`,
      `编辑器组件：${ctx.ui.getEditorComponent() === editorComponent ? '已注册' : '未注册'}`
    ])

    ctx.ui.setWidget('UI 兼容组件工厂', () => undefined)
    ctx.ui.setFooter(() => undefined)
    ctx.ui.setHeader(() => undefined)
    ctx.ui.addAutocompleteProvider((current) => current)
    ctx.ui.setWorkingMessage('UI 兼容测试')
    ctx.ui.setWorkingVisible(true)
    ctx.ui.setWorkingIndicator({ frames: ['*', '**'], intervalMs: 250 })
    ctx.ui.setHiddenThinkingLabel('隐藏推理')
    ctx.ui.getToolsExpanded()
    ctx.ui.setToolsExpanded(false)
  })

  pi.registerCommand('ui-compat-test', {
    description: '测试 desktop/RPC 扩展 UI 方法',
    handler: async (_args, ctx) => {
      await ctx.ui.custom(() => undefined, { title: 'UI 兼容自定义组件' })
      ctx.ui.pasteToEditor('UI 兼容测试写入了这段草稿。')
      ctx.ui.setEditorText('UI 兼容测试已完成。')
      ctx.ui.getEditorText()
      ctx.ui.notify('UI 兼容方法已执行', 'info')
    }
  })
}
