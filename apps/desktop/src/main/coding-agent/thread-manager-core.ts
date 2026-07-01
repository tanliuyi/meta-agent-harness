/**
 * 本文件提供 CodingThreadManager 共享的 thread registry 与 worker send 能力。
 */

import type { ThreadSnapshot, ThreadSummary } from '../../shared/coding-agent/types'
import type { WorkerCommand, WorkerResponseEnvelope } from './worker-types'
import type { WorkerPool } from './worker-pool'
import type { CodingThreadStore } from './thread-store'

export class ThreadManagerCore {
  protected readonly threads = new Map<string, ThreadSummary>()
  protected readonly pool: WorkerPool
  private readonly store: CodingThreadStore | undefined

  constructor(pool: WorkerPool, store?: CodingThreadStore) {
    this.pool = pool
    this.store = store
    for (const thread of store?.listThreads() ?? []) {
      this.threads.set(thread.threadId, thread)
    }
  }

  hasThread(threadId: string): boolean {
    return this.threads.has(threadId)
  }

  saveThread(thread: ThreadSummary): void {
    this.threads.set(thread.threadId, thread)
    this.store?.saveThread(thread)
  }

  getPool(): WorkerPool {
    return this.pool
  }

  listThreads(): ThreadSummary[] {
    return [...this.threads.values()]
  }

  async getThread(threadId: string): Promise<ThreadSnapshot> {
    return await this.getSnapshot(threadId)
  }

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

  async sendOk(threadId: string, command: WorkerCommand): Promise<void> {
    await this.ensureWorker(threadId)
    const response = await this.pool.send(threadId, command)
    if (!response.success) {
      throwResponseError(response)
    }
  }

  async sendData<T>(threadId: string, command: WorkerCommand): Promise<T> {
    await this.ensureWorker(threadId)
    const response = await this.pool.send(threadId, command)
    if (!response.success) {
      throwResponseError(response)
    }
    return response.data as T
  }

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

  updateThread(threadId: string, patch: Partial<ThreadSummary>): void {
    const thread = this.requireThread(threadId)
    this.saveThread({ ...thread, ...patch, updatedAt: new Date().toISOString() })
  }

  requireThread(threadId: string): ThreadSummary {
    const thread = this.threads.get(threadId)
    if (!thread) {
      throw new Error(`thread not found: ${threadId}`)
    }
    return thread
  }

  private hasWorker(threadId: string): boolean {
    return this.pool.listLeases().some((lease) => lease.threadId === threadId)
  }

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

export function throwResponseError(response: WorkerResponseEnvelope): never {
  const message = response.error?.message ?? `worker command failed: ${response.command}`
  throw new Error(message)
}

function isMissingWorkerResponse(response: WorkerResponseEnvelope): boolean {
  return response.error?.code === 'thread_not_found' || response.error?.code === 'worker_not_found'
}
