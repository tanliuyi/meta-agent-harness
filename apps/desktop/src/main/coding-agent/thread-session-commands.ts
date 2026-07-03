/**
 * 本文件实现 coding thread 的 Pi session lifecycle 操作。
 */

import type {
  ExportSessionInput,
  ExportSessionResult,
  ForkInput,
  ImportSessionInput,
  NewSessionInput,
  RenameThreadInput,
  SetThreadTitleInput,
  SwitchSessionInput,
  ThreadSnapshot,
  ThreadSummary
} from '@shared/coding-agent/types'
import type { ThreadManagerCore } from './thread-manager-core'

/**
 * 创建新会话。
 * @param core - thread 管理核心。
 * @param input - 新会话输入。
 * @returns 线程快照。
 */
export async function newSession(
  core: ThreadManagerCore,
  input: NewSessionInput
): Promise<ThreadSnapshot> {
  await core.sendOk(input.threadId, { type: 'new_session', parentSession: input.parentSession })
  return await snapshotAndSyncThread(core, input.threadId)
}

/**
 * 切换到指定会话。
 * @param core - thread 管理核心。
 * @param input - 切换会话输入。
 * @returns 线程快照。
 */
export async function switchSession(
  core: ThreadManagerCore,
  input: SwitchSessionInput
): Promise<ThreadSnapshot> {
  await core.sendOk(input.threadId, {
    type: 'switch_session',
    sessionPath: input.sessionPath,
    cwdOverride: input.cwdOverride
  })
  return await snapshotAndSyncThread(core, input.threadId)
}

/**
 * 导入会话文件。
 * @param core - thread 管理核心。
 * @param input - 导入会话输入。
 * @returns 线程快照。
 */
export async function importSession(
  core: ThreadManagerCore,
  input: ImportSessionInput
): Promise<ThreadSnapshot> {
  await core.sendOk(input.threadId, {
    type: 'import_session',
    inputPath: input.inputPath,
    cwdOverride: input.cwdOverride
  })
  return await snapshotAndSyncThread(core, input.threadId)
}

/**
 * 导出会话为 HTML。
 * @param core - thread 管理核心。
 * @param input - 导出会话输入。
 * @returns 导出结果。
 */
export async function exportSession(
  core: ThreadManagerCore,
  input: ExportSessionInput
): Promise<ExportSessionResult> {
  return await core.sendData<ExportSessionResult>(input.threadId, {
    type: 'export_html',
    outputPath: input.outputPath
  })
}

/**
 * 在指定 entry 处分叉会话。
 * @param core - thread 管理核心。
 * @param input - 分叉输入。
 * @returns 线程快照。
 */
export async function fork(core: ThreadManagerCore, input: ForkInput): Promise<ThreadSnapshot> {
  await core.sendOk(input.threadId, {
    type: 'fork',
    entryId: input.entryId,
    position: input.position
  })
  return await snapshotAndSyncThread(core, input.threadId)
}

/**
 * 克隆当前会话。
 * @param core - thread 管理核心。
 * @param threadId - thread ID。
 * @returns 线程快照。
 */
export async function clone(core: ThreadManagerCore, threadId: string): Promise<ThreadSnapshot> {
  await core.sendOk(threadId, { type: 'clone' })
  return await snapshotAndSyncThread(core, threadId)
}

/**
 * 重命名线程标题。
 * @param core - thread 管理核心。
 * @param input - 重命名输入。
 */
export async function renameThread(
  core: ThreadManagerCore,
  input: RenameThreadInput
): Promise<void> {
  await core.sendOk(input.threadId, { type: 'set_session_name', name: input.name })
  core.updateThread(input.threadId, { title: input.name })
}

/**
 * 设置 thread metadata 标题，并在 worker 已运行时同步 session name。
 * @param core - thread 管理核心。
 * @param input - 标题输入。
 * @returns 更新后的 thread 摘要。
 */
export async function setThreadTitle(
  core: ThreadManagerCore,
  input: SetThreadTitleInput
): Promise<ThreadSummary> {
  const title = input.title.trim()
  if (!title) {
    return core.requireThread(input.threadId)
  }
  core.updateThread(input.threadId, { title })
  const hasWorker = core.getWorkers().listLeases().some((lease) => lease.threadId === input.threadId)
  if (hasWorker) {
    try {
      await core.sendOk(input.threadId, { type: 'set_session_name', name: title })
    } catch (error) {
      core.getStore()?.recordDiagnostic({
        threadId: input.threadId,
        source: 'session-name',
        severity: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return core.requireThread(input.threadId)
}

/**
 * 获取 snapshot，并用 Pi runtime 当前 session 信息回写 thread metadata。
 * @param core - thread 管理核心。
 * @param threadId - thread ID。
 * @returns 最新 snapshot。
 */
async function snapshotAndSyncThread(
  core: ThreadManagerCore,
  threadId: string
): Promise<ThreadSnapshot> {
  const snapshot = await core.getSnapshot(threadId)
  core.updateThread(threadId, {
    sessionFile: snapshot.sessionFile,
    title: snapshot.title
  })
  return snapshot
}
