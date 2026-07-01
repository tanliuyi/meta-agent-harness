/**
 * 本文件把 Node 子进程 stdio 适配为 coding agent worker transport。
 */

import { createInterface } from 'node:readline'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { WorkerEnvelope, WorkerTransport } from './worker-types'
import { parseJsonlRecord, serializeJsonlRecord } from './jsonl'

export class StdioWorkerTransport implements WorkerTransport {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly messageListeners = new Set<(envelope: WorkerEnvelope) => void>()
  private readonly closeListeners = new Set<(reason: string) => void>()
  private stderrTail = ''
  private closed = false

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

  send(envelope: WorkerEnvelope): void {
    if (this.closed) {
      throw new Error('worker transport is closed')
    }
    this.child.stdin.write(serializeJsonlRecord(envelope))
  }

  onMessage(listener: (envelope: WorkerEnvelope) => void): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  onClose(listener: (reason: string) => void): () => void {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.child.kill()
    this.emitClose(withStderrTail('worker transport closed', this.stderrTail))
  }

  private fail(reason: string): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.child.kill()
    this.emitClose(withStderrTail(reason, this.stderrTail))
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

function formatLine(line: string): string {
  return JSON.stringify(line.slice(0, 500))
}

function withStderrTail(reason: string, stderrTail: string): string {
  const tail = stderrTail.trim()
  return tail ? `${reason}; stderr: ${tail}` : reason
}
