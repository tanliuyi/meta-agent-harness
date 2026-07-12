/**
 * 提供测试和进程内连接使用的内存 transport 实现。
 */

import type { WorkerEnvelope } from '../protocol/envelope.ts'
import type { WorkerTransport } from './transport.ts'

/**
 * 测试与进程内连接使用的内存 transport 实现。
 */
export class MemoryTransport implements WorkerTransport {
  private peer: MemoryTransport | undefined
  private readonly messageListeners = new Set<(envelope: WorkerEnvelope) => void>()
  private readonly closeListeners = new Set<(reason: string) => void>()
  private closed = false

  /**
   * 创建一对互相连接的内存 transport。
   * @returns [left, right] 两个 transport 实例。
   */
  static pair(): [MemoryTransport, MemoryTransport] {
    const left = new MemoryTransport()
    const right = new MemoryTransport()
    left.peer = right
    right.peer = left
    return [left, right]
  }

  /**
   * 发送一个 envelope 到对端。
   * @param envelope - 要发送的 envelope。
   */
  send(envelope: WorkerEnvelope): void {
    if (this.closed) {
      throw new Error('transport is closed')
    }
    if (!this.peer || this.peer.closed) {
      throw new Error('transport peer is closed')
    }
    this.peer.emitMessage(envelope)
  }

  /**
   * 注册消息监听器。
   * @param listener - 消息回调。
   * @returns 取消订阅函数。
   */
  onMessage(listener: (envelope: WorkerEnvelope) => void): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  /**
   * 注册关闭监听器。
   * @param listener - 关闭回调。
   * @returns 取消订阅函数。
   */
  onClose(listener: (reason: string) => void): () => void {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  /**
   * 关闭 transport，并通知对端。
   */
  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.emitClose('transport closed')
    this.peer?.emitClose('transport peer closed')
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
