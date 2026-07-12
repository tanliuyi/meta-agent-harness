/**
 * 本文件实现接入 Pi AgentSessionRuntime 的 desktop worker service。
 */

import type { AgentSessionRuntime } from '@earendil-works/pi-coding-agent'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { ExtensionCommandContextActions } from '@earendil-works/pi-coding-agent'
import { KeybindingsManager } from '@earendil-works/pi-coding-agent'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { createDesktopError } from '../protocol/error.ts'
import {
  createWorkerErrorResponse,
  createWorkerResponse,
  type WorkerCommandEnvelope,
  type WorkerEventEnvelope,
  type WorkerResponseEnvelope
} from '../protocol/envelope.ts'
import type { ThreadId } from '../protocol/identity.ts'
import { toDesktopMessageContent } from '../protocol/message.ts'
import type { StartThreadInput } from '../protocol/thread.ts'
import { createDesktopFileChangeFromEditResult } from '../protocol/tool.ts'
import type { DesktopWorkerService } from './service.ts'
import { ApprovalBridge } from './approval-bridge.ts'
import { createRuntimeForThread } from './runtime-factory.ts'
import { ExtensionUiBridge } from './extension-ui-bridge.ts'
import { handleRuntimeCommand } from './runtime-command-handler.ts'
import { createDesktopProjectTrustContext } from './project-trust-context.ts'

/** 创建 thread 对应的 AgentSessionRuntime 的工厂函数。 */
export type CreateRuntimeForThread = (
  input: StartThreadInput,
  options: { approvalBridge: ApprovalBridge; hasUI: boolean }
) => Promise<AgentSessionRuntime>

/** 基于 AgentSessionRuntime 实现的 desktop worker service。 */
export class RuntimeDesktopWorkerService implements DesktopWorkerService {
  /** 当前 agent session runtime 实例。 */
  private runtime: AgentSessionRuntime | undefined
  /** 创建 thread runtime 的工厂函数。 */
  private readonly createRuntime: CreateRuntimeForThread
  /** 事件下沉回调，用于向外部发送 worker 事件。 */
  private eventSink: ((event: WorkerEventEnvelope) => void) | undefined
  /** 取消会话事件订阅的函数。 */
  private unsubscribeSession: (() => void) | undefined
  /** 审批桥接器实例。 */
  private approvalBridge: ApprovalBridge | undefined
  /** UI 桥接器实例。 */
  private uiBridge: ExtensionUiBridge | undefined
  /** 当前绑定的 thread 标识。 */
  private threadId: ThreadId | undefined
  /** 当前线程内工具调用参数缓存，用于从 tool result 派生 projection。 */
  private readonly toolArgsByCallId = new Map<string, unknown>()
  /** worker 是否已启动并绑定 thread。 */
  private started = false

  /**
   * 构造 RuntimeDesktopWorkerService 实例。
   * @param createRuntime - 创建 thread runtime 的工厂函数，默认使用 createRuntimeForThread。
   */
  constructor(createRuntime: CreateRuntimeForThread = createRuntimeForThread) {
    this.createRuntime = createRuntime
  }

  /**
   * 设置事件下沉回调。
   * @param sink - 用于接收 worker 事件的回调函数。
   */
  setEventSink(sink: (event: WorkerEventEnvelope) => void): void {
    this.eventSink = sink
  }

  /**
   * 启动 thread 并初始化 runtime。
   * @param input - 启动 thread 的输入参数。
   */
  async startThread(input: StartThreadInput): Promise<void> {
    if (!input.threadId) {
      throw new Error('threadId is required')
    }
    if (this.started) {
      throw new Error('worker already has a bound thread')
    }
    this.threadId = input.threadId
    this.approvalBridge = new ApprovalBridge(input.threadId, (event) => this.eventSink?.(event))
    this.uiBridge = new ExtensionUiBridge(
      input.threadId,
      (event) => this.eventSink?.(event),
      input.cwd
    )
    this.runtime = await this.createRuntime(input, {
      approvalBridge: this.approvalBridge,
      hasUI: true
    })
    this.runtime.setRebindSession(async () => {
      await this.bindRuntimeSession()
    })
    this.runtime.setBeforeSessionInvalidate(() => {
      this.unsubscribeSession?.()
      this.unsubscribeSession = undefined
      this.toolArgsByCallId.clear()
      this.approvalBridge?.rejectAll('sessionInvalidated')
      this.uiBridge?.cancelAll('sessionInvalidated')
    })
    await this.bindRuntimeSession()
    this.started = true
    this.eventSink?.({
      kind: 'event',
      eventType: 'projection',
      threadId: input.threadId,
      event: { type: 'thread.stateChanged', threadId: input.threadId, status: 'idle' }
    })
  }

  /**
   * 处理 worker 命令信封。
   * @param envelope - 收到的命令信封。
   * @returns 命令响应信封。
   */
  async handle(envelope: WorkerCommandEnvelope): Promise<WorkerResponseEnvelope> {
    if (envelope.command.type === 'worker.startThread') {
      try {
        await this.startThread(envelope.command.input)
        return createWorkerResponse(envelope.id, envelope.command.type, { ok: true })
      } catch (error) {
        return createWorkerErrorResponse(
          envelope.id,
          envelope.command.type,
          createDesktopError(
            'runtime_error',
            error instanceof Error ? error.message : String(error),
            false
          )
        )
      }
    }
    if (envelope.command.type === 'worker.ping') {
      return createWorkerResponse(envelope.id, envelope.command.type, { ok: true })
    }
    if (envelope.command.type === 'ui.respond') {
      try {
        this.uiBridge?.respond(envelope.command.response)
        return createWorkerResponse(envelope.id, envelope.command.type, { ok: true })
      } catch (error) {
        return createWorkerErrorResponse(
          envelope.id,
          envelope.command.type,
          createDesktopError(
            'invalid_state',
            error instanceof Error ? error.message : String(error),
            true
          )
        )
      }
    }
    if (envelope.command.type === 'approval.respond') {
      try {
        this.approvalBridge?.respond(envelope.command.response)
        return createWorkerResponse(envelope.id, envelope.command.type, { ok: true })
      } catch (error) {
        return createWorkerErrorResponse(
          envelope.id,
          envelope.command.type,
          createDesktopError(
            'invalid_state',
            error instanceof Error ? error.message : String(error),
            true
          )
        )
      }
    }
    if (envelope.command.type === 'ui.editorTextChanged') {
      this.uiBridge?.syncEditorText(envelope.command.text)
      return createWorkerResponse(envelope.id, envelope.command.type, { ok: true })
    }
    if (envelope.command.type === 'ui.toolsExpandedChanged') {
      this.uiBridge?.syncToolsExpanded(envelope.command.expanded)
      return createWorkerResponse(envelope.id, envelope.command.type, { ok: true })
    }
    if (!this.started) {
      return createWorkerErrorResponse(
        envelope.id,
        envelope.command.type,
        createDesktopError('invalid_state', 'worker has no bound thread', true)
      )
    }
    if (!this.runtime) {
      return createWorkerErrorResponse(
        envelope.id,
        envelope.command.type,
        createDesktopError('invalid_state', 'worker runtime is missing', false)
      )
    }
    if (envelope.command.type === 'desktop.panelMessage') {
      await this.runtime.session.extensionRunner.emit({
        type: 'desktop_panel_message',
        panelId: envelope.command.panelId,
        message: envelope.command.message
      })
      return createWorkerResponse(envelope.id, envelope.command.type, { ok: true })
    }
    if (envelope.command.type === 'desktop.panelLifecycle') {
      const event = envelope.command.event
      if (event.type === 'viewStateChanged') {
        await this.runtime.session.extensionRunner.emit({
          type: 'desktop_panel_view_state_changed',
          panelId: event.panelId,
          visible: event.visible,
          active: event.active
        })
      } else {
        await this.runtime.session.extensionRunner.emit({
          type: 'desktop_panel_disposed',
          panelId: event.panelId,
          reason: event.reason
        })
      }
      return createWorkerResponse(envelope.id, envelope.command.type, { ok: true })
    }
    if (envelope.command.type === 'desktop.panelRestore') {
      await this.runtime.session.extensionRunner.emit({
        type: 'desktop_panel_restore',
        panelId: envelope.command.restore.panelId,
        viewType: envelope.command.restore.viewType,
        state: envelope.command.restore.state
      })
      return createWorkerResponse(envelope.id, envelope.command.type, { ok: true })
    }
    if (envelope.command.type === 'shortcut.dispatch') {
      const handled = await this.runtime.session.extensionRunner.executeShortcut(
        envelope.command.shortcut,
        KeybindingsManager.create().getResolvedBindings()
      )
      return createWorkerResponse(envelope.id, envelope.command.type, { handled })
    }
    const response = await handleRuntimeCommand(
      {
        runtime: this.runtime,
        getPendingApprovals: () => this.approvalBridge?.listPending() ?? [],
        getPendingExtensionDialogs: () => this.uiBridge?.listPendingDialogs() ?? [],
        projectTrustContextFactory: (cwd) =>
          createDesktopProjectTrustContext({
            cwd,
            approvalBridge: this.requireApprovalBridge(),
            hasUI: true
          })
      },
      envelope
    )
    if (response) {
      return response
    }
    return createWorkerErrorResponse(
      envelope.id,
      envelope.command.type,
      createDesktopError(
        'invalid_command',
        `Unsupported worker command: ${envelope.command.type}`,
        true
      )
    )
  }

  /**
   * 停止 worker 并释放相关资源。
   * @param _reason - 停止原因（当前未使用）。
   */
  async stop(_reason: string): Promise<void> {
    this.unsubscribeSession?.()
    this.unsubscribeSession = undefined
    this.approvalBridge?.rejectAll('workerStopped')
    this.uiBridge?.dispose()
    await this.runtime?.dispose()
    this.runtime = undefined
    this.approvalBridge = undefined
    this.uiBridge = undefined
    this.threadId = undefined
    this.toolArgsByCallId.clear()
    this.started = false
  }

  private requireApprovalBridge(): ApprovalBridge {
    if (!this.approvalBridge) {
      throw new Error('approval bridge is missing')
    }
    return this.approvalBridge
  }

  private requireRuntime(): AgentSessionRuntime {
    if (!this.runtime) {
      throw new Error('worker runtime is missing')
    }
    return this.runtime
  }

  private createCommandContextActions(): ExtensionCommandContextActions {
    return {
      waitForIdle: () => this.requireRuntime().session.agent.waitForIdle(),
      newSession: (options) => this.requireRuntime().newSession(options),
      fork: async (entryId, options) => {
        const result = await this.requireRuntime().fork(entryId, options)
        return { cancelled: result.cancelled }
      },
      navigateTree: async (targetId, options) => {
        const result = await this.requireRuntime().session.navigateTree(targetId, {
          summarize: options?.summarize,
          customInstructions: options?.customInstructions,
          replaceInstructions: options?.replaceInstructions,
          label: options?.label
        })
        return { cancelled: result.cancelled }
      },
      switchSession: (sessionPath, options) =>
        this.requireRuntime().switchSession(sessionPath, {
          ...options,
          projectTrustContextFactory: (cwd) =>
            createDesktopProjectTrustContext({
              cwd,
              approvalBridge: this.requireApprovalBridge(),
              hasUI: true
            })
        }),
      reload: async () => {
        await this.requireRuntime().session.reload({
          beforeSessionStart: async () => {
            this.toolArgsByCallId.clear()
          }
        })
      }
    }
  }

  private emitExtensionError(error: {
    extensionPath: string
    event: string
    error: string
    stack?: string
  }): void {
    const threadId = this.threadId
    if (!threadId) {
      return
    }
    this.eventSink?.({
      kind: 'event',
      eventType: 'projection',
      threadId,
      event: {
        type: 'thread.error',
        threadId,
        diagnostic: {
          id: `extension-${Date.now()}`,
          severity: 'error',
          source: 'runtime',
          threadId,
          message: `${error.extensionPath}: ${error.error}`,
          details: { event: error.event, stack: error.stack },
          createdAt: new Date().toISOString()
        }
      }
    })
  }

  private async bindRuntimeSession(): Promise<void> {
    const runtime = this.requireRuntime()
    const uiBridge = this.uiBridge
    if (!uiBridge) {
      throw new Error('extension UI bridge is missing')
    }
    uiBridge.syncCwd(runtime.session.sessionManager.getCwd())
    await runtime.session.bindExtensions({
      uiContext: uiBridge.createContext(),
      desktopContext: uiBridge.createDesktopContext(),
      mode: 'desktop',
      commandContextActions: this.createCommandContextActions(),
      shutdownHandler: () => {
        void this.stop('extension-shutdown')
      },
      onError: (error) => this.emitExtensionError(error)
    })
    this.bindSessionEvents()
  }

  /**
   * 订阅会话事件并投影到 worker 事件下沉。
   * 会重新绑定订阅，覆盖之前的订阅。
   */
  private bindSessionEvents(): void {
    this.unsubscribeSession?.()
    const threadId = this.threadId
    const runtime = this.runtime
    if (!threadId || !runtime) {
      return
    }
    this.unsubscribeSession = runtime.session.subscribe((event) => {
      if (event.type === 'message_end') {
        this.emitMessageEndAfterPersistence(threadId, runtime, event)
      } else {
        this.eventSink?.({ kind: 'event', eventType: 'canonical', threadId, event })
      }
      if (event.type === 'tool_execution_start' || event.type === 'tool_execution_update') {
        this.toolArgsByCallId.set(event.toolCallId, event.args)
      }
      if (event.type !== 'tool_execution_end') {
        return
      }
      const change = createDesktopFileChangeFromEditResult({
        threadId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: this.toolArgsByCallId.get(event.toolCallId),
        result: event.result,
        isError: event.isError
      })
      this.toolArgsByCallId.delete(event.toolCallId)
      if (!change) {
        return
      }
      this.eventSink?.({
        kind: 'event',
        eventType: 'projection',
        threadId,
        event: { type: 'file.changed', threadId, change }
      })
    })
  }

  private emitMessageEndAfterPersistence(
    threadId: ThreadId,
    runtime: AgentSessionRuntime,
    event: Extract<AgentSessionEvent, { type: 'message_end' }>
  ): void {
    const session = runtime.session
    queueMicrotask(() => {
      const sessionEntryId = getPersistedMessageEntryId(
        session.sessionManager.getBranch(),
        event.message
      )
      this.eventSink?.({
        kind: 'event',
        eventType: 'canonical',
        threadId,
        event: (sessionEntryId ? { ...event, sessionEntryId } : event) as AgentSessionEvent
      })
    })
  }
}

function getPersistedMessageEntryId(
  entries: Array<{ type: string; id: string; message?: unknown }>,
  message: AgentMessage
): string | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (entry?.type !== 'message' || entry.message !== message) {
      continue
    }
    const content = toDesktopMessageContent(entry.message as AgentMessage)
    return content?.role === 'user' || content?.role === 'assistant' ? entry.id : undefined
  }
  return undefined
}
