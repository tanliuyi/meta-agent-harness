/**
 * 本文件只保留 Electron main 内部 registry 的运行时抽象。
 * Worker 协议类型统一复用 packages/coding-agent，避免 Desktop 维护第二套协议。
 */

import type {
  WorkerCommand,
  WorkerEnvelope,
  WorkerResponseEnvelope
} from '@coding-agent-desktop-src/protocol/envelope'
import type { WorkerSnapshot } from '@coding-agent-desktop-src/protocol/snapshot'
import type {
  StartThreadInput,
  ThreadRuntimeState
} from '@coding-agent-desktop-src/protocol/thread'

export type {
  WorkerCommand,
  WorkerCommandEnvelope,
  WorkerEnvelope,
  WorkerEventEnvelope,
  WorkerResponseEnvelope
} from '@coding-agent-desktop-src/protocol/envelope'
export type { WorkerSnapshot } from '@coding-agent-desktop-src/protocol/snapshot'
export type {
  StartThreadInput,
  ThreadRuntimeState
} from '@coding-agent-desktop-src/protocol/thread'

/**
 * worker hang 信息。
 */
export interface WorkerHangInfo {
  /** worker ID。 */
  workerId: string
  /** 线程 ID，若未绑定则为 undefined。 */
  threadId?: string
  /** 无消息持续时间，毫秒。 */
  silentMs: number
}

/** worker 退出信息。 */
export interface WorkerExitInfo {
  /** worker ID。 */
  workerId: string
  /** 线程 ID，若未绑定则为 undefined。 */
  threadId?: string
  /** 底层 transport 关闭原因。 */
  reason: string
}

/**
 * worker 客户端抽象接口。
 */
export interface WorkerClient {
  /** 唯一 worker ID。 */
  readonly workerId: string
  /** 当前绑定的线程 ID。 */
  readonly threadId?: string
  /**
   * 启动线程。
   * @param input - 启动线程输入。
   */
  startThread(input: StartThreadInput): Promise<void>
  /**
   * 发送命令并等待响应。
   * @param command - 要发送的命令。
   * @returns worker 响应。
   */
  send(command: WorkerCommand): Promise<WorkerResponseEnvelope>
  /**
   * 注册事件监听器。
   * @param listener - 事件监听器。
   * @returns 取消订阅函数。
   */
  onEvent?(listener: (event: WorkerEnvelope) => void): () => void
  /**
   * 注册 hang 监听器。
   * @param listener - hang 监听器。
   * @returns 取消订阅函数。
   */
  onHang?(listener: (info: WorkerHangInfo) => void): () => void
  /**
   * 注册退出监听器。
   * @param listener - 退出监听器。
   * @returns 取消订阅函数。
   */
  onExit?(listener: (info: WorkerExitInfo) => void): () => void
  /**
   * 获取 worker 快照。
   * @returns worker 快照。
   */
  snapshot(): WorkerSnapshot
  /**
   * 停止 worker。
   * @param reason - 停止原因。
   */
  stop(reason: string): Promise<void>
}

/**
 * worker 传输层抽象接口。
 */
export interface WorkerTransport {
  /**
   * 发送信封。
   * @param envelope - 要发送的信封。
   */
  send(envelope: WorkerEnvelope): void
  /**
   * 注册消息监听器。
   * @param listener - 消息监听器。
   * @returns 取消监听函数。
   */
  onMessage(listener: (envelope: WorkerEnvelope) => void): () => void
  /**
   * 注册关闭监听器。
   * @param listener - 关闭监听器。
   * @returns 取消监听函数。
   */
  onClose(listener: (reason: string) => void): () => void
  /**
   * 关闭传输层。
   */
  close(): void
}

/**
 * worker 线程租约。
 */
export interface WorkerLease {
  /** worker ID。 */
  workerId: string
  /** 线程 ID。 */
  threadId: string
  /** 工作目录。 */
  cwd: string
  /** 会话文件路径。 */
  sessionFile?: string
  /** 获取租约时间戳。 */
  acquiredAt: number
  /** 最近活跃时间戳。 */
  lastActiveAt: number
  /** 最近收到事件时间戳。 */
  lastEventAt: number
  /** 线程状态。 */
  status?: ThreadRuntimeState
}
