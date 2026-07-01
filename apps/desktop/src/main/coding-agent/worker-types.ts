/**
 * 本文件定义 Electron main 内部 worker pool 需要的最小结构类型。
 */

export interface WorkerCommand {
  type: string
  [key: string]: unknown
}

export interface WorkerCommandEnvelope {
  kind: 'command'
  id: string
  command: WorkerCommand
}

export interface WorkerResponseEnvelope<T = unknown> {
  kind: 'response'
  id: string
  command: string
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    recoverable: boolean
    details?: unknown
  }
}

export type WorkerEnvelope =
  | WorkerCommandEnvelope
  | WorkerResponseEnvelope
  | {
      kind: 'event'
      eventType: 'canonical' | 'projection' | 'worker'
      threadId?: string
      event: unknown
    }

export interface StartThreadInput {
  threadId?: string
  cwd: string
  sessionFile?: string
  title?: string
  agentDir?: string
}

export interface WorkerSnapshot {
  workerId: string
  threadId?: string
  state: 'ready' | 'bound'
  diagnostics: unknown[]
}

export interface WorkerClient {
  readonly workerId: string
  readonly threadId?: string
  startThread(input: StartThreadInput): Promise<void>
  send(command: WorkerCommand): Promise<WorkerResponseEnvelope>
  onEvent?(listener: (event: WorkerEnvelope) => void): () => void
  snapshot(): WorkerSnapshot
  stop(reason: string): Promise<void>
}

export interface WorkerTransport {
  send(envelope: WorkerEnvelope): void
  onMessage(listener: (envelope: WorkerEnvelope) => void): () => void
  onClose(listener: (reason: string) => void): () => void
  close(): void
}

export interface WorkerLease {
  workerId: string
  threadId: string
  cwd: string
  sessionFile?: string
  acquiredAt: number
  lastActiveAt: number
}
