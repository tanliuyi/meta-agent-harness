/**
 * 定义 desktop worker transport 的最小双向消息接口。
 */

import type { WorkerEnvelope } from '../protocol/envelope.ts'

export interface WorkerTransport {
  /** 发送一个 worker envelope。 */
  send(envelope: WorkerEnvelope): void
  /** 注册消息监听器，返回取消订阅函数。 */
  onMessage(listener: (envelope: WorkerEnvelope) => void): () => void
  /** 注册关闭监听器，返回取消订阅函数。 */
  onClose(listener: (reason: string) => void): () => void
  /** 关闭 transport。 */
  close(): void
}
