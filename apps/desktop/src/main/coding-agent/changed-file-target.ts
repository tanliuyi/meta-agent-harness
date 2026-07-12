import { realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type {
  OpenChangedFileInput,
  OpenChangedFileResult,
  ThreadSnapshot
} from '@shared/coding-agent/types'

export type ChangedFileErrorCode =
  | 'INVALID_INPUT'
  | 'MISSING_CWD'
  | 'NOT_IN_CHANGES'
  | 'OUTSIDE_WORKSPACE'
  | 'NOT_FOUND'
  | 'OPEN_FAILED'

export class ChangedFileTargetError extends Error {
  constructor(readonly code: ChangedFileErrorCode) {
    super(code)
    this.name = 'ChangedFileTargetError'
  }
}

export interface ChangedFileTarget {
  action: OpenChangedFileInput['action']
  path: string
  revealDirectory: boolean
}

function isContained(root: string, target: string): boolean {
  const child = relative(root, target)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

async function nearestExistingPath(path: string): Promise<string> {
  let candidate = path
  while (true) {
    try {
      await stat(candidate)
      return candidate
    } catch {
      const parent = dirname(candidate)
      if (parent === candidate) {
        throw new ChangedFileTargetError('NOT_FOUND')
      }
      candidate = parent
    }
  }
}

export async function resolveChangedFileTarget(
  snapshot: Pick<ThreadSnapshot, 'cwd' | 'fileChanges'>,
  input: OpenChangedFileInput
): Promise<ChangedFileTarget> {
  const changePath = input.changePath
  if (
    !changePath?.trim() ||
    changePath.includes('\0') ||
    !['open', 'reveal'].includes(input.action)
  ) {
    throw new ChangedFileTargetError('INVALID_INPUT')
  }
  if (!snapshot.cwd) {
    throw new ChangedFileTargetError('MISSING_CWD')
  }
  if (!snapshot.fileChanges.some((change) => change.path === input.changePath)) {
    throw new ChangedFileTargetError('NOT_IN_CHANGES')
  }

  const root = await realpath(snapshot.cwd).catch(() => {
    throw new ChangedFileTargetError('MISSING_CWD')
  })
  const requested = resolve(root, changePath)
  const existing = await nearestExistingPath(requested)
  const canonical = await realpath(existing).catch(() => {
    throw new ChangedFileTargetError('NOT_FOUND')
  })
  if (!isContained(root, canonical)) {
    throw new ChangedFileTargetError('OUTSIDE_WORKSPACE')
  }

  const requestedStats = await stat(requested).catch(() => undefined)
  if (input.action === 'open') {
    if (!requestedStats?.isFile()) {
      throw new ChangedFileTargetError('NOT_FOUND')
    }
    const requestedCanonical = await realpath(requested).catch(() => {
      throw new ChangedFileTargetError('NOT_FOUND')
    })
    if (!isContained(root, requestedCanonical)) {
      throw new ChangedFileTargetError('OUTSIDE_WORKSPACE')
    }
    return { action: input.action, path: requestedCanonical, revealDirectory: false }
  }

  if (requestedStats?.isFile()) {
    const requestedCanonical = await realpath(requested).catch(() => {
      throw new ChangedFileTargetError('NOT_FOUND')
    })
    if (!isContained(root, requestedCanonical)) {
      throw new ChangedFileTargetError('OUTSIDE_WORKSPACE')
    }
    return { action: input.action, path: requestedCanonical, revealDirectory: false }
  }
  return { action: input.action, path: canonical, revealDirectory: true }
}

export async function launchChangedFile(
  snapshot: Pick<ThreadSnapshot, 'cwd' | 'fileChanges'>,
  input: OpenChangedFileInput,
  systemShell: Pick<Electron.Shell, 'openPath' | 'showItemInFolder'>
): Promise<OpenChangedFileResult> {
  const target = await resolveChangedFileTarget(snapshot, input)
  try {
    if (target.action === 'open' || target.revealDirectory) {
      const error = await systemShell.openPath(target.path)
      if (error) {
        throw new ChangedFileTargetError('OPEN_FAILED')
      }
    } else {
      systemShell.showItemInFolder(target.path)
    }
    return { action: target.action }
  } catch (error) {
    if (error instanceof ChangedFileTargetError) throw error
    throw new ChangedFileTargetError('OPEN_FAILED')
  }
}
