/**
 * 本文件测试 Desktop 全局 Pi agent 设置服务。
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentSettingsService } from '../agent-settings-service'

const tempDirs: string[] = []

describe('AgentSettingsService', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('通过 SettingsManager 写入 Pi-compatible settings.json', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const service = new AgentSettingsService({
      agentDir,
      cwd: dir
    })

    const snapshot = await service.updateAgentSettings({
      delivery: {
        steeringMode: 'all',
        followUpMode: 'one-at-a-time',
        transport: 'websocket'
      },
      runtime: {
        compactionEnabled: false,
        compactionReserveTokens: 12000,
        compactionKeepRecentTokens: 8000,
        branchSummaryReserveTokens: 9000,
        branchSummarySkipPrompt: true,
        retryEnabled: false,
        retryMaxRetries: 2,
        retryBaseDelayMs: 500,
        providerRetryTimeoutMs: 60000,
        providerRetryMaxRetries: 1,
        providerRetryMaxRetryDelayMs: 30000,
        httpIdleTimeoutMs: 120000,
        websocketConnectTimeoutMs: 7000
      },
      display: {
        theme: 'minimal',
        quietStartup: true,
        collapseChangelog: true,
        hideThinkingBlock: true,
        doubleEscapeAction: 'fork',
        treeFilterMode: 'user-only',
        showHardwareCursor: true,
        editorPaddingX: 2,
        autocompleteMaxVisible: 12
      },
      safety: {
        defaultProjectTrust: 'never',
        enableInstallTelemetry: false,
        enableAnalytics: true,
        enableSkillCommands: false,
        warnAnthropicExtraUsage: false,
        httpProxy: 'http://127.0.0.1:7890'
      },
      media: {
        imageAutoResize: false,
        blockImages: true,
        showImages: false,
        imageWidthCells: 72,
        clearOnShrink: true,
        showTerminalProgress: true
      },
      resources: {
        packages: ['@scope/pi-pack'],
        extensions: ['~/pi/extensions/local.ts'],
        skills: ['~/pi/skills'],
        prompts: ['~/pi/prompts'],
        themes: ['~/pi/themes']
      },
      shell: {
        shellPath: '/bin/zsh',
        shellCommandPrefix: 'source ~/.aliases',
        npmCommand: ['mise', 'exec', 'node@20', '--', 'npm'],
        sessionDir: '~/pi-sessions'
      },
      advanced: {
        thinkingBudgets: {
          minimal: 1024,
          low: 4096,
          medium: 8192,
          high: 16384
        },
        codeBlockIndent: '    '
      }
    })

    expect(snapshot.delivery.transport).toBe('websocket')
    expect(snapshot.runtime.compactionEnabled).toBe(false)
    expect(snapshot.safety.defaultProjectTrust).toBe('never')
    expect(snapshot.media.blockImages).toBe(true)

    const settings = JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf-8'))
    expect(settings).toMatchObject({
      steeringMode: 'all',
      followUpMode: 'one-at-a-time',
      transport: 'websocket',
      compaction: { enabled: false, reserveTokens: 12000, keepRecentTokens: 8000 },
      branchSummary: { reserveTokens: 9000, skipPrompt: true },
      retry: {
        enabled: false,
        maxRetries: 2,
        baseDelayMs: 500,
        provider: {
          timeoutMs: 60000,
          maxRetries: 1,
          maxRetryDelayMs: 30000
        }
      },
      httpIdleTimeoutMs: 120000,
      websocketConnectTimeoutMs: 7000,
      theme: 'minimal',
      quietStartup: true,
      collapseChangelog: true,
      hideThinkingBlock: true,
      doubleEscapeAction: 'fork',
      treeFilterMode: 'user-only',
      showHardwareCursor: true,
      editorPaddingX: 2,
      autocompleteMaxVisible: 12,
      defaultProjectTrust: 'never',
      enableInstallTelemetry: false,
      enableAnalytics: true,
      enableSkillCommands: false,
      httpProxy: 'http://127.0.0.1:7890',
      warnings: {
        anthropicExtraUsage: false
      },
      thinkingBudgets: {
        minimal: 1024,
        low: 4096,
        medium: 8192,
        high: 16384
      },
      markdown: {
        codeBlockIndent: '    '
      },
      images: {
        autoResize: false,
        blockImages: true
      },
      terminal: {
        showImages: false,
        imageWidthCells: 72,
        clearOnShrink: true,
        showTerminalProgress: true
      },
      packages: ['@scope/pi-pack'],
      extensions: ['~/pi/extensions/local.ts'],
      skills: ['~/pi/skills'],
      prompts: ['~/pi/prompts'],
      themes: ['~/pi/themes'],
      shellPath: '/bin/zsh',
      shellCommandPrefix: 'source ~/.aliases',
      npmCommand: ['mise', 'exec', 'node@20', '--', 'npm'],
      sessionDir: '~/pi-sessions'
    })
  })

  it('支持按配置域局部保存，不覆盖其它配置域', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const service = new AgentSettingsService({
      agentDir,
      cwd: dir
    })

    await service.updateAgentSettings({
      delivery: {
        steeringMode: 'all',
        followUpMode: 'all',
        transport: 'sse'
      }
    })

    const snapshot = await service.updateAgentSettings({
      media: {
        imageAutoResize: false,
        blockImages: true,
        showImages: false,
        imageWidthCells: 80,
        clearOnShrink: true,
        showTerminalProgress: true
      }
    })

    expect(snapshot.delivery).toMatchObject({
      steeringMode: 'all',
      followUpMode: 'all',
      transport: 'sse'
    })
    expect(snapshot.media).toMatchObject({
      imageAutoResize: false,
      blockImages: true,
      showImages: false,
      imageWidthCells: 80,
      clearOnShrink: true,
      showTerminalProgress: true
    })
  })
})

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meta-agent-agent-settings-'))
  tempDirs.push(dir)
  return dir
}
