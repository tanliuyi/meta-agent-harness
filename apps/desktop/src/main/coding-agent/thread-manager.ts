/**
 * 本文件组合 desktop main 进程中的 coding thread 管理能力。
 */

import type {
  CommandInfo,
  CompactInput,
  CompactionResult,
  CreateThreadInput,
  ExportSessionInput,
  ExportSessionResult,
  ForkInput,
  ImportSessionInput,
  ModelCycleResult,
  ModelInfo,
  NewSessionInput,
  PromptInput,
  RenameThreadInput,
  SetModelInput,
  SetThinkingInput,
  SwitchSessionInput,
  TextInput,
  ThinkingCycleResult,
  ThreadSnapshot,
  ToggleInput
} from '../../shared/coding-agent/types'
import { abort, followUp, prompt, runCommand, steer } from './thread-agent-commands'
import { archiveThread, createThread, restartThread, stopThread } from './thread-lifecycle'
import {
  cycleModel,
  cycleThinkingLevel,
  listModels,
  setModel,
  setThinkingLevel
} from './thread-model-commands'
import {
  compact,
  abortRetry,
  getCommands,
  respondApproval,
  respondUi,
  setAutoCompaction,
  setAutoRetry
} from './thread-runtime-controls'
import {
  clone,
  exportSession,
  fork,
  importSession,
  newSession,
  renameThread,
  switchSession
} from './thread-session-commands'
import { ThreadManagerCore } from './thread-manager-core'

export class CodingThreadManager extends ThreadManagerCore {
  createThread(input: CreateThreadInput): Promise<ThreadSnapshot> {
    return createThread(this, input)
  }

  stopThread(threadId: string): Promise<void> {
    return stopThread(this, threadId)
  }

  restartThread(threadId: string): Promise<ThreadSnapshot> {
    return restartThread(this, threadId)
  }

  prompt(input: PromptInput): Promise<void> {
    return prompt(this, input)
  }

  steer(input: TextInput): Promise<void> {
    return steer(this, input)
  }

  followUp(input: TextInput): Promise<void> {
    return followUp(this, input)
  }

  abort(threadId: string): Promise<void> {
    return abort(this, threadId)
  }

  newSession(input: NewSessionInput): Promise<ThreadSnapshot> {
    return newSession(this, input)
  }

  switchSession(input: SwitchSessionInput): Promise<ThreadSnapshot> {
    return switchSession(this, input)
  }

  importSession(input: ImportSessionInput): Promise<ThreadSnapshot> {
    return importSession(this, input)
  }

  exportSession(input: ExportSessionInput): Promise<ExportSessionResult> {
    return exportSession(this, input)
  }

  fork(input: ForkInput): Promise<ThreadSnapshot> {
    return fork(this, input)
  }

  clone(threadId: string): Promise<ThreadSnapshot> {
    return clone(this, threadId)
  }

  renameThread(input: RenameThreadInput): Promise<void> {
    return renameThread(this, input)
  }

  archiveThread(threadId: string): Promise<void> {
    return archiveThread(this, threadId)
  }

  listModels(threadId: string): Promise<ModelInfo[]> {
    return listModels(this, threadId)
  }

  setModel(input: SetModelInput): Promise<void> {
    return setModel(this, input)
  }

  cycleModel(threadId: string): Promise<ModelCycleResult | null> {
    return cycleModel(this, threadId)
  }

  setThinkingLevel(input: SetThinkingInput): Promise<void> {
    return setThinkingLevel(this, input)
  }

  cycleThinkingLevel(threadId: string): Promise<ThinkingCycleResult | null> {
    return cycleThinkingLevel(this, threadId)
  }

  compact(input: CompactInput): Promise<CompactionResult> {
    return compact(this, input)
  }

  setAutoCompaction(input: ToggleInput): Promise<void> {
    return setAutoCompaction(this, input)
  }

  setAutoRetry(input: ToggleInput): Promise<void> {
    return setAutoRetry(this, input)
  }

  abortRetry(threadId: string): Promise<void> {
    return abortRetry(this, threadId)
  }

  getCommands(threadId: string): Promise<CommandInfo[]> {
    return getCommands(this, threadId)
  }

  runCommand(input: { threadId: string; command: string }): Promise<void> {
    return runCommand(this, input)
  }

  respondUi(input: { threadId: string; response: unknown }): Promise<void> {
    return respondUi(this, input)
  }

  respondApproval(input: { threadId: string; response: unknown }): Promise<void> {
    return respondApproval(this, input)
  }

  shutdown(): Promise<void> {
    return this.getPool().shutdown()
  }
}
