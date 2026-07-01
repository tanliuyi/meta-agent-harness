/**
 * 本文件实现 coding thread 生命周期操作。
 */

import type { CreateThreadInput, ThreadSnapshot } from '../../shared/coding-agent/types'
import type { ThreadManagerCore } from './thread-manager-core'

/**
 * 创建新线程并启动 worker。
 * @param core - thread 管理核心。
 * @param input - 创建线程输入。
 * @returns 线程快照。
 * @throws 若未提供 projectId 或线程已存在时抛出错误。
 */
export async function createThread(
  core: ThreadManagerCore,
  input: CreateThreadInput
): Promise<ThreadSnapshot> {
  if (!input.projectId) {
    throw new Error('projectId is required')
  }
  const project = core.getProjectStore().openProject(input.projectId)
  if (project.status !== 'available') {
    throw new Error(`project is not available: ${project.status}`)
  }
  const threadId = input.threadId ?? crypto.randomUUID()
  if (core.hasThread(threadId)) {
    throw new Error(`thread already exists: ${threadId}`)
  }
  const now = new Date().toISOString()
  core.saveThread({
    threadId,
    projectId: input.projectId,
    sessionFile: input.sessionFile,
    title: input.title,
    status: 'starting',
    createdAt: now,
    updatedAt: now
  })
  try {
    await core.getWorkers().acquireThreadWorker({
      threadId,
      cwd: project.path,
      sessionFile: input.sessionFile,
      title: input.title,
      agentDir: input.agentDir,
      projectTrustOverride: core.getProjectTrustOverride(project.path)
    })
    core.updateThread(threadId, { status: 'idle' })
    return await core.getSnapshot(threadId)
  } catch (error) {
    core.updateThread(threadId, { status: 'error' })
    throw error
  }
}

/**
 * 停止指定线程的 worker。
 * @param core - thread 管理核心。
 * @param threadId - thread ID。
 */
export async function stopThread(core: ThreadManagerCore, threadId: string): Promise<void> {
  core.requireThread(threadId)
  core.updateThread(threadId, { status: 'stopping' })
  await core.getWorkers().releaseThreadWorker(threadId, 'stop')
  core.updateThread(threadId, { status: 'stopped' })
}

/**
 * 重启指定线程的 worker。
 * @param core - thread 管理核心。
 * @param threadId - thread ID。
 * @returns 线程快照。
 */
export async function restartThread(
  core: ThreadManagerCore,
  threadId: string
): Promise<ThreadSnapshot> {
  const thread = core.requireThread(threadId)
  if (
    core
      .getWorkers()
      .listLeases()
      .some((lease) => lease.threadId === threadId)
  ) {
    await core.getWorkers().releaseThreadWorker(threadId, 'stop')
  }
  core.updateThread(threadId, { status: 'starting' })
  const cwd = core.getThreadCwd(thread)
  await core.getWorkers().acquireThreadWorker({
    threadId,
    cwd,
    sessionFile: thread.sessionFile,
    title: thread.title,
    projectTrustOverride: core.getProjectTrustOverride(cwd)
  })
  core.updateThread(threadId, { status: 'idle' })
  return await core.getSnapshot(threadId)
}

/**
 * 归档线程并释放其 worker。
 * @param core - thread 管理核心。
 * @param threadId - thread ID。
 */
export async function archiveThread(core: ThreadManagerCore, threadId: string): Promise<void> {
  const thread = core.requireThread(threadId)
  if (
    core
      .getWorkers()
      .listLeases()
      .some((lease) => lease.threadId === threadId)
  ) {
    await core.getWorkers().releaseThreadWorker(threadId, 'archive')
  }
  core.saveThread({ ...thread, status: 'stopped', archivedAt: new Date().toISOString() })
}
