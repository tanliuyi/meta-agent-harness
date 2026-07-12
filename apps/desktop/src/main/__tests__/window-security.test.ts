/**
 * 本文件测试主窗口顶层导航 allowlist。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createMainWindowNavigationTarget, isMainWindowNavigationAllowed } from '../window-security'

describe('main window security', () => {
  it('dev 模式只允许 renderer dev server 同 origin 导航', () => {
    const target = createMainWindowNavigationTarget({
      devRendererUrl: 'http://localhost:5174/#/new',
      rendererIndexPath: path.join('out', 'renderer', 'index.html')
    })

    expect(isMainWindowNavigationAllowed('http://localhost:5174/#/new', target)).toBe(true)
    expect(isMainWindowNavigationAllowed('http://localhost:5174/settings', target)).toBe(true)
    expect(isMainWindowNavigationAllowed('http://127.0.0.1:5174/#/new', target)).toBe(false)
    expect(isMainWindowNavigationAllowed('https://example.com/', target)).toBe(false)
    expect(isMainWindowNavigationAllowed('file:///tmp/evil.html', target)).toBe(false)
  })

  it('生产模式只允许 renderer index 文件本身，hash 变化可通过', () => {
    const rendererIndexPath = path.resolve('out', 'renderer', 'index.html')
    const target = createMainWindowNavigationTarget({ rendererIndexPath })
    const rendererIndexUrl = pathToFileURL(rendererIndexPath).toString()

    expect(isMainWindowNavigationAllowed(`${rendererIndexUrl}#/new`, target)).toBe(true)
    expect(isMainWindowNavigationAllowed(`${rendererIndexUrl}#/settings`, target)).toBe(true)
    expect(
      isMainWindowNavigationAllowed(
        pathToFileURL(path.resolve('out', 'renderer', 'other.html')).toString(),
        target
      )
    ).toBe(false)
    expect(isMainWindowNavigationAllowed('https://example.com/', target)).toBe(false)
  })

  it('拒绝无效 dev renderer URL 协议', () => {
    expect(() =>
      createMainWindowNavigationTarget({
        devRendererUrl: 'file:///tmp/index.html',
        rendererIndexPath: path.join('out', 'renderer', 'index.html')
      })
    ).toThrow('Invalid dev renderer URL protocol')
  })

  it('限制主窗口最小尺寸，避免进入不可用布局', () => {
    const source = readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8')
    expect(source).toContain('width: 960')
    expect(source).toContain('height: 640')
    expect(source).toContain('minWidth: minimumWindowBounds.width')
    expect(source).toContain('minHeight: minimumWindowBounds.height')
  })
})
