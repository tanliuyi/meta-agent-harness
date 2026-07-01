/**
 * 本文件把 Node 子进程 stdio 适配为 coding agent worker transport。
 */

import { createInterface } from 'node:readline'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { WorkerEnvelope, WorkerTransport } from './worker-types'
import { parseJsonlRecord, serializeJsonlRecord } from './jsonl'

/**
 * 基于 Node 子进程 stdio 的 worker 传输层实现。
 */
export class StdioWorkerTransport implements WorkerTransport {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly messageListeners = new Set<(envelope: WorkerEnvelope) => void>()
  private readonly closeListeners = new Set<(reason: string) => void>()
  private stderrTail = ''
  private closed = false

  /**
   * 创建 StdioWorkerTransport 实例。
   * @param child - 已启动的子进程。
   */
  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      if (!line.trim()) {
        return
      }
      try {
        this.emitMessage(parseJsonlRecord<WorkerEnvelope>(line))
      } catch (error) {
        this.fail(
          `worker emitted non-JSONL stdout: ${formatLine(line)}; parse error: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    })
    child.stderr.on('data', (chunk) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString()}`.slice(-4000)
    })
    child.once('close', (code, signal) => {
      this.closed = true
      this.emitClose(
        withStderrTail(
          `worker exited: code=${code ?? 'null'} signal=${signal ?? 'null'}`,
          this.stderrTail
        )
      )
    })
    child.once('error', (error) => {
      this.closed = true
      this.emitClose(withStderrTail(error.message, this.stderrTail))
    })
  }

  /**
   * 发送 worker 信封。
   * @param envelope - worker 信封。
   * @throws 若传输层已关闭时抛出错误。
   */
  send(envelope: WorkerEnvelope): void {
    if (this.closed) {
      throw new Error('worker transport is closed')
    }
    this.child.stdin.write(serializeJsonlRecord(envelope))
  }

  /**
   * 注册消息监听器。
   * @param listener - 消息监听器。
   * @returns 取消监听的函数。
   */
  onMessage(listener: (envelope: WorkerEnvelope) => void): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  /**
   * 注册关闭监听器。
   * @param listener - 关闭监听器。
   * @returns 取消监听的函数。
   */
  onClose(listener: (reason: string) => void): () => void {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  /**
   * 关闭传输层并结束子进程。
   */
  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.child.kill()
    this.emitClose(withStderrTail('worker transport closed', this.stderrTail))
  }

  /**
   * 标记传输层失败并关闭。
   * @param reason - 失败原因。
   */
  private fail(reason: string): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.child.kill()
    this.emitClose(withStderrTail(reason, this.stderrTail))
  }

  /**
   * 向所有消息监听器分发消息。
   * @param envelope - worker 信封。
   */
  private emitMessage(envelope: WorkerEnvelope): void {
    for (const listener of this.messageListeners) {
      listener(envelope)
    }
  }

  /**
   * 向所有关闭监听器分发关闭事件。
   * @param reason - 关闭原因。
   */
  private emitClose(reason: string): void {
    for (const listener of this.closeListeners) {
      listener(reason)
    }
  }
}

/**
 * 格式化行用于错误信息，截断到 500 字符。
 * @param line - 原始行。
 * @returns 格式化后的字符串。
 */
function formatLine(line: string): string {
  return JSON.stringify(line.slice(0, 500))
}

/**
 * 将 stderr 尾部追加到原因字符串中。
 * @param reason - 原始原因。
 * @param stderrTail - stderr 尾部内容。
 * @returns 拼接后的原因字符串。
 */
function withStderrTail(reason: string, stderrTail: string): string {
  const tail = stderrTail.trim()
  return tail ? `${reason}; stderr: ${tail}` : reason
}
