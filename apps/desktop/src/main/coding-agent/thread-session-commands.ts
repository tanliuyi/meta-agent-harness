/**
 * 本文件实现 coding thread 的 Pi session lifecycle 操作。
 */

import type {
  ExportSessionInput,
  ExportSessionResult,
  ForkInput,
  ForkThreadInput,
  ForkThreadResult,
  ImportSessionInput,
  LoadSessionTreeBranchesInput,
  LoadSessionTreeBranchesResult,
  LoadSessionTreeChildrenInput,
  LoadSessionTreePathInput,
  NavigateTreeInput,
  NavigateTreeResult,
  NewSessionInput,
  RenameThreadInput,
  SetSessionEntryLabelInput,
  SetThreadTitleInput,
  SwitchSessionInput,
  ThreadSnapshot,
  ThreadSummary
} from '@shared/coding-agent/types'
import type { ThreadManagerCore } from './thread-manager-core'
import { readDesktopRuntimeConfig } from './desktop-runtime-config'
import { createThread } from './thread-lifecycle'
import { buildSessionTreeBranches } from './session-tree-branches'

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
  if (input.outputPath && readDesktopRuntimeConfig().filesystemAccess !== 'full') {
    throw new Error('指定导出路径需要在 Settings 中开启完整文件系统能力')
  }
  return await core.sendData<ExportSessionResult>(input.threadId, {
    type: 'export_html',
    ...(input.outputPath ? { outputPath: input.outputPath } : {})
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
 * 从指定 entry 创建新的分支 thread，不替换源 thread 的 session。
 * @param core - thread 管理核心。
 * @param input - 分支输入。
 * @returns 创建结果；hook 取消时不包含 snapshot。
 */
export async function forkThread(
  core: ThreadManagerCore,
  input: ForkThreadInput
): Promise<ForkThreadResult> {
  const sourceThread = core.requireThread(input.threadId)
  const result = await core.sendData<{
    sessionFile?: string
    cancelled?: boolean
  }>(input.threadId, {
    type: 'create_fork_session',
    entryId: input.entryId,
    position: input.position
  })
  if (result.cancelled) {
    return { cancelled: true }
  }
  if (!result.sessionFile) {
    throw new Error('fork did not return a session file')
  }
  const snapshot = await createThread(core, {
    projectId: sourceThread.projectId,
    sessionFile: result.sessionFile,
    title: input.title?.trim() || createForkThreadTitle(sourceThread.title)
  })
  return { cancelled: false, snapshot }
}

/**
 * 在当前 session tree 内导航。
 * @param core - thread 管理核心。
 * @param input - 导航输入。
 * @returns 导航结果与最新 snapshot。
 */
export async function navigateTree(
  core: ThreadManagerCore,
  input: NavigateTreeInput
): Promise<NavigateTreeResult> {
  const result = await core.sendData<Omit<NavigateTreeResult, 'snapshot'>>(input.threadId, {
    type: 'navigate_tree',
    entryId: input.entryId,
    summarize: input.summarize,
    customInstructions: input.customInstructions
  })
  return {
    ...result,
    snapshot: await snapshotAndSyncThread(core, input.threadId)
  }
}

/**
 * 加载 session tree 子节点。
 * @param core - thread 管理核心。
 * @param input - 加载输入。
 * @returns 子节点列表。
 */
export async function loadSessionTreeChildren(
  core: ThreadManagerCore,
  input: LoadSessionTreeChildrenInput
): Promise<NonNullable<ThreadSnapshot['sessionTree']>> {
  const result = await core.sendData<{ children: NonNullable<ThreadSnapshot['sessionTree']> }>(
    input.threadId,
    {
      type: 'get_session_tree_children',
      parentId: input.parentId,
      maxDepth: input.maxDepth
    }
  )
  return result.children
}

/**
 * 从 main 进程派生扁平 branch 视图。
 * @param core - thread 管理核心。
 * @param input - branch 视图输入。
 * @returns 扁平 branch rows。
 */
export async function loadSessionTreeBranches(
  core: ThreadManagerCore,
  input: LoadSessionTreeBranchesInput
): Promise<LoadSessionTreeBranchesResult> {
  const sessionState = await core.getThreadSessionState(input.threadId)
  if (!sessionState.sessionFile) {
    throw new Error('thread does not have a session file')
  }
  return await buildSessionTreeBranches(sessionState.sessionFile, {
    ...input,
    currentEntryId: sessionState.currentEntryId
  })
}

/**
 * 加载 root 到指定 entry 的 session tree 路径。
 * @param core - thread 管理核心。
 * @param input - 加载输入。
 * @returns entry ID 路径。
 */
export async function loadSessionTreePath(
  core: ThreadManagerCore,
  input: LoadSessionTreePathInput
): Promise<string[]> {
  const result = await core.sendData<{ path: string[] }>(input.threadId, {
    type: 'get_session_tree_path',
    entryId: input.entryId
  })
  return result.path
}

/**
 * 设置 session entry label。
 * @param core - thread 管理核心。
 * @param input - label 输入。
 * @returns 最新 snapshot。
 */
export async function setSessionEntryLabel(
  core: ThreadManagerCore,
  input: SetSessionEntryLabelInput
): Promise<ThreadSnapshot> {
  await core.sendOk(input.threadId, {
    type: 'set_session_entry_label',
    entryId: input.entryId,
    label: input.label
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
  const hasWorker = core
    .getWorkers()
    .listLeases()
    .some((lease) => lease.threadId === input.threadId)
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

/**
 * 为分支 thread 派生标题。
 * @param sourceTitle - 源 thread 标题。
 * @returns 分支标题。
 */
function createForkThreadTitle(sourceTitle?: string): string {
  const title = sourceTitle?.trim()
  return title ? `${title} · 分支` : '分支会话'
}
