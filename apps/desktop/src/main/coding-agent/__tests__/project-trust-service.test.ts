/**
 * 验证 Desktop Project trust 与 Pi core trust store 的一致语义。
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ProjectTrustStore } from '@coding-agent-src/core/trust-manager'
import type { ProjectSummary } from '@shared/coding-agent/types'
import { describe, expect, it } from 'vitest'
import { ProjectTrustService } from '../project-trust-service'

describe('ProjectTrustService', () => {
  it('在一次 setMany 事务中信任父目录并删除子目录覆盖', () => {
    const root = join(tmpdir(), `desktop-project-trust-${crypto.randomUUID()}`)
    const agentDir = join(root, 'agent')
    const parent = join(root, 'workspace')
    const projectPath = join(parent, 'project')
    mkdirSync(join(projectPath, '.pi'), { recursive: true })
    writeFileSync(join(projectPath, '.pi', 'settings.json'), '{}\n')
    const store = new ProjectTrustStore(agentDir)
    store.set(projectPath, false)
    const service = new ProjectTrustService(agentDir)
    const project: ProjectSummary = {
      projectId: 'project-a',
      name: 'project',
      path: projectPath,
      status: 'available',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z'
    }

    service.setProjectTrust(project, 'trustParent')

    expect(service.decorateProject(project).trust).toMatchObject({
      state: 'trusted',
      savedPath: resolve(parent)
    })
    expect(store.getEntry(projectPath)).toEqual({ path: resolve(parent), decision: true })
    const persisted = JSON.parse(readFileSync(join(agentDir, 'trust.json'), 'utf8'))
    expect(persisted[resolve(parent)]).toBe(true)
    expect(persisted[resolve(projectPath)]).toBeUndefined()
    rmSync(root, { recursive: true, force: true })
  })
})
