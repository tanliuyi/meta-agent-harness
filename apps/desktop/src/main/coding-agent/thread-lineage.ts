import { closeSync, existsSync, openSync, readSync, realpathSync } from 'node:fs'
import path from 'node:path'
import type { ThreadLineage, ThreadSummary } from '@shared/coding-agent/types'

interface SessionHeader {
  type?: string
  parentSession?: string
}

/**
 * 从 session JSONL 第一行读取 header。
 * @param sessionFile - session JSONL 文件路径。
 * @returns session header；文件不存在或格式不合法时返回 undefined。
 */
export function readSessionHeader(sessionFile: string): SessionHeader | undefined {
  try {
    const firstLine = readFirstLine(sessionFile)?.trim()
    if (!firstLine) {
      return undefined
    }
    const parsed = JSON.parse(firstLine) as unknown
    if (!isRecord(parsed)) {
      return undefined
    }
    return {
      type: typeof parsed.type === 'string' ? parsed.type : undefined,
      parentSession: typeof parsed.parentSession === 'string' ? parsed.parentSession : undefined
    }
  } catch {
    return undefined
  }
}

function readFirstLine(filePath: string): string | undefined {
  const fd = openSync(filePath, 'r')
  try {
    const chunks: Buffer[] = []
    const buffer = Buffer.allocUnsafe(4096)
    let totalBytes = 0
    while (totalBytes < 64 * 1024) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, totalBytes)
      if (bytesRead === 0) {
        break
      }
      const newlineIndex = buffer.subarray(0, bytesRead).indexOf(10)
      const chunkEnd = newlineIndex >= 0 ? newlineIndex : bytesRead
      chunks.push(Buffer.from(buffer.subarray(0, chunkEnd)))
      totalBytes += bytesRead
      if (newlineIndex >= 0) {
        break
      }
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/**
 * 从 session header parentSession 派生 desktop thread lineage。
 * @param thread - 当前 thread。
 * @param allThreads - 所有 thread，包含归档 thread。
 * @returns lineage；没有 parentSession 时返回 undefined。
 */
export function buildThreadLineage(
  thread: ThreadSummary,
  allThreads: ThreadSummary[]
): ThreadLineage | undefined {
  if (!thread.sessionFile) {
    return undefined
  }
  const parentSessionFile = readSessionHeader(thread.sessionFile)?.parentSession?.trim()
  if (!parentSessionFile) {
    return undefined
  }
  const currentSessionKey = canonicalizePath(thread.sessionFile)
  const parentSessionKey = canonicalizePath(parentSessionFile)
  if (currentSessionKey === parentSessionKey) {
    return {
      parentSessionFile,
      unavailable: true
    }
  }
  const parentThread = allThreads
    .filter((candidate) => candidate.threadId !== thread.threadId && candidate.sessionFile)
    .map((candidate) => ({
      thread: candidate,
      sessionKey: canonicalizePath(candidate.sessionFile!)
    }))
    .filter((candidate) => candidate.sessionKey === parentSessionKey)
    .sort((left, right) => right.thread.updatedAt.localeCompare(left.thread.updatedAt))[0]?.thread
  if (parentThread) {
    return {
      parentSessionFile,
      parentThreadId: parentThread.threadId,
      parentThreadTitle: parentThread.title,
      parentThreadArchivedAt: parentThread.archivedAt
    }
  }
  return {
    parentSessionFile,
    parentSessionExists: existsSync(parentSessionFile),
    parentSessionMissing: !existsSync(parentSessionFile)
  }
}

/**
 * 附加 lineage，返回新对象以避免把派生字段写回 thread registry。
 * @param thread - thread 摘要。
 * @param allThreads - 所有 thread。
 * @returns 带 lineage 的 thread 摘要。
 */
export function withThreadLineage(
  thread: ThreadSummary,
  allThreads: ThreadSummary[]
): ThreadSummary {
  const lineage = buildThreadLineage(thread, allThreads)
  return lineage ? { ...thread, lineage } : { ...thread, lineage: undefined }
}

function canonicalizePath(filePath: string): string {
  const absolutePath = path.resolve(filePath)
  try {
    return realpathSync.native(absolutePath)
  } catch {
    return absolutePath
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
