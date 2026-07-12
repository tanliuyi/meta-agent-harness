import { describe, expect, it } from 'vitest'
import {
  MAX_IDLE_BROWSER_SESSION_INSTANCES,
  reconcileBrowserSessionInstances,
  type BrowserSessionInstance
} from '../browserSessionInstances'

const instance = (scope: string, lastUsedAt: number, threadId = scope): BrowserSessionInstance => ({
  scope,
  threadId,
  lastUsedAt
})

function input(
  overrides: Partial<Parameters<typeof reconcileBrowserSessionInstances>[1]> = {}
): Parameters<typeof reconcileBrowserSessionInstances>[1] {
  return {
    busyScopes: [],
    now: 100,
    requiredThreadInstances: [],
    validThreadInstances: [],
    ...overrides
  }
}

describe('browser session instances', () => {
  it('removes archived thread scopes while retaining valid and required threads', () => {
    expect(
      reconcileBrowserSessionInstances(
        [instance('thread-a', 1), instance('thread-archived', 2)],
        input({
          requiredThreadInstances: [instance('thread-b', 3)],
          validThreadInstances: [instance('thread-a', 0), instance('thread-b', 0)]
        })
      )
    ).toEqual([instance('thread-a', 1), instance('thread-b', 3)])
  })

  it('keeps only the current draft scope', () => {
    expect(
      reconcileBrowserSessionInstances(
        [
          { scope: '__orphan__.old', lastUsedAt: 1 },
          { scope: '__orphan__.current', lastUsedAt: 2 }
        ],
        input({ currentDraftScope: '__orphan__.current' })
      )
    ).toEqual([{ scope: '__orphan__.current', lastUsedAt: 2 }])
  })

  it('links an existing draft guest to the thread that inherited its scope', () => {
    expect(
      reconcileBrowserSessionInstances(
        [{ scope: '__orphan__.main.1', lastUsedAt: 1 }],
        input({
          activeInstance: {
            scope: '__orphan__.main.1',
            threadId: 'thread-a',
            lastUsedAt: 100
          },
          activeScope: '__orphan__.main.1',
          validThreadInstances: [instance('__orphan__.main.1', 0, 'thread-a')]
        })
      )
    ).toEqual([{ scope: '__orphan__.main.1', threadId: 'thread-a', lastUsedAt: 100 }])
  })

  it('retains runtime-only threads so background commands can mount a guest', () => {
    expect(
      reconcileBrowserSessionInstances(
        [],
        input({
          requiredThreadInstances: [instance('thread-runtime', 100)],
          validThreadInstances: [instance('thread-runtime', 0)]
        })
      )
    ).toEqual([instance('thread-runtime', 100)])
  })

  it('keeps only the most recently used idle sessions without reordering survivors', () => {
    const current = Array.from({ length: 6 }, (_, index) =>
      instance(`thread-${index + 1}`, index + 1)
    )

    expect(
      reconcileBrowserSessionInstances(
        current,
        input({ validThreadInstances: current.map((item) => ({ ...item, lastUsedAt: 0 })) })
      ).map((item) => item.scope)
    ).toEqual(['thread-3', 'thread-4', 'thread-5', 'thread-6'])
    expect(MAX_IDLE_BROWSER_SESSION_INSTANCES).toBe(4)
  })

  it('retains required and busy sessions even when they exceed the idle limit', () => {
    const busy = Array.from({ length: 5 }, (_, index) => instance(`busy-${index}`, index))
    const required = Array.from({ length: 3 }, (_, index) => instance(`required-${index}`, 100))
    const valid = [...busy, ...required].map((item) => ({ ...item, lastUsedAt: 0 }))

    expect(
      reconcileBrowserSessionInstances(
        busy,
        input({
          busyScopes: busy.map((item) => item.scope),
          maxIdleInstances: 0,
          requiredThreadInstances: required,
          validThreadInstances: valid
        })
      ).map((item) => item.scope)
    ).toEqual([...busy, ...required].map((item) => item.scope))
  })

  it('touches the active instance in place so it wins a later idle eviction', () => {
    const current = [instance('thread-a', 1), instance('thread-b', 2)]
    const valid = current.map((item) => ({ ...item, lastUsedAt: 0 }))
    const activeResult = reconcileBrowserSessionInstances(
      current,
      input({ activeScope: 'thread-a', maxIdleInstances: 1, validThreadInstances: valid })
    )

    expect(activeResult.map((item) => item.scope)).toEqual(['thread-a', 'thread-b'])
    expect(activeResult[0].lastUsedAt).toBe(100)
    expect(
      reconcileBrowserSessionInstances(
        activeResult,
        input({ activeScope: 'thread-missing', maxIdleInstances: 1, validThreadInstances: valid })
      ).map((item) => item.scope)
    ).toEqual(['thread-a'])
  })
})
