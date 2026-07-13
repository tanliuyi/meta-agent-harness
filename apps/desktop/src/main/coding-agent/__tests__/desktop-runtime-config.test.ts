/**
 * 本文件测试 Desktop-only runtime 配置。
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  onDesktopRuntimeConfigChanged,
  readDesktopRuntimeConfig,
  writeDesktopRuntimeConfig
} from '../desktop-runtime-config'

const tempDirs: string[] = []
const defaultCapabilityConfig = {
  browserCdpAccess: 'safe' as const,
  browserWebPermissions: 'prompt' as const,
  filesystemAccess: 'safe' as const,
  extensionUrlAccess: 'safe' as const,
  externalProtocolAccess: 'safe' as const
}

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
      workerMode: 'nodeSidecar',
      ...defaultCapabilityConfig
    })
  })

  it('显式配置 utilityProcess 时保留兼容模式', () => {
    const dir = createTempDir()
    const configPath = join(dir, 'desktop-runtime.json')

    expect(writeDesktopRuntimeConfig({ workerMode: 'utilityProcess' }, configPath)).toEqual({
      workerMode: 'utilityProcess',
      ...defaultCapabilityConfig
    })
    expect(readDesktopRuntimeConfig(configPath)).toEqual({
      workerMode: 'utilityProcess',
      ...defaultCapabilityConfig
    })
  })

  it('非法 worker mode 回退到 Node sidecar', () => {
    const dir = createTempDir()
    const configPath = join(dir, 'desktop-runtime.json')
    writeFileSync(configPath, JSON.stringify({ workerMode: 'electron' }))

    expect(readDesktopRuntimeConfig(configPath)).toEqual({
      workerMode: 'nodeSidecar',
      ...defaultCapabilityConfig
    })
  })

  it('持久化 desktop UI 偏好并深合并更新', () => {
    const dir = createTempDir()
    const configPath = join(dir, 'desktop-runtime.json')

    expect(
      writeDesktopRuntimeConfig(
        {
          uiPreferences: {
            appearance: {
              themeMode: 'light',
              uiFontSize: 15,
              codeFontSize: 16,
              showAvatars: false,
              density: 'compact',
              chatContentWidth: 'wide',
              messageTimeDisplay: 'always',
              wrapCode: true,
              toolExpansion: 'collapsed',
              sidebarDisplay: 'auto',
              markdownFontStyle: 'serif',
              motion: 'reduced',
              avatarStyle: 'circle',
              userMessageAlignment: 'left'
            }
          }
        },
        configPath
      )
    ).toEqual({
      workerMode: 'nodeSidecar',
      ...defaultCapabilityConfig,
      uiPreferences: {
        appearance: {
          themeMode: 'light',
          uiFontSize: 15,
          codeFontSize: 16,
          showAvatars: false,
          density: 'compact',
          chatContentWidth: 'wide',
          messageTimeDisplay: 'always',
          wrapCode: true,
          toolExpansion: 'collapsed',
          sidebarDisplay: 'auto',
          markdownFontStyle: 'serif',
          motion: 'reduced',
          avatarStyle: 'circle',
          userMessageAlignment: 'left'
        }
      }
    })

    expect(
      writeDesktopRuntimeConfig(
        { uiPreferences: { workspace: { sidebarWidth: 260, threadSortMode: 'threaded' } } },
        configPath
      )
    ).toEqual({
      workerMode: 'nodeSidecar',
      ...defaultCapabilityConfig,
      uiPreferences: {
        appearance: {
          themeMode: 'light',
          uiFontSize: 15,
          codeFontSize: 16,
          showAvatars: false,
          density: 'compact',
          chatContentWidth: 'wide',
          messageTimeDisplay: 'always',
          wrapCode: true,
          toolExpansion: 'collapsed',
          sidebarDisplay: 'auto',
          markdownFontStyle: 'serif',
          motion: 'reduced',
          avatarStyle: 'circle',
          userMessageAlignment: 'left'
        },
        workspace: { sidebarWidth: 260, threadSortMode: 'threaded' }
      }
    })
  })

  it('忽略非法主题模式', () => {
    const dir = createTempDir()
    const configPath = join(dir, 'desktop-runtime.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        workerMode: 'nodeSidecar',
        uiPreferences: {
          appearance: { themeMode: 'auto' },
          workspace: { threadSortMode: 'alphabetical' }
        }
      })
    )

    expect(readDesktopRuntimeConfig(configPath).uiPreferences).toEqual({})
  })

  it('持久化自定义字体配置', () => {
    const dir = createTempDir()
    const configPath = join(dir, 'desktop-runtime.json')

    expect(
      writeDesktopRuntimeConfig(
        {
          uiPreferences: {
            appearance: {
              customUiFontFamily: 'Inter, sans-serif',
              customCodeFontFamily: 'JetBrains Mono, monospace',
              markdownFontStyle: 'custom',
              customMarkdownFontFamily: 'Georgia, serif',
              activityDisplay: 'compact',
              activityIndicatorStyle: 'pulse',
              customActivityText: '正在构建'
            }
          }
        },
        configPath
      ).uiPreferences?.appearance
    ).toMatchObject({
      customUiFontFamily: 'Inter, sans-serif',
      customCodeFontFamily: 'JetBrains Mono, monospace',
      markdownFontStyle: 'custom',
      customMarkdownFontFamily: 'Georgia, serif',
      activityDisplay: 'compact',
      activityIndicatorStyle: 'pulse',
      customActivityText: '正在构建'
    })
  })

  it('环境变量可覆盖为 utilityProcess', () => {
    const dir = createTempDir()
    vi.stubEnv('CODING_AGENT_WORKER_MODE', 'utilityProcess')

    expect(readDesktopRuntimeConfig(join(dir, 'desktop-runtime.json'))).toEqual({
      workerMode: 'utilityProcess',
      ...defaultCapabilityConfig
    })
  })

  it('持久化 Desktop 专业能力配置并拒绝非法值', () => {
    const dir = createTempDir()
    const configPath = join(dir, 'desktop-runtime.json')

    expect(
      writeDesktopRuntimeConfig(
        {
          browserCdpAccess: 'full',
          browserWebPermissions: 'full',
          filesystemAccess: 'full',
          extensionUrlAccess: 'full',
          externalProtocolAccess: 'full'
        },
        configPath
      )
    ).toMatchObject({
      browserCdpAccess: 'full',
      browserWebPermissions: 'full',
      filesystemAccess: 'full',
      extensionUrlAccess: 'full',
      externalProtocolAccess: 'full'
    })
    writeFileSync(
      configPath,
      JSON.stringify({
        browserCdpAccess: 'unrestricted',
        browserWebPermissions: 'ask-every-time',
        filesystemAccess: 'unrestricted',
        extensionUrlAccess: 'unrestricted',
        externalProtocolAccess: 'unrestricted'
      })
    )
    expect(readDesktopRuntimeConfig(configPath)).toMatchObject(defaultCapabilityConfig)
  })

  it('环境变量可显式启用完整 Desktop 专业能力', () => {
    const dir = createTempDir()
    vi.stubEnv('CODING_AGENT_BROWSER_CDP_ACCESS', 'full')
    vi.stubEnv('CODING_AGENT_BROWSER_WEB_PERMISSIONS', 'full')
    vi.stubEnv('CODING_AGENT_FILESYSTEM_ACCESS', 'full')
    vi.stubEnv('CODING_AGENT_EXTENSION_URL_ACCESS', 'full')
    vi.stubEnv('CODING_AGENT_EXTERNAL_PROTOCOL_ACCESS', 'full')

    expect(readDesktopRuntimeConfig(join(dir, 'desktop-runtime.json'))).toMatchObject({
      browserCdpAccess: 'full',
      browserWebPermissions: 'full',
      filesystemAccess: 'full',
      extensionUrlAccess: 'full',
      externalProtocolAccess: 'full'
    })
  })

  it('在当前进程写入后通知能力控制器立即收紧边界', () => {
    const dir = createTempDir()
    const configPath = join(dir, 'desktop-runtime.json')
    const listener = vi.fn()
    const unsubscribe = onDesktopRuntimeConfigChanged(listener)

    writeDesktopRuntimeConfig({ browserCdpAccess: 'full' }, configPath)
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ browserCdpAccess: 'full' }),
      configPath
    )
    unsubscribe()
    writeDesktopRuntimeConfig({ browserCdpAccess: 'safe' }, configPath)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meta-agent-desktop-runtime-'))
  tempDirs.push(dir)
  return dir
}
