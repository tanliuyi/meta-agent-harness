/**
 * 本文件提供 CodingThreadManager 共享的 thread registry 与 worker send 能力。
 */

import type { ThreadSnapshot, ThreadSummary } from '../../shared/coding-agent/types'
import type { WorkerCommand, WorkerResponseEnvelope } from './worker-types'
import type { WorkerPool } from './worker-pool'
import type { CodingThreadStore } from './thread-store'

/**
 * Coding thread 管理核心类，负责线程注册、worker 调度和快照构建。
 */
export class ThreadManagerCore {
  /** 内存中的线程摘要映射。 */
  protected readonly threads = new Map<string, ThreadSummary>()
  /** 工作线程池实例。 */
  protected readonly pool: WorkerPool
  /** 可选的持久化线程 store。 */
  private readonly store: CodingThreadStore | undefined

  /**
   * 创建 ThreadManagerCore 实例。
   * @param pool - worker 池实例。
   * @param store - 可选的线程 store，用于加载持久化线程。
   */
  constructor(pool: WorkerPool, store?: CodingThreadStore) {
    this.pool = pool
    this.store = store
    for (const thread of store?.listThreads() ?? []) {
      this.threads.set(thread.threadId, thread)
    }
  }

  /**
   * 检查是否存在指定线程。
   * @param threadId - 线程 ID。
   * @returns 是否存在。
   */
  hasThread(threadId: string): boolean {
    return this.threads.has(threadId)
  }

  /**
   * 保存线程摘要到内存并可选写入 store。
   * @param thread - 线程摘要。
   */
  saveThread(thread: ThreadSummary): void {
    this.threads.set(thread.threadId, thread)
    this.store?.saveThread(thread)
  }

  /**
   * 获取当前使用的 worker 池。
   * @returns worker 池实例。
   */
  getPool(): WorkerPool {
    return this.pool
  }

  /**
   * 列出所有线程摘要。
   * @returns 线程摘要数组。
   */
  listThreads(): ThreadSummary[] {
    return [...this.threads.values()]
  }

  /**
   * 获取指定线程的快照。
   * @param threadId - 线程 ID。
   * @returns 线程快照。
   */
  async getThread(threadId: string): Promise<ThreadSnapshot> {
    return await this.getSnapshot(threadId)
  }

  /**
   * 获取线程快照，优先从 worker 获取，回退到 store 或内存构建。
   * @param threadId - 线程 ID。
   * @returns 线程快照。
   * @throws 当 worker 响应失败且无法回退时。
   */
  async getSnapshot(threadId: string): Promise<ThreadSnapshot> {
    const thread = this.requireThread(threadId)
    if (!this.hasWorker(threadId)) {
      return this.store?.getSnapshot(threadId) ?? this.buildSnapshot(thread)
    }
    const response = await this.pool.send(threadId, { type: 'get_state' })
    if (response.success) {
      const snapshot = this.buildSnapshot(thread, response.data as Record<string, unknown>)
      this.store?.saveSnapshot(snapshot)
      return snapshot
    }
    if (
      isMissingWorkerResponse(response) ||
      (thread.status !== 'idle' && thread.status !== 'running')
    ) {
      return this.store?.getSnapshot(threadId) ?? this.buildSnapshot(thread)
    }
    throwResponseError(response)
  }

  /**
   * 向 worker 发送命令并忽略返回数据。
   * @param threadId - 线程 ID。
   * @param command - 要发送的命令。
   * @throws 当 worker 响应失败时。
   */
  async sendOk(threadId: string, command: WorkerCommand): Promise<void> {
    await this.ensureWorker(threadId)
    const response = await this.pool.send(threadId, command)
    if (!response.success) {
      throwResponseError(response)
    }
  }

  /**
   * 向 worker 发送命令并返回数据。
   * @param threadId - 线程 ID。
   * @param command - 要发送的命令。
   * @returns worker 返回的数据。
   * @throws 当 worker 响应失败时。
   */
  async sendData<T>(threadId: string, command: WorkerCommand): Promise<T> {
    await this.ensureWorker(threadId)
    const response = await this.pool.send(threadId, command)
    if (!response.success) {
      throwResponseError(response)
    }
    return response.data as T
  }

  /**
   * 根据线程摘要和 worker 状态构建快照。
   * @param thread - 线程摘要。
   * @param state - 可选的 worker 状态数据。
   * @returns 线程快照。
   */
  protected buildSnapshot(
    thread: ThreadSummary,
    state: Record<string, unknown> = {}
  ): ThreadSnapshot {
    return {
      threadId: thread.threadId,
      cwd: thread.cwd,
      sessionFile: (state.sessionFile as string | undefined) ?? thread.sessionFile,
      title: (state.sessionName as string | undefined) ?? thread.title,
      status: thread.status,
      thinkingLevel: (state.thinkingLevel as ThreadSnapshot['thinkingLevel'] | undefined) ?? 'off',
      messages: [],
      toolCalls: [],
      fileChanges: [],
      approvals: [],
      queue: {
        steering: [],
        followUp: []
      },
      diagnostics: []
    }
  }

  /**
   * 更新线程的部分字段。
   * @param threadId - 线程 ID。
   * @param patch - 要更新的字段。
   */
  updateThread(threadId: string, patch: Partial<ThreadSummary>): void {
    const thread = this.requireThread(threadId)
    this.saveThread({ ...thread, ...patch, updatedAt: new Date().toISOString() })
  }

  /**
   * 获取线程摘要，不存在则抛出错误。
   * @param threadId - 线程 ID。
   * @returns 线程摘要。
   * @throws 当线程不存在时。
   */
  requireThread(threadId: string): ThreadSummary {
    const thread = this.threads.get(threadId)
    if (!thread) {
      throw new Error(`thread not found: ${threadId}`)
    }
    return thread
  }

  /**
   * 检查指定线程是否已绑定到 worker。
   * @param threadId - 线程 ID。
   * @returns 是否已绑定 worker。
   */
  private hasWorker(threadId: string): boolean {
    return this.pool.listLeases().some((lease) => lease.threadId === threadId)
  }

  /**
   * 确保指定线程已绑定到 worker，必要时启动新 worker。
   * @param threadId - 线程 ID。
   */
  private async ensureWorker(threadId: string): Promise<void> {
    if (this.hasWorker(threadId)) {
      return
    }
    const thread = this.requireThread(threadId)
    const statusAfterStart = thread.status === 'running' ? 'running' : 'idle'
    this.updateThread(threadId, { status: 'starting' })
    await this.pool.acquireThreadWorker({
      threadId,
      cwd: thread.cwd,
      sessionFile: thread.sessionFile,
      title: thread.title
    })
    this.updateThread(threadId, { status: statusAfterStart })
  }
}

/**
 * 根据 worker 响应抛出错误。
 * @param response - worker 响应。
 * @throws 始终抛出 Error。
 */
export function throwResponseError(response: WorkerResponseEnvelope): never {
  const message = response.error?.message ?? `worker command failed: ${response.command}`
  throw new Error(message)
}

/**
 * 判断 worker 响应是否表示线程或 worker 不存在。
 * @param response - worker 响应。
 * @returns 是否为缺失响应。
 */
function isMissingWorkerResponse(response: WorkerResponseEnvelope): boolean {
  return response.error?.code === 'thread_not_found' || response.error?.code === 'worker_not_found'
}
