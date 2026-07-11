import { describe, expect, it } from 'vitest'
import {
  applyMemoryPanelMessage,
  selectThreadPanelMessage,
  type MemorySnapshot
} from '../memoryPanelMessage'

function snapshot(memory: string): MemorySnapshot {
  return {
    type: 'hermes.snapshot',
    project: 'project-a',
    entries: { memory: [memory], user: [], project: [], failure: [] },
    skills: [],
    limits: { memory: 1_000, user: 1_000, project: 1_000 }
  }
}

describe('memory panel message routing', () => {
  it('reads the panel message from the captured thread', () => {
    const runtimes = {
      a: { extensionPanelMessages: { memory: { message: 'from-a' } } },
      b: { extensionPanelMessages: { memory: { message: 'from-b' } } }
    }
    expect(selectThreadPanelMessage(runtimes, 'a', 'memory')).toBe('from-a')
  })

  it('atomically applies a matching refresh success snapshot', () => {
    const previous = snapshot('before')
    const refreshed = snapshot('after-refresh')

    expect(
      applyMemoryPanelMessage(
        {
          type: 'hermes.actionResult',
          requestId: 'refresh-a',
          result: { success: true },
          snapshot: refreshed
        },
        { requestId: 'refresh-a', kind: 'refresh' },
        previous
      )
    ).toEqual({ snapshot: refreshed, snapshotError: false, actionResult: { success: true } })
  })

  it('atomically applies a matching mutation success snapshot', () => {
    const previous = snapshot('before')
    const mutated = snapshot('after-add')

    expect(
      applyMemoryPanelMessage(
        {
          type: 'hermes.actionResult',
          requestId: 'mutation-a',
          result: { success: true },
          snapshot: mutated
        },
        { requestId: 'mutation-a', kind: 'add' },
        previous
      )
    ).toEqual({ snapshot: mutated, snapshotError: false, actionResult: { success: true } })
  })

  it('ignores action results that do not match the pending request id', () => {
    expect(
      applyMemoryPanelMessage(
        {
          type: 'hermes.actionResult',
          requestId: 'request-b',
          result: { success: true },
          snapshot: snapshot('wrong-request')
        },
        { requestId: 'request-a', kind: 'replace' },
        snapshot('current')
      )
    ).toBeNull()
  })

  it('does not overwrite the snapshot when a matching action fails', () => {
    const current = snapshot('current')

    expect(
      applyMemoryPanelMessage(
        {
          type: 'hermes.actionResult',
          requestId: 'request-a',
          result: { success: false, error: 'write failed' },
          snapshot: snapshot('must-not-apply')
        },
        { requestId: 'request-a', kind: 'remove' },
        current
      )
    ).toEqual({
      snapshot: current,
      snapshotError: false,
      actionResult: { success: false, error: 'write failed' }
    })
  })

  it('rejects a successful action without a complete snapshot', () => {
    const current = snapshot('current')

    expect(
      applyMemoryPanelMessage(
        { type: 'hermes.actionResult', requestId: 'request-a', result: { success: true } },
        { requestId: 'request-a', kind: 'replace' },
        current
      )
    ).toEqual({
      snapshot: current,
      snapshotError: true,
      actionResult: { success: true }
    })
  })
})
