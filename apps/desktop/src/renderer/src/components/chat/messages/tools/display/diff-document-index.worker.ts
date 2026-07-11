import {
  buildDiffDocumentIndex,
  getDiffDocumentTransferables,
  type TransferableDiffDocumentIndex
} from './diffDocumentIndex'

export interface DiffDocumentIndexWorkerRequest {
  requestId: number
  cacheKey: string
  source: string
}

export interface DiffDocumentIndexWorkerResponse {
  requestId: number
  cacheKey: string
  document?: TransferableDiffDocumentIndex
  error?: string
}

self.onmessage = (event: MessageEvent<DiffDocumentIndexWorkerRequest>) => {
  const { requestId, cacheKey, source } = event.data
  try {
    const indexed = buildDiffDocumentIndex(source)
    const document: TransferableDiffDocumentIndex = {
      lineStarts: indexed.lineStarts,
      lineEnds: indexed.lineEnds,
      textStarts: indexed.textStarts,
      kinds: indexed.kinds,
      lineNumbers: indexed.lineNumbers,
      lineCount: indexed.lineCount,
      contentColumns: indexed.contentColumns
    }
    const response: DiffDocumentIndexWorkerResponse = { requestId, cacheKey, document }
    self.postMessage(response, { transfer: getDiffDocumentTransferables(document) })
  } catch (error) {
    const response: DiffDocumentIndexWorkerResponse = {
      requestId,
      cacheKey,
      error: error instanceof Error ? error.message : String(error)
    }
    self.postMessage(response)
  }
}
