/**
 * 本文件测试 preload 只暴露受控 named API，不暴露通用 Electron/IPC 对象。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('preload API surface', () => {
  it('只暴露 window.api，不暴露 electronAPI 或 ipcRenderer 原对象', () => {
    const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')
    const declarations = readFileSync(join(__dirname, '..', 'index.d.ts'), 'utf8')

    expect(source).not.toContain('electronAPI')
    expect(source).not.toContain("exposeInMainWorld('electron'")
    expect(source).not.toContain('window.electron')
    expect(declarations).not.toContain('electron: ElectronAPI')
    expect(declarations).not.toContain('ElectronAPI')
    expect(source).toContain("exposeInMainWorld('api', api)")
    expect(source).toContain('openChangedFile: (input) =>')
    expect(source).toContain('codingAgentChannels.openChangedFile')
  })
})
