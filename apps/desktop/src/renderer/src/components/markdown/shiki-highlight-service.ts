import type {
  HighlightJob,
  HighlightResponse,
  HighlightResponseJob,
  HighlightTokens
} from './shiki-highlight.worker'

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
  /** 是否按 append-only 流式代码处理。 */
  streaming?: boolean
}

export interface HighlightResult {
  /** 本次返回的 token。reset=true 时为全量，否则为增量追加 token。 */
  tokens: HighlightTokens
  /** 是否需要用 tokens 替换现有 token 流。 */
  reset: boolean
  /** 需要从现有 token 流尾部撤回的 token 数。 */
  recall: number
  /** 对应的任务 key。 */
  job: HighlightResponseJob
}

const MAX_CODE_SIZE = 200 * 1024
const MAX_STREAM_HASH_ENTRIES = 128
const TASK_TIMEOUT_MS = 3000

interface StreamHashEntry {
  code: string
  hash: number
}

function appendCodeHash(hash: number, code: string, startIndex = 0): number {
  let nextHash = hash
  for (let index = startIndex; index < code.length; index += 1) {
    nextHash = ((nextHash << 5) - nextHash + code.charCodeAt(index)) | 0
  }
  return nextHash
}

function formatCodeHash(hash: number): string {
  return Math.abs(hash).toString(16)
}

function computeCodeHash(code: string): string {
  return formatCodeHash(appendCodeHash(0, code))
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
  private pending = new Map<
    string,
    { deferred: Deferred<HighlightResult | null>; timeout: ReturnType<typeof setTimeout> }
  >()
  private streamHashes = new Map<string, StreamHashEntry>()

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

  private getStreamHashKey(request: HighlightRequest): string {
    return `${request.messageId}:${request.blockIndex}:${request.lang}:${request.theme}`
  }

  private computeRequestCodeHash(request: HighlightRequest): string {
    const streamKey = this.getStreamHashKey(request)
    if (!request.streaming) {
      this.streamHashes.delete(streamKey)
      return computeCodeHash(request.code)
    }

    const existing = this.streamHashes.get(streamKey)
    const hash =
      existing && request.code.startsWith(existing.code)
        ? appendCodeHash(existing.hash, request.code, existing.code.length)
        : appendCodeHash(0, request.code)
    this.streamHashes.delete(streamKey)
    this.streamHashes.set(streamKey, { code: request.code, hash })
    while (this.streamHashes.size > MAX_STREAM_HASH_ENTRIES) {
      const oldestKey = this.streamHashes.keys().next().value
      if (oldestKey === undefined) break
      this.streamHashes.delete(oldestKey)
    }
    return formatCodeHash(hash)
  }

  private getKey(request: HighlightJob | HighlightResponseJob): string {
    return `${request.messageId}:${request.messageRevision}:${request.blockIndex}:${request.lang}:${request.codeHash}:${request.theme}`
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
    if (response.tokens) {
      entry.deferred.resolve({
        tokens: response.tokens,
        reset: response.reset ?? false,
        recall: response.recall ?? 0,
        job: response.job
      })
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

    const codeHash = this.computeRequestCodeHash(request)
    const requestWithHash: HighlightJob = {
      ...request,
      codeHash
    }
    const key = this.getKey(requestWithHash)
    const existing = this.pending.get(key)
    if (existing) {
      return existing.deferred.promise
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
    this.streamHashes.clear()
    this.worker?.terminate()
    this.worker = null
  }
}

export const shikiHighlightService = new ShikiHighlightService()
