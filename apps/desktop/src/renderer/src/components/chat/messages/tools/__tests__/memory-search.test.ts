import { describe, expect, it } from 'vitest'
import {
  getMemorySearchPresentation,
  type MemorySearchPresentation
} from '../support/memory-search'

describe('memory-search', () => {
  it('组合语义错误、失败标题和项目记忆目标', () => {
    expect(
      getMemorySearchPresentation({
        status: 'succeeded',
        isError: true,
        target: 'memory',
        project: 'meta-agent-harness'
      })
    ).toEqual({
      status: 'failed',
      name: '搜索记忆失败',
      target: 'memory',
      targetLabel: '项目记忆'
    })
  })

  it('区分项目记忆、全局记忆和未限定范围的记忆', () => {
    const presentation = (project: unknown): MemorySearchPresentation =>
      getMemorySearchPresentation({
        status: 'running',
        isError: false,
        target: 'memory',
        project
      })

    expect(presentation('meta-agent-harness').targetLabel).toBe('项目记忆')
    expect(presentation(null).targetLabel).toBe('全局记忆')
    expect(presentation(undefined).targetLabel).toBe('记忆')
  })

  it('保留其他记忆目标的文案并忽略未知目标', () => {
    const presentation = (target: string, project: unknown): MemorySearchPresentation =>
      getMemorySearchPresentation({ status: undefined, isError: false, target, project })

    expect(presentation('user', 'project-a').targetLabel).toBe('用户偏好')
    expect(presentation('failure', null).targetLabel).toBe('经验记录')
    expect(presentation('other', undefined).target).toBeUndefined()
  })
})
