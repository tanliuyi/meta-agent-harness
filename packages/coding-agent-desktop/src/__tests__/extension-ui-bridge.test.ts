/**
 * 本文件测试 extension UI bridge 的 transport request/response 关联。
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ExtensionUiBridge } from '../worker/extension-ui-bridge.ts'
import type { WorkerEventEnvelope } from '../protocol/envelope.ts'
import { desktopWebviewHostStylesheetPath } from '../worker/extension-webview-source.ts'

function getProjectionRequests(events: WorkerEventEnvelope[]) {
  return events.map((event) => {
    if (event.eventType !== 'projection' || event.event.type !== 'extensionUi.requested') {
      throw new Error('extension UI projection event is required')
    }
    return event.event.request
  })
}

function getProjectionEvents(events: WorkerEventEnvelope[]) {
  return events.map((event) => {
    if (event.eventType !== 'projection') {
      throw new Error('projection event is required')
    }
    return event.event
  })
}

/** ExtensionUiBridge 测试套件。 */
describe('ExtensionUiBridge', () => {
  /** 验证 select 请求通过投影事件发出并可用 UI 响应解析结果。 */
  it('select 通过 projection event 请求并用 ui response 解析结果', async () => {
    const events: WorkerEventEnvelope[] = []
    const bridge = new ExtensionUiBridge('thread-1', (event) => events.push(event))
    const pending = bridge.createContext().select('选择', ['a', 'b'])

    const request = events[0]
    if (request?.eventType !== 'projection' || request.event.type !== 'extensionUi.requested') {
      throw new Error('extension UI request event is required')
    }
    bridge.respond({ id: request.event.request.id, value: 'b' })

    await expect(pending).resolves.toBe('b')
    expect(request.event.request).toMatchObject({
      type: 'select',
      title: '选择',
      options: ['a', 'b']
    })
  })

  /** 验证对未知 response id 会 fail-first。 */
  it('未知 response id fail-first', () => {
    const bridge = new ExtensionUiBridge('thread-1', () => {})

    expect(() => bridge.respond({ id: 'missing', cancelled: true })).toThrow(
      'extension UI request not found'
    )
  })

  it('重复响应已完成的请求时幂等忽略', async () => {
    const events: WorkerEventEnvelope[] = []
    const bridge = new ExtensionUiBridge('thread-1', (event) => events.push(event))
    const pending = bridge.createContext().input('Name')
    const request = getProjectionRequests(events)[0]

    bridge.respond({ id: request.id, value: 'first' })
    expect(() => bridge.respond({ id: request.id, value: 'duplicate' })).not.toThrow()

    await expect(pending).resolves.toBe('first')
  })

  /** 验证交互类 UI 请求串行投递，避免 Composer 同时出现多个输入弹窗。 */
  it('交互类 UI 请求串行投递', async () => {
    const events: WorkerEventEnvelope[] = []
    const bridge = new ExtensionUiBridge('thread-1', (event) => events.push(event))
    const ui = bridge.createContext()

    const first = ui.input('First')
    const second = ui.editor('Second', 'prefill')

    expect(bridge.listPendingDialogs()).toEqual([
      expect.objectContaining({ type: 'input', title: 'First' }),
      expect.objectContaining({ type: 'editor', title: 'Second', prefill: 'prefill' })
    ])
    expect(getProjectionRequests(events)).toEqual([
      expect.objectContaining({ type: 'input', title: 'First' })
    ])

    const firstRequest = getProjectionRequests(events)[0]
    bridge.respond({ id: firstRequest.id, value: 'first value' })
    await expect(first).resolves.toBe('first value')

    expect(getProjectionRequests(events)).toEqual([
      expect.objectContaining({ type: 'input', title: 'First' }),
      expect.objectContaining({ type: 'editor', title: 'Second', prefill: 'prefill' })
    ])

    const secondRequest = getProjectionRequests(events)[1]
    bridge.respond({ id: secondRequest.id, value: 'second value' })
    await expect(second).resolves.toBe('second value')
  })

  it('已取消或等待中的 signal 会取消 dialog 并清理 renderer projection', async () => {
    const events: WorkerEventEnvelope[] = []
    const bridge = new ExtensionUiBridge('thread-1', (event) => events.push(event))
    const ui = bridge.createContext()
    const preAborted = new AbortController()
    preAborted.abort()

    await expect(
      ui.confirm('Skipped', 'Already aborted', { signal: preAborted.signal })
    ).resolves.toBe(false)
    expect(events).toEqual([])

    const controller = new AbortController()
    const pending = ui.input('Name', undefined, { signal: controller.signal })
    const request = getProjectionRequests(events)[0]
    controller.abort()

    await expect(pending).resolves.toBeUndefined()
    expect(events.at(-1)).toMatchObject({
      eventType: 'projection',
      event: { type: 'extensionUi.dismissed', requestId: request.id, reason: 'aborted' }
    })
    expect(() => bridge.respond({ id: request.id, value: 'late' })).not.toThrow()
  })

  it('timeout 返回默认取消值、移除过期 projection 并继续下一个 dialog', async () => {
    vi.useFakeTimers()
    try {
      const events: WorkerEventEnvelope[] = []
      const bridge = new ExtensionUiBridge('thread-1', (event) => events.push(event))
      const ui = bridge.createContext()
      const timedOut = ui.confirm('First', 'Continue?', { timeout: 25 })
      const next = ui.input('Second')
      const firstRequest = getProjectionRequests(events)[0]

      await vi.advanceTimersByTimeAsync(25)

      await expect(timedOut).resolves.toBe(false)
      expect(getProjectionEvents(events)).toContainEqual(
        expect.objectContaining({
          type: 'extensionUi.dismissed',
          requestId: firstRequest.id,
          reason: 'timeout'
        })
      )
      const requests = getProjectionEvents(events).filter(
        (event) => event.type === 'extensionUi.requested'
      )
      expect(requests).toHaveLength(2)
      const secondRequest = requests[1].request
      bridge.respond({ id: secondRequest.id, value: 'done' })
      await expect(next).resolves.toBe('done')
    } finally {
      vi.useRealTimers()
    }
  })

  it('dispose 会取消全部等待中的 dialogs，且不再接受新请求', async () => {
    const events: WorkerEventEnvelope[] = []
    const bridge = new ExtensionUiBridge('thread-1', (event) => events.push(event))
    const ui = bridge.createContext()
    const first = ui.select('First', ['a'])
    const second = ui.confirm('Second', 'Continue?')

    bridge.dispose()

    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBe(false)
    expect(
      getProjectionEvents(events).filter((event) => event.type === 'extensionUi.requested')
    ).toHaveLength(1)
    expect(
      getProjectionEvents(events).filter((event) => event.type === 'extensionUi.dismissed')
    ).toEqual([
      expect.objectContaining({ type: 'extensionUi.dismissed', reason: 'workerStopped' }),
      expect.objectContaining({ type: 'extensionUi.dismissed', reason: 'workerStopped' })
    ])
    await expect(ui.input('After stop')).resolves.toBeUndefined()
  })

  /** 验证 UI 状态 API 通过 projection event 投影给 renderer。 */
  it('UI 状态 API 通过 projection event 投影', () => {
    const events: WorkerEventEnvelope[] = []
    const bridge = new ExtensionUiBridge('thread-1', (event) => events.push(event))
    const ui = bridge.createContext()

    ui.setWorkingMessage('正在索引')
    ui.setWorkingVisible(false)
    ui.setWorkingIndicator({ frames: ['-', '+'], intervalMs: 120 })
    ui.setHiddenThinkingLabel('已隐藏推理')
    ui.setToolsExpanded(true)

    const requests = events.map((event) => {
      if (event.eventType !== 'projection' || event.event.type !== 'extensionUi.requested') {
        throw new Error('extension UI projection event is required')
      }
      return event.event.request
    })
    expect(requests).toEqual([
      expect.objectContaining({ type: 'setWorkingMessage', message: '正在索引' }),
      expect.objectContaining({ type: 'setWorkingVisible', visible: false }),
      expect.objectContaining({
        type: 'setWorkingIndicator',
        options: { frames: ['-', '+'], intervalMs: 120 }
      }),
      expect.objectContaining({ type: 'setHiddenThinkingLabel', label: '已隐藏推理' }),
      expect.objectContaining({ type: 'setToolsExpanded', expanded: true })
    ])
    expect(ui.getToolsExpanded()).toBe(true)
  })

  /** 验证 setWidget 在 desktop 下静默忽略。 */
  it('setWidget 静默忽略', () => {
    const events: WorkerEventEnvelope[] = []
    const bridge = new ExtensionUiBridge('thread-1', (event) => events.push(event))
    const ui = bridge.createContext()

    expect(() => {
      ui.setWidget('text-widget', ['line'])
      ui.setWidget('factory-widget', (() => undefined) as never)
      ui.setWidget('clear-widget', undefined)
    }).not.toThrow()
    expect(events).toEqual([])
  })

  /** 验证扩展 UI API 在 desktop 下保存状态并投影可见结果。 */
  it('扩展 UI API 保存状态并投影可见结果', async () => {
    const events: WorkerEventEnvelope[] = []
    const bridge = new ExtensionUiBridge('thread-1', (event) => events.push(event))
    const ui = bridge.createContext() as ReturnType<ExtensionUiBridge['createContext']> &
      Record<string, any>

    const unsubscribe = ui.onTerminalInput((data: string) => ({ data: `${data}!` }))
    expect(bridge.handleTerminalInput('go')).toEqual({ consumed: false, data: 'go!' })
    unsubscribe()
    expect(ui.getEditorComponent()).toBeUndefined()
    expect(ui.theme.fg('accent', 'text')).toBe('text')
    expect(ui.theme.bg('customMessageBg', 'text')).toBe('text')
    expect(ui.theme.bold('text')).toBe('text')
    expect(ui.theme.getFgAnsi('accent')).toBe('#7dd3fc')
    expect(ui.getAllThemes()).toEqual([{ name: 'default' }])
    expect(ui.getTheme('default')).toEqual(expect.objectContaining({ name: 'default' }))
    expect(ui.getTheme('dark')).toBeUndefined()
    expect(ui.setTheme('default')).toEqual({ success: true })
    expect(ui.setTheme('dark')).toEqual({ success: false, error: 'Theme not found: dark' })
    expect(getProjectionRequests(events)).toEqual([
      expect.objectContaining({
        type: 'setStatus',
        statusKey: 'terminalInput',
        statusText: '1 listener(s)'
      }),
      expect.objectContaining({
        type: 'setStatus',
        statusKey: 'terminalInput',
        statusText: undefined
      }),
      expect.objectContaining({ type: 'setStatus', statusKey: 'theme', statusText: 'default' })
    ])
  })

  /** 验证 desktop 不支持的 TUI-only API 对复杂参数静默处理，不抛错。 */
  it('TUI-only API 复杂参数在 desktop 下静默处理', async () => {
    const events: WorkerEventEnvelope[] = []
    const bridge = new ExtensionUiBridge('thread-1', (event) => events.push(event))
    const ui = bridge.createContext() as ReturnType<ExtensionUiBridge['createContext']> &
      Record<string, any>
    const circular: Record<string, unknown> = { bigint: 1n }
    circular.self = circular
    const factory = () => {
      throw new Error('factory must not be invoked by desktop')
    }

    expect(() => ui.setWidget('mixed', ['ok', 1, null] as never)).not.toThrow()
    expect(() => ui.setWidget('factory', factory as never)).not.toThrow()
    expect(() => ui.setHeader(factory)).not.toThrow()
    expect(() => ui.setFooter(factory)).not.toThrow()
    await expect(ui.custom(factory, circular)).resolves.toBeUndefined()
    expect(() => ui.addAutocompleteProvider(factory)).not.toThrow()
    expect(() => ui.setEditorComponent(factory)).not.toThrow()

    expect(events).toEqual([])
  })

  /** 验证 desktop webview panel API 通过 projection event 投影。 */
  it('desktop webview panel API 通过 projection event 投影', () => {
    const events: WorkerEventEnvelope[] = []
    const bridge = new ExtensionUiBridge('thread-1', (event) => events.push(event))
    const desktop = bridge.createDesktopContext()

    expect(desktop.cspSource).toBe('pi-webview-resource:')
    desktop.registerWebviewPanel('deploy', {
      title: 'Deploy',
      order: 2,
      retainContextWhenHidden: true,
      source: { type: 'html', html: '<h1>Deploy</h1>' }
    })
    desktop.updateWebviewPanel('deploy', { title: 'Deployments' })
    desktop.postPanelMessage('deploy', { type: 'state', status: 'running' })
    desktop.removePanel('deploy')

    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'projection',
        event: expect.objectContaining({
          type: 'extensionPanel.registered',
          panel: expect.objectContaining({
            id: 'deploy',
            viewType: 'deploy',
            title: 'Deploy',
            retainContextWhenHidden: true
          })
        })
      }),
      expect.objectContaining({
        eventType: 'projection',
        event: expect.objectContaining({
          type: 'extensionPanel.updated',
          panelId: 'deploy',
          patch: { title: 'Deployments' }
        })
      }),
      expect.objectContaining({
        eventType: 'projection',
        event: expect.objectContaining({
          type: 'extensionPanel.message',
          panelId: 'deploy',
          message: { type: 'state', status: 'running' }
        })
      }),
      expect.objectContaining({
        eventType: 'projection',
        event: expect.objectContaining({ type: 'extensionPanel.removed', panelId: 'deploy' })
      })
    ])
  })

  /** 验证受控 native panel 只投影 host capability。 */
  it('desktop native panel API 通过 projection event 投影', () => {
    const events: WorkerEventEnvelope[] = []
    const bridge = new ExtensionUiBridge('thread-1', (event) => events.push(event))
    const desktop = bridge.createDesktopContext()

    desktop.registerNativePanel('hermes-memory', {
      title: '记忆',
      component: 'memory',
      order: 35,
      retainContextWhenHidden: true
    })

    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'projection',
        event: expect.objectContaining({
          type: 'extensionPanel.registered',
          panel: {
            id: 'hermes-memory',
            viewType: 'hermes-memory',
            title: '记忆',
            icon: undefined,
            order: 35,
            retainContextWhenHidden: true,
            source: { type: 'native', component: 'memory' }
          }
        })
      })
    ])
  })

  /** 验证 desktop webview panel 拒绝非法 URL。 */
  it('desktop webview panel 拒绝非法 URL', () => {
    const bridge = new ExtensionUiBridge('thread-1', () => {})
    const desktop = bridge.createDesktopContext()

    expect(() =>
      desktop.registerWebviewPanel('bad', {
        title: 'Bad',
        source: { type: 'url', url: 'file:///etc/passwd' }
      })
    ).toThrow('Invalid desktop webview panel URL')
    expect(() =>
      desktop.updateWebviewPanel('bad', { source: { type: 'url', url: 'not a url' } })
    ).toThrow('Invalid desktop webview panel URL')
    expect(() =>
      desktop.registerWebviewPanel('bad-port-mapping', {
        title: 'Bad',
        source: {
          type: 'url',
          url: 'http://localhost:5173',
          portMapping: [{ webviewPort: 5173, extensionHostPort: 70000 }]
        }
      })
    ).toThrow('Invalid desktop webview portMapping')
  })

  /** 验证 file source 从本地 HTML 读取并重写为受控资源 URI。 */
  it('desktop webview panel 支持 file source 和本地资源 URI 重写', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'desktop-webview-'))
    try {
      writeFileSync(
        path.join(root, 'icon.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        'utf8'
      )
      writeFileSync(path.join(root, 'panel.css.map'), '{"version":3}', 'utf8')
      writeFileSync(
        path.join(root, 'panel.css'),
        "body { color: red; background: url('./icon.svg'); }\n/*# sourceMappingURL=panel.css.map */",
        'utf8'
      )
      writeFileSync(path.join(root, 'panel.js.map'), '{"version":3}', 'utf8')
      writeFileSync(
        path.join(root, 'panel.js'),
        "window.piPanel.post({ type: 'ready' })\n//# sourceMappingURL=panel.js.map",
        'utf8'
      )
      writeFileSync(
        path.join(root, 'index.html'),
        [
          '<!doctype html>',
          '<html><head>',
          "<link href='./panel.css' rel='stylesheet'>",
          '</head><body>',
          "<img src='./icon.svg'>",
          '<script type="module" src="./panel.js"></script>',
          '</body></html>'
        ].join(''),
        'utf8'
      )
      const events: WorkerEventEnvelope[] = []
      const bridge = new ExtensionUiBridge('thread-1', (event) => events.push(event), root)
      const desktop = bridge.createDesktopContext()

      desktop.registerWebviewPanel('file-panel', {
        title: 'File Panel',
        source: { type: 'file', path: './index.html' }
      })

      const projectionEvents = getProjectionEvents(events)
      const event = projectionEvents.find((item) => item.type === 'extensionPanel.registered')
      if (!event || event.type !== 'extensionPanel.registered') {
        throw new Error('extension panel registration is required')
      }
      const resourceEvents = projectionEvents.filter(
        (item) => item.type === 'extensionPanel.resourceRegistered'
      )
      expect(event.panel.source).toMatchObject({ type: 'html', baseUrl: root })
      if (event.panel.source.type !== 'html') {
        throw new Error('resolved source must be html')
      }
      expect(event.panel.source.html).toContain("<link href='pi-webview-resource://")
      expect(event.panel.source.html).toContain("<img src='pi-webview-resource://")
      expect(event.panel.source.html).toContain('<script type="module" src="pi-webview-resource://')
      expect(event.panel.source.html).not.toContain('data:image/svg+xml;base64,')
      expect(event.panel.source.html).not.toContain("window.piPanel.post({ type: 'ready' })")
      expect(resourceEvents).toHaveLength(6)
      const stylesheetResource = resourceEvents.find(
        (item) =>
          item.type === 'extensionPanel.resourceRegistered' &&
          item.resource.contentType === 'text/css; charset=utf-8'
      )
      if (!stylesheetResource || stylesheetResource.type !== 'extensionPanel.resourceRegistered') {
        throw new Error('stylesheet resource registration is required')
      }
      expect(stylesheetResource.resource.content).toContain('body { color: red;')
      expect(stylesheetResource.resource.content).toContain(
        "background: url('pi-webview-resource://"
      )
      expect(stylesheetResource.resource.content).toContain(
        'sourceMappingURL=pi-webview-resource://'
      )
      const scriptResource = resourceEvents.find(
        (item) =>
          item.type === 'extensionPanel.resourceRegistered' &&
          item.resource.contentType === 'text/javascript; charset=utf-8'
      )
      if (!scriptResource || scriptResource.type !== 'extensionPanel.resourceRegistered') {
        throw new Error('script resource registration is required')
      }
      expect(scriptResource.resource.content).toContain("window.piPanel.post({ type: 'ready' })")
      expect(scriptResource.resource.content).toContain('sourceMappingURL=pi-webview-resource://')
      expect(resourceEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'extensionPanel.resourceRegistered',
            resource: expect.objectContaining({ path: path.join(root, 'panel.css.map') })
          }),
          expect.objectContaining({
            type: 'extensionPanel.resourceRegistered',
            resource: expect.objectContaining({ path: path.join(root, 'panel.js.map') })
          })
        ])
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  /** 验证 file source 解析后保留 localhost portMapping。 */
  it('desktop webview panel 保留 file source portMapping', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'desktop-webview-port-mapping-'))
    try {
      writeFileSync(path.join(root, 'index.html'), '<main>dev server</main>', 'utf8')
      const events: WorkerEventEnvelope[] = []
      const bridge = new ExtensionUiBridge('thread-1', (event) => events.push(event), root)
      const desktop = bridge.createDesktopContext()

      desktop.registerWebviewPanel('file-panel', {
        title: 'File Panel',
        source: {
          type: 'file',
          path: './index.html',
          portMapping: [{ webviewPort: 5173, extensionHostPort: 62100 }]
        }
      })

      const event = events[0]
      if (event?.eventType !== 'projection' || event.event.type !== 'extensionPanel.registered') {
        throw new Error('extension panel registration is required')
      }
      expect(event.event.panel.source).toMatchObject({
        type: 'html',
        portMapping: [{ webviewPort: 5173, extensionHostPort: 62100 }]
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  /** 验证 bundle source 支持 Vite 风格的根路径资源。 */
  it('desktop webview panel 支持 bundle source 的根路径资源', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'desktop-webview-bundle-'))
    try {
      const assets = path.join(root, 'assets')
      writeFileSync(
        path.join(root, 'index.html'),
        '<script type="module" src="/assets/index.js"></script>',
        'utf8'
      )
      mkdirSync(assets, { recursive: true })
      writeFileSync(
        path.join(assets, 'index.js'),
        "window.piPanel.post({ type: 'bundle-ready' })",
        'utf8'
      )
      const events: WorkerEventEnvelope[] = []
      const bridge = new ExtensionUiBridge('thread-1', (event) => events.push(event), root)
      const desktop = bridge.createDesktopContext()

      desktop.registerWebviewPanel('bundle-panel', {
        title: 'Bundle Panel',
        source: { type: 'bundle', root: '.' }
      })

      const projectionEvents = getProjectionEvents(events)
      const event = projectionEvents.find((item) => item.type === 'extensionPanel.registered')
      if (!event || event.type !== 'extensionPanel.registered') {
        throw new Error('extension panel registration is required')
      }
      if (event.panel.source.type !== 'html') {
        throw new Error('resolved source must be html')
      }
      expect(event.panel.source.html).toContain('src="pi-webview-resource://')
      expect(event.panel.source.html).not.toContain('bundle-ready')
      expect(projectionEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'extensionPanel.resourceRegistered',
            resource: expect.objectContaining({
              content: "window.piPanel.post({ type: 'bundle-ready' })",
              contentType: 'text/javascript; charset=utf-8'
            })
          })
        ])
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  /** 验证 localResourceRoots 会阻止越界资源。 */
  it('desktop webview panel 拒绝 localResourceRoots 外的资源', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'desktop-webview-'))
    const outside = mkdtempSync(path.join(tmpdir(), 'desktop-webview-outside-'))
    try {
      writeFileSync(path.join(outside, 'secret.js'), "console.log('secret')", 'utf8')
      writeFileSync(
        path.join(root, 'index.html'),
        `<script src="../${path.basename(outside)}/secret.js"></script>`,
        'utf8'
      )
      const bridge = new ExtensionUiBridge('thread-1', () => {}, root)
      const desktop = bridge.createDesktopContext()

      expect(() =>
        desktop.registerWebviewPanel('bad-file-panel', {
          title: 'Bad',
          source: { type: 'file', path: './index.html', localResourceRoots: [root] }
        })
      ).toThrow('outside localResourceRoots')
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  /** 验证空 localResourceRoots 会像 VS Code 一样禁用本地资源。 */
  it('desktop webview panel 支持用空 localResourceRoots 禁用本地资源', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'desktop-webview-'))
    try {
      writeFileSync(path.join(root, 'panel.js'), "console.log('local')", 'utf8')
      writeFileSync(path.join(root, 'index.html'), '<script src="./panel.js"></script>', 'utf8')
      const bridge = new ExtensionUiBridge('thread-1', () => {}, root)
      const desktop = bridge.createDesktopContext()

      expect(() =>
        desktop.registerWebviewPanel('no-local-resources', {
          title: 'No Local Resources',
          source: { type: 'file', path: './index.html', localResourceRoots: [] }
        })
      ).toThrow('outside localResourceRoots')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  /** 验证 symlink 不能绕过 localResourceRoots。 */
  it('desktop webview panel 拒绝 symlink 指向 localResourceRoots 外的资源', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'desktop-webview-'))
    const outside = mkdtempSync(path.join(tmpdir(), 'desktop-webview-outside-'))
    try {
      writeFileSync(path.join(outside, 'secret.js'), "console.log('secret')", 'utf8')
      symlinkSync(path.join(outside, 'secret.js'), path.join(root, 'linked-secret.js'))
      writeFileSync(
        path.join(root, 'index.html'),
        '<script src="./linked-secret.js"></script>',
        'utf8'
      )
      const bridge = new ExtensionUiBridge('thread-1', () => {}, root)
      const desktop = bridge.createDesktopContext()

      expect(() =>
        desktop.registerWebviewPanel('symlink-panel', {
          title: 'Symlink',
          source: { type: 'file', path: './index.html', localResourceRoots: [root] }
        })
      ).toThrow('outside localResourceRoots')
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  /** 验证 asWebviewUri 生成受 localResourceRoots 约束的 webview 资源 URI。 */
  it('desktop webview panel 支持 asWebviewUri', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'desktop-webview-uri-'))
    try {
      writeFileSync(
        path.join(root, 'icon.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        'utf8'
      )
      const events: WorkerEventEnvelope[] = []
      const bridge = new ExtensionUiBridge('thread-1', (event) => events.push(event), root)
      const desktop = bridge.createDesktopContext()

      const uri = desktop.asWebviewUri('./icon.svg', { localResourceRoots: [root] })

      expect(uri).toMatch(/^pi-webview-resource:\/\/[0-9a-f-]+$/)
      const event = events[0]
      if (
        event?.eventType !== 'projection' ||
        event.event.type !== 'extensionPanel.resourceRegistered'
      ) {
        throw new Error('resource registration projection is required')
      }
      expect(uri).toBe(`pi-webview-resource://${event.event.resource.token}`)
      expect(event.event.resource).toMatchObject({
        threadId: 'thread-1',
        path: path.join(root, 'icon.svg')
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  /** 验证 asWebviewUri 支持 host 内置 webview 样式资源。 */
  it('desktop webview panel 支持 host stylesheet URI', () => {
    const events: WorkerEventEnvelope[] = []
    const bridge = new ExtensionUiBridge('thread-1', (event) => events.push(event))
    const desktop = bridge.createDesktopContext()

    const uri = desktop.asWebviewUri(desktopWebviewHostStylesheetPath)

    expect(uri).toMatch(/^pi-webview-resource:\/\/[0-9a-f-]+$/)
    const event = events[0]
    if (
      event?.eventType !== 'projection' ||
      event.event.type !== 'extensionPanel.resourceRegistered'
    ) {
      throw new Error('resource registration projection is required')
    }
    expect(event.event.resource).toMatchObject({
      threadId: 'thread-1',
      contentType: 'text/css; charset=utf-8'
    })
    expect(event.event.resource.content).toContain('--pi-panel-scrollbar-thumb')
    expect(event.event.resource.content).toContain('scrollbar-width: thin')
    expect(event.event.resource.path).toBeUndefined()
  })

  /** 验证 asWebviewUri 不允许读取 localResourceRoots 外的资源。 */
  it('desktop webview panel 的 asWebviewUri 拒绝越界资源', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'desktop-webview-uri-'))
    const outside = mkdtempSync(path.join(tmpdir(), 'desktop-webview-uri-outside-'))
    try {
      writeFileSync(
        path.join(root, 'local.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        'utf8'
      )
      writeFileSync(
        path.join(outside, 'secret.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        'utf8'
      )
      const bridge = new ExtensionUiBridge('thread-1', () => {}, root)
      const desktop = bridge.createDesktopContext()

      expect(() =>
        desktop.asWebviewUri(path.join(outside, 'secret.svg'), { localResourceRoots: [root] })
      ).toThrow('outside localResourceRoots')
      expect(() => desktop.asWebviewUri('./local.svg', { localResourceRoots: [] })).toThrow(
        'outside localResourceRoots'
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  /** 验证编辑器文本同步缓存支持同步读取。 */
  it('编辑器文本同步缓存支持 getEditorText', () => {
    const bridge = new ExtensionUiBridge('thread-1', () => {})
    const ui = bridge.createContext()

    bridge.syncEditorText('from renderer')
    expect(ui.getEditorText()).toBe('from renderer')

    ui.setEditorText('from extension')
    expect(ui.getEditorText()).toBe('from extension')
  })
})
