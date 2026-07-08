/**
 * 本文件测试 Workspace 首屏数据加载编排。
 */

import { describe, expect, it, vi } from 'vitest'
import { loadWorkspaceStartupData } from '../workspace-startup'

describe('loadWorkspaceStartupData', () => {
  it('并行加载 projects 和 threads metadata', async () => {
    const events: string[] = []
    const projects = createDeferred<void>()
    const threads = createDeferred<void>()
    const loadProjects = vi.fn(() => {
      events.push('projects:start')
      return projects.promise.then(() => {
        events.push('projects:end')
      })
    })
    const loadThreads = vi.fn(() => {
      events.push('threads:start')
      return threads.promise.then(() => {
        events.push('threads:end')
      })
    })

    const loading = loadWorkspaceStartupData({ loadProjects, loadThreads })
    await Promise.resolve()

    expect(events).toEqual(['projects:start', 'threads:start'])
    expect(loadThreads).toHaveBeenCalledWith(undefined, {
      deferActiveSnapshot: true,
      restoreActiveThread: false
    })

    threads.resolve()
    await Promise.resolve()
    expect(events).toEqual(['projects:start', 'threads:start', 'threads:end'])

    projects.resolve()
    await loading
    expect(events).toEqual(['projects:start', 'threads:start', 'threads:end', 'projects:end'])
  })
})

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
} {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}
