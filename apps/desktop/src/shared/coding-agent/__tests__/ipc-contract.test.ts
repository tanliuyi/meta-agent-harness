/**
 * 本文件测试 coding agent IPC 结构化错误契约。
 */

import { describe, expect, it } from 'vitest'
import { fail, ok, unwrapIpcResult } from '../ipc-contract'

describe('ipc-contract', () => {
  it('解包成功结果', () => {
    expect(unwrapIpcResult(ok({ value: 1 }))).toEqual({ value: 1 })
  })

  it('将异常转换为结构化错误且不暴露 stack', () => {
    const result = fail(new Error('project not found: project-a'))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: 'not_found',
        message: 'project not found: project-a',
        recoverable: true
      })
    }

    try {
      unwrapIpcResult(result)
      throw new Error('expected unwrap to throw')
    } catch (error) {
      expect(error).toMatchObject({
        name: 'CodingAgentIpcError',
        message: 'project not found: project-a',
        code: 'not_found',
        recoverable: true
      })
      expect((error as Error).stack).toBeUndefined()
    }
  })
})
