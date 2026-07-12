/**
 * 本文件测试 Desktop 全局 Pi agent 设置服务。
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectProject } from '@meta-agent/hermes-memory/project.js'
import { AgentSettingsService } from '../agent-settings-service'

const tempDirs: string[] = []

describe('AgentSettingsService', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('资源快照包含 Desktop 内置 Hermes Memory 扩展的技能', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const skillDir = join(agentDir, 'pi-hermes-memory', 'skills', 'review-memory')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: review-memory\ndescription: Review durable memory\n---\n\n# Review Memory\n'
    )
    const projectDir = join(dir, 'project')
    mkdirSync(projectDir, { recursive: true })
    const projectId = detectProject(undefined, projectDir).id
    const projectSkillDir = join(
      agentDir,
      'projects-memory',
      projectId!,
      'skills',
      'project-review'
    )
    mkdirSync(projectSkillDir, { recursive: true })
    writeFileSync(
      join(projectSkillDir, 'SKILL.md'),
      '---\nname: project-review\ndescription: Review this project\n---\n\n# Project Review\n'
    )
    const service = new AgentSettingsService({ agentDir, cwd: dir })

    const snapshot = await service.getResourceSnapshot({ cwd: projectDir, projectTrusted: true })

    expect(snapshot.skillCommands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'skill:review-memory',
          description: 'Review durable memory',
          source: 'skill',
          sourceInfo: expect.objectContaining({
            path: join(skillDir, 'SKILL.md'),
            source: '@meta-agent/hermes-memory',
            scope: 'user'
          })
        }),
        expect.objectContaining({
          name: 'skill:project-review',
          description: 'Review this project',
          sourceInfo: expect.objectContaining({
            path: join(projectSkillDir, 'SKILL.md'),
            source: '@meta-agent/hermes-memory',
            scope: 'project'
          })
        })
      ])
    )
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

  it('将 Desktop worker 模式保存到 desktop-local runtime config', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const desktopRuntimeConfigPath = join(dir, 'desktop-runtime.json')
    const service = new AgentSettingsService({
      agentDir,
      cwd: dir,
      desktopRuntimeConfigPath
    })

    const snapshot = await service.updateAgentSettings({
      runtime: {
        workerMode: 'nodeSidecar',
        nodeSidecarExecPath: '/opt/node/bin/node'
      }
    })

    expect(snapshot.runtime.workerMode).toBe('nodeSidecar')
    expect(snapshot.runtime.nodeSidecarExecPath).toBe('/opt/node/bin/node')
    expect(JSON.parse(readFileSync(desktopRuntimeConfigPath, 'utf-8'))).toEqual({
      workerMode: 'nodeSidecar',
      nodeSidecarExecPath: '/opt/node/bin/node'
    })
    if (existsSync(join(agentDir, 'settings.json'))) {
      const settings = JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf-8'))
      expect(settings.workerMode).toBeUndefined()
      expect(settings.nodeSidecarExecPath).toBeUndefined()
    }
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

  it('通过 Pi package manager projection 管理 package source', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const service = new AgentSettingsService({
      agentDir,
      cwd: dir
    })

    const added = await service.addResourcePackage({
      source: 'npm:desktop-ext@latest'
    })

    expect(added).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'npm:desktop-ext@latest',
          scope: 'user'
        })
      ])
    )
    expect(JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf-8'))).toMatchObject({
      packages: ['npm:desktop-ext@latest']
    })

    const removed = await service.removeResourcePackage({
      source: 'npm:desktop-ext@latest'
    })

    expect(removed.find((item) => item.source === 'npm:desktop-ext@latest')).toBeUndefined()
  })

  it('通过 Pi core resource snapshot 暴露已发现 extension command', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const extensionPath = join(dir, 'hello.ts')
    writeFileSync(
      extensionPath,
      `
export default function(pi) {
  pi.registerCommand("hello", { description: "Say hello", handler() {} });
}
`
    )
    const service = new AgentSettingsService({
      agentDir,
      cwd: dir
    })

    await service.updateAgentSettings({
      resources: {
        extensions: [extensionPath]
      }
    })
    const snapshot = await service.getResourceSnapshot()

    expect(snapshot.resources.extensions).toEqual([
      expect.objectContaining({
        path: extensionPath,
        enabled: true
      })
    ])
    expect(snapshot.extensions).toEqual([
      expect.objectContaining({
        path: extensionPath,
        commands: [expect.objectContaining({ name: 'hello', description: 'Say hello' })]
      })
    ])
  })

  it('为 desktop 新会话候选派生 skill command 描述', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const skillDir = join(dir, 'skills', 'review')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: review
description: Review staged changes
---

Use this skill to review code.
`
    )
    const service = new AgentSettingsService({
      agentDir,
      cwd: dir
    })

    await service.updateAgentSettings({
      resources: {
        skills: [skillDir]
      }
    })
    const snapshot = await service.getResourceSnapshot()

    expect(snapshot.skillCommands).toEqual([
      expect.objectContaining({
        name: 'skill:review',
        description: 'Review staged changes',
        source: 'skill'
      })
    ])
  })

  it('按传入 cwd 和 project trust 构建项目视角 resource snapshot', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const globalCwd = join(dir, 'global-cwd')
    const projectCwd = join(dir, 'project')
    const projectConfigDir = join(projectCwd, '.pi')
    const extensionPath = join(projectCwd, 'project-extension.ts')
    mkdirSync(globalCwd, { recursive: true })
    mkdirSync(projectConfigDir, { recursive: true })
    writeFileSync(
      extensionPath,
      `
export default function(pi) {
  pi.registerCommand("project-only", { description: "Project command", handler() {} });
}
`
    )
    writeFileSync(
      join(projectConfigDir, 'settings.json'),
      `${JSON.stringify({ extensions: [extensionPath] }, null, 2)}\n`
    )
    const service = new AgentSettingsService({
      agentDir,
      cwd: globalCwd
    })

    const untrusted = await service.getResourceSnapshot({
      cwd: projectCwd,
      projectTrusted: false
    })
    const trusted = await service.getResourceSnapshot({
      cwd: projectCwd,
      projectTrusted: true
    })

    expect(untrusted.extensions).toEqual([])
    expect(trusted.extensions).toEqual([
      expect.objectContaining({
        path: extensionPath,
        commands: [expect.objectContaining({ name: 'project-only' })]
      })
    ])
  })

  it('更新项目级 extension 路径时只写入项目 .pi/settings.json', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const globalCwd = join(dir, 'global-cwd')
    const projectCwd = join(dir, 'project')
    const extensionPath = join(projectCwd, 'project-extension.ts')
    mkdirSync(globalCwd, { recursive: true })
    mkdirSync(projectCwd, { recursive: true })
    writeFileSync(
      extensionPath,
      `
export default function(pi) {
  pi.registerCommand("project-disabled", { handler() {} });
}
`
    )
    const service = new AgentSettingsService({
      agentDir,
      cwd: globalCwd
    })

    const saved = await service.updateProjectExtensionPaths({
      cwd: projectCwd,
      extensions: [extensionPath, `-${extensionPath}`]
    })
    const snapshot = await service.getResourceSnapshot({
      cwd: projectCwd,
      projectTrusted: true
    })

    expect(saved).toEqual([extensionPath, `-${extensionPath}`])
    expect(JSON.parse(readFileSync(join(projectCwd, '.pi', 'settings.json'), 'utf-8'))).toEqual({
      extensions: [extensionPath, `-${extensionPath}`]
    })
    expect(existsSync(join(agentDir, 'settings.json'))).toBe(false)
    expect(snapshot.resources.extensions).toEqual([
      expect.objectContaining({
        path: extensionPath,
        enabled: false,
        sourceInfo: expect.objectContaining({
          scope: 'project',
          origin: 'top-level'
        })
      })
    ])
    expect(snapshot.extensions).toEqual([])
  })

  it('安装 package source 时转发 package manager 进度', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const localPackage = join(dir, 'local-package')
    mkdirSync(localPackage)
    const service = new AgentSettingsService({
      agentDir,
      cwd: dir
    })
    const events: Array<{ type: string; action: string; source: string }> = []

    const packages = await service.installResourcePackage({ source: localPackage }, (event) =>
      events.push(event)
    )

    expect(events).toEqual([
      expect.objectContaining({ type: 'start', action: 'install', source: localPackage }),
      expect.objectContaining({ type: 'complete', action: 'install', source: localPackage })
    ])
    expect(packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: 'user',
          installedPath: localPackage
        })
      ])
    )
  })

  it('串行执行 package 安装，避免共享进度回调被并发覆盖', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const service = new AgentSettingsService({
      agentDir,
      cwd: dir
    })
    const packageManager = (
      service as unknown as {
        packageManager: {
          installAndPersist(source: string): Promise<void>
          listConfiguredPackages(): Array<{
            source: string
            scope: 'user' | 'project'
            filtered: boolean
            installedPath?: string
          }>
        }
      }
    ).packageManager
    const originalInstallAndPersist = packageManager.installAndPersist.bind(packageManager)
    const originalListConfiguredPackages =
      packageManager.listConfiguredPackages.bind(packageManager)
    let active = 0
    let maxActive = 0
    const order: string[] = []
    let resolveFirstStarted!: () => void
    let releaseFirst!: () => void
    const firstStarted = new Promise<void>((resolve) => {
      resolveFirstStarted = resolve
    })
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    packageManager.installAndPersist = async (source: string): Promise<void> => {
      active += 1
      maxActive = Math.max(maxActive, active)
      order.push(`start:${source}`)
      if (source === 'first-package') {
        resolveFirstStarted()
        await firstRelease
      }
      order.push(`end:${source}`)
      active -= 1
    }
    packageManager.listConfiguredPackages = () => []

    try {
      const first = service.installResourcePackage({ source: 'first-package' })
      await firstStarted
      const second = service.installResourcePackage({ source: 'second-package' })
      await new Promise((resolve) => setTimeout(resolve, 0))

      releaseFirst()
      await Promise.all([first, second])

      expect(maxActive).toBe(1)
      expect(order).toEqual([
        'start:first-package',
        'end:first-package',
        'start:second-package',
        'end:second-package'
      ])
    } finally {
      packageManager.installAndPersist = originalInstallAndPersist
      packageManager.listConfiguredPackages = originalListConfiguredPackages
    }
  })
})

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meta-agent-agent-settings-'))
  tempDirs.push(dir)
  return dir
}
