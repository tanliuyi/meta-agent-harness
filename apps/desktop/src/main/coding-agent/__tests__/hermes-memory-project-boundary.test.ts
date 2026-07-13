/**
 * 验证 Hermes Memory 的 Project 上下文只由 Electron main 解析。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  HermesMemoryMutationInput,
  HermesMemorySnapshot,
  HermesMemorySnapshotInput
} from '@shared/coding-agent/types'
import type { AgentSettingsService } from '../agent-settings-service'
import { ProjectStore } from '../project-store'
import { ProjectTrustService } from '../project-trust-service'
import { CodingThreadManager } from '../thread-manager'
import type { ThreadWorkerRegistry } from '../thread-worker-registry'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Hermes Memory Project boundary', () => {
  it('忽略 renderer 注入的 cwd，并由 ProjectStore 解析读取上下文', async () => {
    const fixture = createFixture()
    const input = {
      projectId: fixture.project.projectId,
      cwd: fixture.attackerCwd
    } as unknown as HermesMemorySnapshotInput

    await fixture.manager.getHermesMemorySnapshot(input)

    expect(fixture.getSnapshot).toHaveBeenCalledWith({
      projectId: fixture.project.projectId,
      cwd: fixture.project.path,
      projectTrusted: false
    })
    expect(fixture.getSnapshot).not.toHaveBeenCalledWith(
      expect.objectContaining({ cwd: fixture.attackerCwd })
    )
    await expect(
      fixture.manager.getHermesMemorySnapshot({ projectId: 'missing-project' })
    ).rejects.toThrow('project not found')

    await fixture.manager.getHermesMemorySnapshot()
    expect(fixture.getSnapshot).toHaveBeenLastCalledWith(undefined)
  })

  it('保留全局写入，并拒绝缺失或不可信 Project 的项目写入', async () => {
    const fixture = createFixture()

    await fixture.manager.mutateHermesMemory({
      operation: 'add',
      target: 'memory',
      content: 'global memory'
    })
    expect(fixture.mutateMemory).toHaveBeenLastCalledWith(
      { operation: 'add', target: 'memory', content: 'global memory' },
      undefined
    )

    await fixture.manager.mutateHermesMemory({
      projectId: fixture.project.projectId,
      operation: 'add',
      target: 'memory',
      content: 'global memory with project context'
    })
    expect(fixture.mutateMemory).toHaveBeenLastCalledWith(
      {
        operation: 'add',
        target: 'memory',
        content: 'global memory with project context'
      },
      {
        projectId: fixture.project.projectId,
        cwd: fixture.project.path,
        projectTrusted: false
      }
    )

    await expect(
      fixture.manager.mutateHermesMemory({
        operation: 'add',
        target: 'project',
        content: 'missing project'
      })
    ).rejects.toThrow('需要 projectId')
    await expect(
      fixture.manager.mutateHermesMemory({
        projectId: 'missing-project',
        operation: 'add',
        target: 'project',
        content: 'unknown project'
      })
    ).rejects.toThrow('project not found')
    await expect(
      fixture.manager.mutateHermesMemory({
        projectId: fixture.project.projectId,
        operation: 'add',
        target: 'project',
        content: 'untrusted project'
      })
    ).rejects.toThrow('Project 未受信任')

    fixture.trustService.setProjectTrust(fixture.project, 'trustProject')
    const injectedInput = {
      projectId: fixture.project.projectId,
      cwd: fixture.attackerCwd,
      operation: 'add',
      target: 'project',
      content: 'trusted project'
    } as unknown as HermesMemoryMutationInput
    await fixture.manager.mutateHermesMemory(injectedInput)
    expect(fixture.mutateMemory).toHaveBeenLastCalledWith(
      { operation: 'add', target: 'project', content: 'trusted project' },
      {
        projectId: fixture.project.projectId,
        cwd: fixture.project.path,
        projectTrusted: true
      }
    )
    expect(fixture.mutateMemory).not.toHaveBeenCalledWith(
      expect.objectContaining({ cwd: fixture.attackerCwd }),
      expect.anything()
    )
  })
})

function createFixture(): {
  manager: CodingThreadManager
  project: ReturnType<ProjectStore['createProject']>
  trustService: ProjectTrustService
  attackerCwd: string
  getSnapshot: ReturnType<typeof vi.fn>
  mutateMemory: ReturnType<typeof vi.fn>
} {
  const root = mkdtempSync(join(tmpdir(), 'desktop-hermes-boundary-'))
  tempDirs.push(root)
  const agentDir = join(root, 'agent')
  const projectCwd = join(root, 'project')
  const attackerCwd = join(root, 'attacker')
  mkdirSync(join(projectCwd, '.pi'), { recursive: true })
  mkdirSync(attackerCwd, { recursive: true })
  writeFileSync(join(projectCwd, '.pi', 'settings.json'), '{}\n')

  const projectStore = new ProjectStore(':memory:')
  const project = projectStore.createProject({ path: projectCwd })
  const trustService = new ProjectTrustService(agentDir)
  const snapshot: HermesMemorySnapshot = {
    type: 'hermes.snapshot',
    project: null,
    entries: { memory: [], user: [], project: [], failure: [] },
    skills: [],
    limits: { memory: 1, user: 1, project: 1 }
  }
  const getSnapshot = vi.fn().mockResolvedValue(snapshot)
  const mutateMemory = vi.fn().mockResolvedValue(snapshot)
  const settingsService = {
    getHermesMemorySnapshot: getSnapshot,
    mutateHermesMemory: mutateMemory
  } as unknown as AgentSettingsService
  const manager = new CodingThreadManager(
    { listLeases: () => [] } as unknown as ThreadWorkerRegistry,
    undefined,
    projectStore,
    trustService,
    undefined,
    settingsService
  )

  return { manager, project, trustService, attackerCwd, getSnapshot, mutateMemory }
}
