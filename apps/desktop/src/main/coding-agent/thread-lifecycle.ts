/**
 * 本文件实现 coding thread 生命周期操作。
 */

import type { CreateThreadInput, ThreadSnapshot } from '../../shared/coding-agent/types'
import type { ThreadManagerCore } from './thread-manager-core'

export async function createThread(
  core: ThreadManagerCore,
  input: CreateThreadInput
): Promise<ThreadSnapshot> {
  if (!input.cwd) {
    throw new Error('cwd is required')
  }
  const threadId = input.threadId ?? crypto.randomUUID()
  if (core.hasThread(threadId)) {
    throw new Error(`thread already exists: ${threadId}`)
  }
  const now = new Date().toISOString()
  core.saveThread({
    threadId,
    cwd: input.cwd,
    sessionFile: input.sessionFile,
    title: input.title,
    status: 'starting',
    createdAt: now,
    updatedAt: now
  })
  try {
    await core.getPool().acquireThreadWorker({
      threadId,
      cwd: input.cwd,
      sessionFile: input.sessionFile,
      title: input.title,
      agentDir: input.agentDir
    })
    core.updateThread(threadId, { status: 'idle' })
    return await core.getSnapshot(threadId)
  } catch (error) {
    core.updateThread(threadId, { status: 'error' })
    throw error
  }
}

export async function stopThread(core: ThreadManagerCore, threadId: string): Promise<void> {
  core.requireThread(threadId)
  core.updateThread(threadId, { status: 'stopping' })
  await core.getPool().releaseThreadWorker(threadId, 'stop')
  core.updateThread(threadId, { status: 'stopped' })
}

export async function restartThread(
  core: ThreadManagerCore,
  threadId: string
): Promise<ThreadSnapshot> {
  const thread = core.requireThread(threadId)
  if (
    core
      .getPool()
      .listLeases()
      .some((lease) => lease.threadId === threadId)
  ) {
    await core.getPool().releaseThreadWorker(threadId, 'stop')
  }
  core.updateThread(threadId, { status: 'starting' })
  await core.getPool().acquireThreadWorker({
    threadId,
    cwd: thread.cwd,
    sessionFile: thread.sessionFile,
    title: thread.title
  })
  core.updateThread(threadId, { status: 'idle' })
  return await core.getSnapshot(threadId)
}

export async function archiveThread(core: ThreadManagerCore, threadId: string): Promise<void> {
  const thread = core.requireThread(threadId)
  if (
    core
      .getPool()
      .listLeases()
      .some((lease) => lease.threadId === threadId)
  ) {
    await core.getPool().releaseThreadWorker(threadId, 'archive')
  }
  core.saveThread({ ...thread, status: 'stopped', archivedAt: new Date().toISOString() })
}
