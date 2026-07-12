import { mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OpenChangedFileInput, ThreadSnapshot } from '@shared/coding-agent/types'
import {
  ChangedFileTargetError,
  launchChangedFile,
  resolveChangedFileTarget
} from '../changed-file-target'

const roots: string[] = []

async function fixture(): Promise<{ root: string; workspace: string; outside: string }> {
  const root = join(tmpdir(), `changed-file-${crypto.randomUUID()}`)
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside')
  await mkdir(join(workspace, 'src'), { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(join(workspace, 'src', 'app.ts'), 'export {}')
  await writeFile(join(workspace, 'other.ts'), 'other')
  await writeFile(join(outside, 'secret.ts'), 'secret')
  roots.push(root)
  return { root, workspace, outside }
}

function snapshot(cwd: string, path = 'src/app.ts'): Pick<ThreadSnapshot, 'cwd' | 'fileChanges'> {
  return {
    cwd,
    fileChanges: [
      {
        threadId: 'thread-a',
        path,
        changeType: 'updated' as const,
        additions: 1,
        deletions: 0,
        createdAt: '2026-07-12T00:00:00.000Z'
      }
    ]
  }
}

function input(
  changePath = 'src/app.ts',
  action: 'open' | 'reveal' = 'open'
): OpenChangedFileInput {
  return { threadId: 'thread-a', changePath, action }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('changed file target security', () => {
  it('registers a thread-scoped IPC handler backed by a trusted snapshot', async () => {
    const ipcSource = await readFile(join(__dirname, '..', 'ipc.ts'), 'utf8')
    expect(ipcSource).toContain('codingAgentChannels.openChangedFile')
    expect(ipcSource).toContain('launchChangedFile(await manager.getSnapshot(input.threadId)')
  })

  it('resolves a snapshot change relative to trusted cwd', async () => {
    const { workspace } = await fixture()
    const result = await resolveChangedFileTarget(snapshot(workspace), input())
    expect(result.path).toBe(await realpath(join(workspace, 'src', 'app.ts')))
    expect(result.revealDirectory).toBe(false)
  })

  it('rejects traversal, outside absolute paths, and files absent from snapshot changes', async () => {
    const { workspace, outside } = await fixture()
    await expect(
      resolveChangedFileTarget(
        snapshot(workspace, '../outside/secret.ts'),
        input('../outside/secret.ts')
      )
    ).rejects.toMatchObject({ code: 'OUTSIDE_WORKSPACE' })
    await expect(
      resolveChangedFileTarget(
        snapshot(workspace, join(outside, 'secret.ts')),
        input(join(outside, 'secret.ts'))
      )
    ).rejects.toMatchObject({ code: 'OUTSIDE_WORKSPACE' })
    await expect(
      resolveChangedFileTarget(snapshot(workspace), input('other.ts'))
    ).rejects.toMatchObject({
      code: 'NOT_IN_CHANGES'
    })
  })

  it('rejects a workspace symlink that escapes cwd', async () => {
    const { workspace, outside } = await fixture()
    await symlink(join(outside, 'secret.ts'), join(workspace, 'src', 'link.ts'))
    await expect(
      resolveChangedFileTarget(snapshot(workspace, 'src/link.ts'), input('src/link.ts'))
    ).rejects.toMatchObject({ code: 'OUTSIDE_WORKSPACE' })
  })

  it('rejects invalid input and missing cwd', async () => {
    const { workspace } = await fixture()
    await expect(
      resolveChangedFileTarget(snapshot(workspace, ''), input(''))
    ).rejects.toBeInstanceOf(ChangedFileTargetError)
    await expect(
      resolveChangedFileTarget({ cwd: '', fileChanges: snapshot(workspace).fileChanges }, input())
    ).rejects.toMatchObject({ code: 'MISSING_CWD' })
  })

  it('requires open target to be a file and reveals a deleted change through its safe parent', async () => {
    const { workspace } = await fixture()
    await expect(
      resolveChangedFileTarget(snapshot(workspace, 'src/missing.ts'), input('src/missing.ts'))
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const reveal = await resolveChangedFileTarget(
      snapshot(workspace, 'src/missing.ts'),
      input('src/missing.ts', 'reveal')
    )
    expect(reveal).toMatchObject({
      path: await realpath(join(workspace, 'src')),
      revealDirectory: true
    })
  })

  it('maps shell open failures and uses reveal without URI or command execution', async () => {
    const { workspace, outside } = await fixture()
    const shell = {
      openPath: vi.fn().mockResolvedValue('no default app'),
      showItemInFolder: vi.fn()
    }
    await expect(launchChangedFile(snapshot(workspace), input(), shell)).rejects.toMatchObject({
      code: 'OPEN_FAILED'
    })
    expect(shell.openPath).toHaveBeenCalledWith(await realpath(join(workspace, 'src', 'app.ts')))
    expect(shell.showItemInFolder).not.toHaveBeenCalled()

    shell.openPath.mockRejectedValueOnce(new Error(`private path: ${outside}`))
    await expect(launchChangedFile(snapshot(workspace), input(), shell)).rejects.toEqual(
      new ChangedFileTargetError('OPEN_FAILED')
    )
  })
})
