/**
 * metadata-ipc.ts - 首屏轻量 project/thread metadata IPC。
 */

import { ipcMain } from 'electron'
import { codingAgentChannels } from '@shared/coding-agent/channels'
import { fail, ok } from '@shared/coding-agent/ipc-contract'
import type {
  IpcResult,
  ListThreadsInput,
  ProjectSummary,
  ThreadSummary
} from '@shared/coding-agent/types'
import {
  createLightweightProjectMetadataStore,
  createLightweightThreadMetadataStore
} from './metadata-reader'

type IpcMainHandle = Parameters<typeof ipcMain.handle>[1]

interface IpcMainLike {
  handle: (channel: string, listener: IpcMainHandle) => void
  removeHandler: (channel: string) => void
}

interface ProjectMetadataStore {
  listProjects: () => ProjectSummary[]
  close: () => void
}

interface ThreadMetadataStore {
  listThreads: (input?: ListThreadsInput) => ThreadSummary[]
  close: () => void
}

export interface LightweightMetadataIpcRegistration {
  dispose: () => void
}

export interface LightweightMetadataIpcOptions {
  ipc?: IpcMainLike
  projectStore?: ProjectMetadataStore
  threadStore?: ThreadMetadataStore
}

const metadataChannels = [codingAgentChannels.listProjects, codingAgentChannels.listThreads]

/**
 * 注册只读取 metadata JSON 的首屏 IPC handlers。
 */
export function registerLightweightMetadataIpc(
  options: LightweightMetadataIpcOptions = {}
): LightweightMetadataIpcRegistration {
  const ipc = options.ipc ?? ipcMain
  const projectStore = options.projectStore ?? createLightweightProjectMetadataStore()
  const threadStore = options.threadStore ?? createLightweightThreadMetadataStore()
  let disposed = false

  handle(ipc, codingAgentChannels.listProjects, () => projectStore.listProjects())
  handle(ipc, codingAgentChannels.listThreads, (input?: ListThreadsInput) =>
    threadStore.listThreads(input)
  )

  return {
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      for (const channel of metadataChannels) {
        ipc.removeHandler(channel)
      }
      projectStore.close()
      threadStore.close()
    }
  }
}

function handle<TArgs extends unknown[], TResult>(
  ipc: IpcMainLike,
  channel: string,
  callback: (...args: TArgs) => TResult | Promise<TResult>
): void {
  ipc.handle(channel, async (_event, ...args: TArgs): Promise<IpcResult<Awaited<TResult>>> => {
    try {
      return ok(await callback(...args))
    } catch (error) {
      return fail(error)
    }
  })
}
