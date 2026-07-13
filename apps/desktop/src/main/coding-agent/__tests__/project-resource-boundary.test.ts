/**
 * 验证 renderer 的 projectId 必须经 main ProjectStore/trust 边界解析。
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AgentSettingsService } from '../agent-settings-service'
import { ProjectStore } from '../project-store'
import { ProjectTrustService } from '../project-trust-service'
import { CodingThreadManager } from '../thread-manager'
import { CodingThreadStore } from '../thread-store'
import type { ThreadWorkerRegistry } from '../thread-worker-registry'

describe('project resource boundary', () => {
  it('只使用 ProjectStore 中的 cwd，并在写入前校验 main trust', async () => {
    const root = join(tmpdir(), `desktop-project-resource-${crypto.randomUUID()}`)
    const agentDir = join(root, 'agent')
    const globalCwd = join(root, 'desktop-global')
    const projectCwd = join(root, 'project')
    mkdirSync(join(projectCwd, '.pi'), { recursive: true })
    mkdirSync(globalCwd, { recursive: true })
    writeFileSync(join(projectCwd, '.pi', 'settings.json'), '{}\n')
    const projectStore = new ProjectStore(':memory:')
    const threadStore = new CodingThreadStore(':memory:')
    const trustService = new ProjectTrustService(agentDir)
    const settingsService = new AgentSettingsService({ agentDir, cwd: globalCwd })
    const manager = new CodingThreadManager(
      { listLeases: () => [] } as unknown as ThreadWorkerRegistry,
      threadStore,
      projectStore,
      trustService,
      undefined,
      settingsService
    )
    const project = projectStore.createProject({ path: projectCwd })

    await expect(
      manager.updateProjectExtensionPaths({
        projectId: project.projectId,
        extensions: ['extension.ts']
      })
    ).rejects.toThrow('Project 未受信任')
    expect(existsSync(join(projectCwd, '.pi', 'settings.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(projectCwd, '.pi', 'settings.json'), 'utf8'))).toEqual({})

    trustService.setProjectTrust(project, 'trustProject')
    await manager.updateProjectExtensionPaths({
      projectId: project.projectId,
      extensions: ['extension.ts']
    })
    expect(JSON.parse(readFileSync(join(projectCwd, '.pi', 'settings.json'), 'utf8'))).toEqual({
      extensions: ['extension.ts']
    })
    await expect(
      manager.updateProjectExtensionPaths({
        projectId: 'missing-project',
        extensions: ['outside.ts']
      })
    ).rejects.toThrow('project not found')

    threadStore.close()
    projectStore.close()
    rmSync(root, { recursive: true, force: true })
  })
})
