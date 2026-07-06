/**
 * 本文件把普通 Node child_process IPC 适配为 coding agent worker transport。
 */

import type { ChildProcess } from 'node:child_process'
import type { WorkerEnvelope, WorkerTransport } from './worker-types'

/** 基于 Node child_process IPC 的 worker 传输层实现。 */
export class NodeIpcWorkerTransport implements WorkerTransport {
  private readonly child: ChildProcess
  private readonly messageListeners = new Set<(envelope: WorkerEnvelope) => void>()
  private readonly closeListeners = new Set<(reason: string) => void>()
  private diagnosticTail = ''
  private closed = false

  /**
   * 创建 NodeIpcWorkerTransport 实例。
   * @param child - 已 fork 的普通 Node 子进程。
   */
  constructor(child: ChildProcess) {
    this.child = child
    child.on('message', (message) => {
      this.emitMessage(message as WorkerEnvelope)
    })
    child.stdout?.on('data', (chunk) => {
      this.diagnosticTail = `${this.diagnosticTail}${chunk.toString()}`.slice(-4000)
    })
    child.stderr?.on('data', (chunk) => {
      this.diagnosticTail = `${this.diagnosticTail}${chunk.toString()}`.slice(-4000)
    })
    child.once('exit', (code, signal) => {
      this.closed = true
      this.emitClose(
        withDiagnosticTail(
          `node sidecar exited: code=${code} signal=${signal}`,
          this.diagnosticTail
        )
      )
    })
    child.once('error', (error) => {
      this.closed = true
      this.emitClose(
        withDiagnosticTail(`node sidecar error: ${error.message}`, this.diagnosticTail)
      )
    })
  }

  /**
   * 发送 worker 信封。
   * @param envelope - worker 信封。
   */
  send(envelope: WorkerEnvelope): void {
    if (this.closed || !this.child.connected || !this.child.send) {
      throw new Error('node sidecar transport is closed')
    }
    this.child.send(envelope)
  }

  /**
   * 注册消息监听器。
   * @param listener - 消息监听器。
   * @returns 取消监听函数。
   */
  onMessage(listener: (envelope: WorkerEnvelope) => void): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  /**
   * 注册关闭监听器。
   * @param listener - 关闭监听器。
   * @returns 取消监听函数。
   */
  onClose(listener: (reason: string) => void): () => void {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  /** 关闭传输层并结束 sidecar。 */
  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    if (this.child.connected) {
      this.child.disconnect()
    }
    this.child.kill()
    this.emitClose(withDiagnosticTail('node sidecar transport closed', this.diagnosticTail))
  }

  private emitMessage(envelope: WorkerEnvelope): void {
    for (const listener of this.messageListeners) {
      listener(envelope)
    }
  }

  private emitClose(reason: string): void {
    for (const listener of this.closeListeners) {
      listener(reason)
    }
  }
}

function withDiagnosticTail(reason: string, diagnosticTail: string): string {
  const tail = diagnosticTail.trim()
  return tail ? `${reason}; diagnostics: ${tail}` : reason
}
