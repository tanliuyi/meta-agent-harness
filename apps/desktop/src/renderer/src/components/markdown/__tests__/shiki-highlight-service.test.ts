import { beforeEach, describe, expect, it, vi } from 'vitest'

class WorkerMock {
  static instance: WorkerMock | undefined
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  posted: Array<Record<string, unknown>> = []
  terminated = false

  constructor() {
    WorkerMock.instance = this
  }

  postMessage(job: Record<string, unknown>): void {
    this.posted.push(job)
  }

  terminate(): void {
    this.terminated = true
  }

  respond(index: number): void {
    const job = this.posted[index]
    if (!job) throw new Error(`Missing worker job ${index}`)
    const responseJob = { ...job }
    delete responseJob.code
    this.onmessage?.(
      new MessageEvent('message', {
        data: { job: responseJob, reset: true, tokens: [{ content: 'token' }] }
      })
    )
  }
}

function computeCodeHash(code: string): string {
  let hash = 0
  for (let index = 0; index < code.length; index += 1) {
    hash = ((hash << 5) - hash + code.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(16)
}

describe('shikiHighlightService', () => {
  beforeEach(() => {
    vi.resetModules()
    WorkerMock.instance = undefined
    vi.stubGlobal('Worker', WorkerMock)
  })

  it('流式 append 使用与全量文本一致的滚动 hash', async () => {
    const { shikiHighlightService } = await import('../shiki-highlight-service')
    const baseRequest = {
      messageId: 'message-a',
      blockIndex: 'block-a',
      lang: 'ts',
      theme: 'github-dark',
      streaming: true
    }

    const firstCode = 'const value = 1\n'
    const firstResult = shikiHighlightService.highlight({
      ...baseRequest,
      messageRevision: 1,
      code: firstCode
    })
    expect(WorkerMock.instance?.posted[0]?.codeHash).toBe(computeCodeHash(firstCode))
    WorkerMock.instance?.respond(0)
    await firstResult

    const appendedCode = `${firstCode}console.log(value)\n`
    const appendedResult = shikiHighlightService.highlight({
      ...baseRequest,
      messageRevision: 2,
      code: appendedCode
    })
    expect(WorkerMock.instance?.posted[1]?.codeHash).toBe(computeCodeHash(appendedCode))
    WorkerMock.instance?.respond(1)
    const result = await appendedResult

    expect(result?.job).not.toHaveProperty('code')
    shikiHighlightService.dispose()
  })
})
