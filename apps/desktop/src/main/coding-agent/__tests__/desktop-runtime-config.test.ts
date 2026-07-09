/**
 * 本文件测试 Desktop-only runtime 配置。
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readDesktopRuntimeConfig, writeDesktopRuntimeConfig } from '../desktop-runtime-config'

const tempDirs: string[] = []

describe('desktop-runtime-config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('无配置文件时默认使用 Node sidecar', () => {
    const dir = createTempDir()

    expect(readDesktopRuntimeConfig(join(dir, 'desktop-runtime.json'))).toEqual({
      workerMode: 'nodeSidecar'
    })
  })

  it('显式配置 utilityProcess 时保留兼容模式', () => {
    const dir = createTempDir()
    const configPath = join(dir, 'desktop-runtime.json')

    expect(writeDesktopRuntimeConfig({ workerMode: 'utilityProcess' }, configPath)).toEqual({
      workerMode: 'utilityProcess'
    })
    expect(readDesktopRuntimeConfig(configPath)).toEqual({
      workerMode: 'utilityProcess'
    })
  })

  it('非法 worker mode 回退到 Node sidecar', () => {
    const dir = createTempDir()
    const configPath = join(dir, 'desktop-runtime.json')
    writeFileSync(configPath, JSON.stringify({ workerMode: 'electron' }))

    expect(readDesktopRuntimeConfig(configPath)).toEqual({
      workerMode: 'nodeSidecar'
    })
  })

  it('持久化 desktop UI 偏好并深合并更新', () => {
    const dir = createTempDir()
    const configPath = join(dir, 'desktop-runtime.json')

    expect(
      writeDesktopRuntimeConfig(
        { uiPreferences: { appearance: { uiFontSize: 15, codeFontSize: 16 } } },
        configPath
      )
    ).toEqual({
      workerMode: 'nodeSidecar',
      uiPreferences: {
        appearance: { uiFontSize: 15, codeFontSize: 16 }
      }
    })

    expect(
      writeDesktopRuntimeConfig({ uiPreferences: { workspace: { sidebarWidth: 260 } } }, configPath)
    ).toEqual({
      workerMode: 'nodeSidecar',
      uiPreferences: {
        appearance: { uiFontSize: 15, codeFontSize: 16 },
        workspace: { sidebarWidth: 260 }
      }
    })
  })

  it('环境变量可覆盖为 utilityProcess', () => {
    const dir = createTempDir()
    vi.stubEnv('CODING_AGENT_WORKER_MODE', 'utilityProcess')

    expect(readDesktopRuntimeConfig(join(dir, 'desktop-runtime.json'))).toEqual({
      workerMode: 'utilityProcess'
    })
  })
})

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meta-agent-desktop-runtime-'))
  tempDirs.push(dir)
  return dir
}
