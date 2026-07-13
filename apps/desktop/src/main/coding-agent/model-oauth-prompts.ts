import { randomUUID } from 'node:crypto'
import type {
  ModelOAuthLoginEvent,
  ModelOAuthPromptResponseInput
} from '@shared/coding-agent/types'

const defaultPromptTimeoutMs = 5 * 60 * 1000

export interface ModelOAuthPromptSession {
  ownerId?: number
  signal?: AbortSignal
  promptTimeoutMs?: number
}

export interface ModelOAuthPromptRequest {
  loginId: string
  provider: string
  ownerId?: number
  prompt: {
    message: string
    placeholder?: string
    allowEmpty?: boolean
    manualCode?: boolean
  }
  signal?: AbortSignal
  timeoutMs?: number
  onEvent?: (event: ModelOAuthLoginEvent) => void
}

interface PendingModelOAuthPrompt {
  loginId: string
  provider: string
  ownerId?: number
  resolve: (value: string) => void
  reject: (error: Error) => void
  cleanup: () => void
}

export class ModelOAuthPromptCoordinator {
  private readonly pending = new Map<string, PendingModelOAuthPrompt>()

  request(input: ModelOAuthPromptRequest): Promise<string> {
    if (input.signal?.aborted) {
      return Promise.reject(new Error('OAuth 输入请求已取消'))
    }

    const requestId = randomUUID()
    const timeoutMs = input.timeoutMs ?? defaultPromptTimeoutMs
    return new Promise<string>((resolve, reject) => {
      const abortHandler = (): void => {
        this.rejectRequest(requestId, new Error('OAuth 输入请求已取消'))
      }
      const timeout = setTimeout(() => {
        this.rejectRequest(requestId, new Error('OAuth 输入请求已超时'))
      }, timeoutMs)
      const cleanup = (): void => {
        clearTimeout(timeout)
        input.signal?.removeEventListener('abort', abortHandler)
      }
      this.pending.set(requestId, {
        loginId: input.loginId,
        provider: input.provider,
        ownerId: input.ownerId,
        resolve,
        reject,
        cleanup
      })
      input.signal?.addEventListener('abort', abortHandler, { once: true })
      try {
        input.onEvent?.({
          type: 'promptRequested',
          provider: input.provider,
          requestId,
          message: input.prompt.message,
          placeholder: input.prompt.placeholder,
          allowEmpty: input.prompt.allowEmpty,
          manualCode: input.prompt.manualCode
        })
      } catch (error) {
        this.rejectRequest(requestId, error instanceof Error ? error : new Error(String(error)))
      }
    }).then((value) => {
      if (input.prompt.allowEmpty === false && !value.trim()) {
        throw new Error(`${input.prompt.message} 不能为空`)
      }
      input.onEvent?.({ type: 'promptResolved', provider: input.provider, requestId })
      return value
    })
  }

  respond(input: ModelOAuthPromptResponseInput, ownerId?: number): void {
    const pending = this.pending.get(input.requestId)
    if (!pending || pending.provider !== input.provider) {
      throw new Error(`OAuth prompt request not found: ${input.requestId}`)
    }
    if (pending.ownerId !== undefined && pending.ownerId !== ownerId) {
      throw new Error(`OAuth prompt request owner mismatch: ${input.requestId}`)
    }
    if (input.cancelled) {
      this.rejectRequest(input.requestId, new Error('OAuth 输入已取消'))
      return
    }
    this.pending.delete(input.requestId)
    pending.cleanup()
    pending.resolve(input.value ?? '')
  }

  rejectLogin(loginId: string, message = 'OAuth 登录已结束'): void {
    this.rejectMatching((pending) => pending.loginId === loginId, message)
  }

  dispose(): void {
    this.rejectMatching(() => true, 'OAuth 登录已结束')
  }

  private rejectMatching(
    predicate: (pending: PendingModelOAuthPrompt) => boolean,
    message: string
  ): void {
    for (const [requestId, pending] of this.pending) {
      if (predicate(pending)) {
        this.rejectRequest(requestId, new Error(message))
      }
    }
  }

  private rejectRequest(requestId: string, error: Error): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    pending.cleanup()
    pending.reject(error)
  }
}
