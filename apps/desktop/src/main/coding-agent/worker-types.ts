/**
 * 本文件定义 Electron main 内部 worker pool 需要的最小结构类型。
 */

/**
 * 发送给 worker 的命令。
 */
export interface WorkerCommand {
  /** 命令类型。 */
  type: string
  /** 其他扩展字段。 */
  [key: string]: unknown
}

/**
 * 命令信封，包含请求 ID。
 */
export interface WorkerCommandEnvelope {
  /** 信封类型。 */
  kind: 'command'
  /** 请求 ID。 */
  id: string
  /** 命令内容。 */
  command: WorkerCommand
}

/**
 * 命令响应信封。
 */
export interface WorkerResponseEnvelope<T = unknown> {
  /** 信封类型。 */
  kind: 'response'
  /** 请求 ID。 */
  id: string
  /** 命令类型。 */
  command: string
  /** 是否成功。 */
  success: boolean
  /** 响应数据。 */
  data?: T
  /** 错误信息。 */
  error?: {
    /** 错误码。 */
    code: string
    /** 错误消息。 */
    message: string
    /** 是否可恢复。 */
    recoverable: boolean
    /** 附加详情。 */
    details?: unknown
  }
}

/**
 *  worker 之间传输的信封联合类型。
 */
export type WorkerEnvelope =
  | WorkerCommandEnvelope
  | WorkerResponseEnvelope
  | {
      /** 信封类型。 */
      kind: 'event'
      /** 事件类型。 */
      eventType: 'canonical' | 'projection' | 'worker'
      /** 所属线程 ID。 */
      threadId?: string
      /** 事件内容。 */
      event: unknown
    }

/**
 * 启动 worker 线程的输入。
 */
export interface StartThreadInput {
  /** 线程 ID；未提供时自动生成。 */
  threadId?: string
  /** 工作目录。 */
  cwd: string
  /** 会话文件路径。 */
  sessionFile?: string
  /** 线程标题。 */
  title?: string
  /** Agent 目录路径。 */
  agentDir?: string
}

/**
 * worker 快照。
 */
export interface WorkerSnapshot {
  /** worker ID。 */
  workerId: string
  /** 绑定的线程 ID。 */
  threadId?: string
  /** 状态：ready 或已绑定。 */
  state: 'ready' | 'bound'
  /** 诊断信息列表。 */
  diagnostics: unknown[]
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
}
