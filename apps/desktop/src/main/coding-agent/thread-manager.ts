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

/**
 * Desktop coding agent 线程管理器，提供线程生命周期、模型、会话、运行控制等操作。
 */
export class CodingThreadManager extends ThreadManagerCore {
  /**
   * 创建新线程。
   * @param input - 创建线程输入参数。
   * @returns 线程快照。
   */
  createThread(input: CreateThreadInput): Promise<ThreadSnapshot> {
    return createThread(this, input)
  }

  /**
   * 停止指定线程。
   * @param threadId - 线程 ID。
   */
  stopThread(threadId: string): Promise<void> {
    return stopThread(this, threadId)
  }

  /**
   * 重新启动指定线程。
   * @param threadId - 线程 ID。
   * @returns 线程快照。
   */
  restartThread(threadId: string): Promise<ThreadSnapshot> {
    return restartThread(this, threadId)
  }

  /**
   * 向线程发送提示。
   * @param input - 提示输入。
   */
  prompt(input: PromptInput): Promise<void> {
    return prompt(this, input)
  }

  /**
   * 向线程发送引导输入。
   * @param input - 文本输入。
   */
  steer(input: TextInput): Promise<void> {
    return steer(this, input)
  }

  /**
   * 向线程发送跟进输入。
   * @param input - 文本输入。
   */
  followUp(input: TextInput): Promise<void> {
    return followUp(this, input)
  }

  /**
   * 中止线程当前运行。
   * @param threadId - 线程 ID。
   */
  abort(threadId: string): Promise<void> {
    return abort(this, threadId)
  }

  /**
   * 创建新会话。
   * @param input - 新建会话输入。
   * @returns 线程快照。
   */
  newSession(input: NewSessionInput): Promise<ThreadSnapshot> {
    return newSession(this, input)
  }

  /**
   * 切换到指定会话。
   * @param input - 切换会话输入。
   * @returns 线程快照。
   */
  switchSession(input: SwitchSessionInput): Promise<ThreadSnapshot> {
    return switchSession(this, input)
  }

  /**
   * 导入会话。
   * @param input - 导入会话输入。
   * @returns 线程快照。
   */
  importSession(input: ImportSessionInput): Promise<ThreadSnapshot> {
    return importSession(this, input)
  }

  /**
   * 导出会话。
   * @param input - 导出会话输入。
   * @returns 导出结果。
   */
  exportSession(input: ExportSessionInput): Promise<ExportSessionResult> {
    return exportSession(this, input)
  }

  /**
   * 在指定位置分叉线程。
   * @param input - 分叉输入。
   * @returns 线程快照。
   */
  fork(input: ForkInput): Promise<ThreadSnapshot> {
    return fork(this, input)
  }

  /**
   * 克隆线程。
   * @param threadId - 线程 ID。
   * @returns 线程快照。
   */
  clone(threadId: string): Promise<ThreadSnapshot> {
    return clone(this, threadId)
  }

  /**
   * 重命名线程。
   * @param input - 重命名输入。
   */
  renameThread(input: RenameThreadInput): Promise<void> {
    return renameThread(this, input)
  }

  /**
   * 归档线程。
   * @param threadId - 线程 ID。
   */
  archiveThread(threadId: string): Promise<void> {
    return archiveThread(this, threadId)
  }

  /**
   * 列出线程可用模型。
   * @param threadId - 线程 ID。
   * @returns 模型信息列表。
   */
  listModels(threadId: string): Promise<ModelInfo[]> {
    return listModels(this, threadId)
  }

  /**
   * 设置线程使用的模型。
   * @param input - 设置模型输入。
   */
  setModel(input: SetModelInput): Promise<void> {
    return setModel(this, input)
  }

  /**
   * 切换到下一个模型。
   * @param threadId - 线程 ID。
   * @returns 模型切换结果或 null。
   */
  cycleModel(threadId: string): Promise<ModelCycleResult | null> {
    return cycleModel(this, threadId)
  }

  /**
   * 设置线程思考级别。
   * @param input - 设置思考级别输入。
   */
  setThinkingLevel(input: SetThinkingInput): Promise<void> {
    return setThinkingLevel(this, input)
  }

  /**
   * 切换线程思考级别。
   * @param threadId - 线程 ID。
   * @returns 思考级别切换结果或 null。
   */
  cycleThinkingLevel(threadId: string): Promise<ThinkingCycleResult | null> {
    return cycleThinkingLevel(this, threadId)
  }

  /**
   * 压缩线程上下文。
   * @param input - 压缩输入。
   * @returns 压缩结果。
   */
  compact(input: CompactInput): Promise<CompactionResult> {
    return compact(this, input)
  }

  /**
   * 设置自动压缩开关。
   * @param input - 开关输入。
   */
  setAutoCompaction(input: ToggleInput): Promise<void> {
    return setAutoCompaction(this, input)
  }

  /**
   * 设置自动重试开关。
   * @param input - 开关输入。
   */
  setAutoRetry(input: ToggleInput): Promise<void> {
    return setAutoRetry(this, input)
  }

  /**
   * 中止重试。
   * @param threadId - 线程 ID。
   */
  abortRetry(threadId: string): Promise<void> {
    return abortRetry(this, threadId)
  }

  /**
   * 获取线程可用命令列表。
   * @param threadId - 线程 ID。
   * @returns 命令信息列表。
   */
  getCommands(threadId: string): Promise<CommandInfo[]> {
    return getCommands(this, threadId)
  }

  /**
   * 运行指定命令。
   * @param input - 命令输入。
   */
  runCommand(input: { threadId: string; command: string }): Promise<void> {
    return runCommand(this, input)
  }

  /**
   * 响应 UI 扩展请求。
   * @param input - 响应输入。
   */
  respondUi(input: { threadId: string; response: unknown }): Promise<void> {
    return respondUi(this, input)
  }

  /**
   * 响应审批请求。
   * @param input - 审批响应输入。
   */
  respondApproval(input: { threadId: string; response: unknown }): Promise<void> {
    return respondApproval(this, input)
  }

  /**
   * 关闭管理器并释放所有 worker。
   */
  shutdown(): Promise<void> {
    return this.getPool().shutdown()
  }
}
