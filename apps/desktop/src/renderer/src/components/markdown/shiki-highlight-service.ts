import type { HighlightJob, HighlightResponse } from './shiki-highlight.worker'

/**
 * Shiki 高亮服务。
 * 主线程封装：管理 Worker、去重、超时和过期结果丢弃。
 */

export interface HighlightRequest {
  /** 消息 ID。 */
  messageId: string
  /** 消息渲染版本号。 */
  messageRevision: number
  /** 代码块稳定标识。 */
  blockIndex: string
  /** 语言。 */
  lang: string
  /** 代码原文。 */
  code: string
  /** 主题名。 */
  theme: string
}

export interface HighlightResult {
  /** 高亮后的 HTML。 */
  html: string
  /** 对应的任务 key。 */
  job: HighlightJob
}

const MAX_CODE_SIZE = 200 * 1024
const TASK_TIMEOUT_MS = 3000

function computeCodeHash(code: string): string {
  let hash = 0
  for (let i = 0; i < code.length; i++) {
    hash = ((hash << 5) - hash + code.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(16)
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void
  let reject: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve: resolve!, reject: reject! }
}

class ShikiHighlightService {
  private worker: Worker | null = null
  private pending = new Map<string, { deferred: Deferred<HighlightResult | null>; timeout: ReturnType<typeof setTimeout> }>()

  constructor() {
    try {
      this.worker = new Worker(new URL('./shiki-highlight.worker.ts', import.meta.url), {
        type: 'module'
      })
      this.worker.onmessage = (event: MessageEvent<HighlightResponse>) => {
        this.handleMessage(event.data)
      }
      this.worker.onerror = (error) => {
        console.error('[ShikiHighlightService] worker error:', error)
      }
    } catch (error) {
      console.error('[ShikiHighlightService] failed to create worker:', error)
      this.worker = null
    }
  }

  private getKey(request: HighlightRequest | HighlightJob): string {
    const codeHash = 'codeHash' in request ? request.codeHash : computeCodeHash(request.code)
    return `${request.messageId}:${request.messageRevision}:${request.blockIndex}:${request.lang}:${codeHash}:${request.theme}`
  }

  private handleMessage(response: HighlightResponse): void {
    const key = this.getKey(response.job)
    const entry = this.pending.get(key)
    if (!entry) return

    this.pending.delete(key)
    clearTimeout(entry.timeout)

    if (response.error) {
      entry.deferred.resolve(null)
      return
    }
    if (response.html) {
      entry.deferred.resolve({ html: response.html, job: response.job })
      return
    }
    entry.deferred.resolve(null)
  }

  /**
   * 异步高亮代码块。
   * @param request - 高亮请求。
   * @returns 高亮结果；失败、超时或 Worker 不可用时返回 null。
   */
  async highlight(request: HighlightRequest): Promise<HighlightResult | null> {
    if (!this.worker) return null
    if (!request.code || request.code.length > MAX_CODE_SIZE) return null

    const key = this.getKey(request)
    const existing = this.pending.get(key)
    if (existing) {
      return existing.deferred.promise
    }

    const requestWithHash: HighlightJob = {
      ...request,
      codeHash: computeCodeHash(request.code)
    }

    const deferred = createDeferred<HighlightResult | null>()
    const timeout = setTimeout(() => {
      const entry = this.pending.get(key)
      if (entry) {
        this.pending.delete(key)
        entry.deferred.resolve(null)
      }
    }, TASK_TIMEOUT_MS)

    this.pending.set(key, { deferred, timeout })
    this.worker?.postMessage(requestWithHash)
    return deferred.promise
  }

  /**
   * 终止 Worker 并清理所有待处理请求。
   */
  dispose(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timeout)
      entry.deferred.resolve(null)
    }
    this.pending.clear()
    this.worker?.terminate()
    this.worker = null
  }
}

export const shikiHighlightService = new ShikiHighlightService()
