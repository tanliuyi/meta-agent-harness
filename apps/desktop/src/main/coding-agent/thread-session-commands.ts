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
  SwitchSessionInput,
  ThreadSnapshot
} from '../../shared/coding-agent/types'
import type { ThreadManagerCore } from './thread-manager-core'

export async function newSession(
  core: ThreadManagerCore,
  input: NewSessionInput
): Promise<ThreadSnapshot> {
  await core.sendOk(input.threadId, { type: 'new_session', parentSession: input.parentSession })
  return await core.getSnapshot(input.threadId)
}

export async function switchSession(
  core: ThreadManagerCore,
  input: SwitchSessionInput
): Promise<ThreadSnapshot> {
  await core.sendOk(input.threadId, {
    type: 'switch_session',
    sessionPath: input.sessionPath,
    cwdOverride: input.cwdOverride
  })
  return await core.getSnapshot(input.threadId)
}

export async function importSession(
  core: ThreadManagerCore,
  input: ImportSessionInput
): Promise<ThreadSnapshot> {
  await core.sendOk(input.threadId, {
    type: 'import_session',
    inputPath: input.inputPath,
    cwdOverride: input.cwdOverride
  })
  return await core.getSnapshot(input.threadId)
}

export async function exportSession(
  core: ThreadManagerCore,
  input: ExportSessionInput
): Promise<ExportSessionResult> {
  return await core.sendData<ExportSessionResult>(input.threadId, {
    type: 'export_html',
    outputPath: input.outputPath
  })
}

export async function fork(core: ThreadManagerCore, input: ForkInput): Promise<ThreadSnapshot> {
  await core.sendOk(input.threadId, {
    type: 'fork',
    entryId: input.entryId,
    position: input.position
  })
  return await core.getSnapshot(input.threadId)
}

export async function clone(core: ThreadManagerCore, threadId: string): Promise<ThreadSnapshot> {
  await core.sendOk(threadId, { type: 'clone' })
  return await core.getSnapshot(threadId)
}

export async function renameThread(
  core: ThreadManagerCore,
  input: RenameThreadInput
): Promise<void> {
  await core.sendOk(input.threadId, { type: 'set_session_name', name: input.name })
  core.updateThread(input.threadId, { title: input.name })
}
