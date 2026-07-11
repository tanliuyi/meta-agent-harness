import { markRaw } from 'vue'
import type {
  DiffDocumentIndexWorkerRequest,
  DiffDocumentIndexWorkerResponse
} from './diff-document-index.worker'
import {
  buildDiffDocumentIndex,
  countDiffDocumentLines,
  type DiffDocumentIndex
} from './diffDocumentIndex'

const SYNC_INDEX_SOURCE_LIMIT = 100_000
const DOCUMENT_CACHE_LIMIT = 256
const DOCUMENT_CACHE_BYTE_LIMIT = 96 * 1024 * 1024
const LINE_COUNT_CACHE_LIMIT = 4096

type CachedDocument = {
  source: string
  document: DiffDocumentIndex
  byteSize: number
}

type PendingDocument = {
  requestId: number
  cacheKey: string
  source: string
  promise: Promise<DiffDocumentIndex | undefined>
  resolve: (document: DiffDocumentIndex | undefined) => void
}

type CachedLineCount = {
  source: string
  count: number
}

export class DiffDocumentIndexService {
  private worker: Worker | null | undefined
  private requestId = 0
  private generation = 0
  private documentCache = new Map<string, CachedDocument>()
  private documentCacheBytes = 0
  private lineCountCache = new Map<string, CachedLineCount>()
  private pendingByKey = new Map<string, PendingDocument>()
  private pendingByRequestId = new Map<number, PendingDocument>()

  constructor(private readonly documentCacheByteLimit = DOCUMENT_CACHE_BYTE_LIMIT) {}

  getLineCount(cacheKey: string, source: string): number {
    const cachedDocument = this.getCached(cacheKey, source)
    if (cachedDocument) {
      return cachedDocument.lineCount
    }

    const cached = this.lineCountCache.get(cacheKey)
    if (cached?.source === source) {
      this.touch(this.lineCountCache, cacheKey, cached)
      return cached.count
    }

    const count = countDiffDocumentLines(source)
    this.touch(this.lineCountCache, cacheKey, { source, count })
    this.trim(this.lineCountCache, LINE_COUNT_CACHE_LIMIT)
    return count
  }

  getCached(cacheKey: string, source: string): DiffDocumentIndex | undefined {
    const cached = this.documentCache.get(cacheKey)
    if (cached?.source !== source) {
      return undefined
    }
    this.touch(this.documentCache, cacheKey, cached)
    return cached.document
  }

  request(cacheKey: string, source: string): Promise<DiffDocumentIndex | undefined> {
    const cached = this.getCached(cacheKey, source)
    if (cached) {
      return Promise.resolve(cached)
    }

    const pending = this.pendingByKey.get(cacheKey)
    if (pending?.source === source) {
      return pending.promise
    }

    if (source.length <= SYNC_INDEX_SOURCE_LIMIT) {
      return Promise.resolve(this.cache(cacheKey, source, buildDiffDocumentIndex(source)))
    }

    const worker = this.getWorker()
    if (!worker) {
      return Promise.resolve().then(() =>
        this.cache(cacheKey, source, buildDiffDocumentIndex(source))
      )
    }

    let resolve!: (document: DiffDocumentIndex | undefined) => void
    const promise = new Promise<DiffDocumentIndex | undefined>((promiseResolve) => {
      resolve = promiseResolve
    })
    const requestId = ++this.requestId
    const pendingDocument = { requestId, cacheKey, source, promise, resolve }
    this.pendingByKey.set(cacheKey, pendingDocument)
    this.pendingByRequestId.set(requestId, pendingDocument)
    const request: DiffDocumentIndexWorkerRequest = { requestId, cacheKey, source }
    worker.postMessage(request)
    return promise
  }

  cancelPending(): void {
    this.generation += 1
    this.worker?.terminate()
    this.worker = undefined
    const pendingEntries = [...this.pendingByRequestId.values()]
    this.pendingByKey.clear()
    this.pendingByRequestId.clear()
    for (const pending of pendingEntries) {
      pending.resolve(undefined)
    }
  }

  reset(): void {
    this.cancelPending()
    this.documentCache.clear()
    this.documentCacheBytes = 0
    this.lineCountCache.clear()
  }

  private getWorker(): Worker | null {
    if (this.worker !== undefined) {
      return this.worker
    }
    try {
      this.worker = new Worker(new URL('./diff-document-index.worker.ts', import.meta.url), {
        type: 'module'
      })
      this.worker.onmessage = (event: MessageEvent<DiffDocumentIndexWorkerResponse>) => {
        this.handleWorkerResponse(event.data)
      }
      this.worker.onerror = () => {
        this.worker?.terminate()
        this.worker = null
        this.resolvePendingOnMainThread()
      }
    } catch {
      this.worker = null
    }
    return this.worker
  }

  private handleWorkerResponse(response: DiffDocumentIndexWorkerResponse): void {
    const pending = this.pendingByRequestId.get(response.requestId)
    if (!pending) {
      return
    }
    this.pendingByRequestId.delete(response.requestId)
    const isLatestRequest = this.pendingByKey.get(pending.cacheKey) === pending
    if (isLatestRequest) {
      this.pendingByKey.delete(pending.cacheKey)
    }

    const document = response.document
      ? markRaw({ source: pending.source, ...response.document })
      : buildDiffDocumentIndex(pending.source)
    pending.resolve(
      isLatestRequest ? this.cache(pending.cacheKey, pending.source, document) : document
    )
  }

  private resolvePendingOnMainThread(): void {
    const pendingEntries = [...this.pendingByRequestId.values()]
    const generation = this.generation
    this.pendingByKey.clear()
    this.pendingByRequestId.clear()
    for (const pending of pendingEntries) {
      queueMicrotask(() => {
        if (generation !== this.generation) {
          pending.resolve(undefined)
          return
        }
        pending.resolve(
          this.cache(pending.cacheKey, pending.source, buildDiffDocumentIndex(pending.source))
        )
      })
    }
  }

  private cache(cacheKey: string, source: string, document: DiffDocumentIndex): DiffDocumentIndex {
    const rawDocument = markRaw(document)
    const previous = this.documentCache.get(cacheKey)
    if (previous) {
      this.documentCacheBytes -= previous.byteSize
    }
    const cachedDocument = {
      source,
      document: rawDocument,
      byteSize: this.getDocumentByteSize(rawDocument)
    }
    this.touch(this.documentCache, cacheKey, cachedDocument)
    this.documentCacheBytes += cachedDocument.byteSize
    this.trimDocumentCache()
    this.touch(this.lineCountCache, cacheKey, { source, count: rawDocument.lineCount })
    this.trim(this.lineCountCache, LINE_COUNT_CACHE_LIMIT)
    return rawDocument
  }

  private getDocumentByteSize(document: DiffDocumentIndex): number {
    return (
      document.source.length * 2 +
      document.lineStarts.byteLength +
      document.lineEnds.byteLength +
      document.textStarts.byteLength +
      document.kinds.byteLength +
      document.lineNumbers.byteLength
    )
  }

  private trimDocumentCache(): void {
    while (
      this.documentCache.size > DOCUMENT_CACHE_LIMIT ||
      this.documentCacheBytes > this.documentCacheByteLimit
    ) {
      const staleKey = this.documentCache.keys().next().value
      if (staleKey === undefined) {
        return
      }
      const stale = this.documentCache.get(staleKey)
      this.documentCache.delete(staleKey)
      this.documentCacheBytes -= stale?.byteSize ?? 0
    }
  }

  private touch<Value>(cache: Map<string, Value>, key: string, value: Value): void {
    cache.delete(key)
    cache.set(key, value)
  }

  private trim<Value>(cache: Map<string, Value>, limit: number): void {
    while (cache.size > limit) {
      const staleKey = cache.keys().next().value
      if (staleKey === undefined) {
        return
      }
      cache.delete(staleKey)
    }
  }
}

export const diffDocumentIndexService = new DiffDocumentIndexService()
