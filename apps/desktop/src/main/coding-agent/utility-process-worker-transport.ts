/**
 * 本文件把 Electron utilityProcess 适配为 coding agent worker transport。
 */

import type { UtilityProcess } from 'electron'
import type { WorkerEnvelope, WorkerTransport } from './worker-types'

/**
 * 基于 Electron utilityProcess 的 worker 传输层实现。
 */
export class UtilityProcessWorkerTransport implements WorkerTransport {
  private readonly child: UtilityProcess
  private readonly messageListeners = new Set<(envelope: WorkerEnvelope) => void>()
  private readonly closeListeners = new Set<(reason: string) => void>()
  private diagnosticTail = ''
  private closed = false

  /**
   * 创建 UtilityProcessWorkerTransport 实例。
   * @param child - 已启动的 utility process。
   */
  constructor(child: UtilityProcess) {
    this.child = child
    child.on('message', (message) => {
      this.emitMessage(message as WorkerEnvelope)
    })
    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString()
      if (text.trim()) {
        this.diagnosticTail = `${this.diagnosticTail}${text}`.slice(-4000)
      }
    })
    child.stderr?.on('data', (chunk) => {
      this.diagnosticTail = `${this.diagnosticTail}${chunk.toString()}`.slice(-4000)
    })
    child.once('exit', (code) => {
      this.closed = true
      this.emitClose(withDiagnosticTail(`worker exited: code=${code}`, this.diagnosticTail))
    })
    child.once('error', (type, location, report) => {
      this.closed = true
      this.emitClose(
        withDiagnosticTail(
          `worker error: ${type} at ${location}; report=${report}`,
          this.diagnosticTail
        )
      )
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
    this.child.postMessage(envelope)
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
   * 关闭传输层并结束 utility process。
   */
  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.child.kill()
    this.emitClose(withDiagnosticTail('worker transport closed', this.diagnosticTail))
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
 * 将诊断输出尾部追加到原因字符串中。
 * @param reason - 原始原因。
 * @param diagnosticTail - 输出尾部内容。
 * @returns 拼接后的原因字符串。
 */
function withDiagnosticTail(reason: string, diagnosticTail: string): string {
  const tail = diagnosticTail.trim()
  return tail ? `${reason}; diagnostics: ${tail}` : reason
}
