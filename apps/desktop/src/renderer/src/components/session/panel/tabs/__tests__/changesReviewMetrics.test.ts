import { describe, expect, it } from 'vitest'
import {
  CHANGES_REVIEW_METRICS_KEY,
  readChangesReviewMetrics,
  recordChangesReviewAttempt,
  recordChangesReviewFailure,
  recordChangesReviewImpression,
  recordChangesReviewSuccess
} from '../changesReviewMetrics'

function storage(initial?: string): Storage {
  const values = new Map<string, string>()
  if (initial) values.set(CHANGES_REVIEW_METRICS_KEY, initial)
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value)
  }
}

describe('changes review local metrics', () => {
  it('stores only aggregate impression and action counters', () => {
    const target = storage()
    recordChangesReviewImpression(target, `thread-${crypto.randomUUID()}`)
    recordChangesReviewAttempt(target, 'open')
    recordChangesReviewSuccess(target, 'open')
    recordChangesReviewAttempt(target, 'reveal')

    expect(readChangesReviewMetrics(target)).toMatchObject({
      impressions: 1,
      openAttempts: 1,
      openSuccesses: 1,
      revealAttempts: 1,
      revealSuccesses: 0
    })
    const serialized = target.getItem(CHANGES_REVIEW_METRICS_KEY) ?? ''
    expect(serialized).not.toContain('thread-')
    expect(serialized).not.toContain('path')
    expect(serialized).not.toContain('diff')
  })

  it('whitelists failure codes and resets malformed storage', () => {
    const target = storage('{broken')
    expect(readChangesReviewMetrics(target).impressions).toBe(0)
    recordChangesReviewFailure(target, new Error('OUTSIDE_WORKSPACE'))
    recordChangesReviewFailure(target, new Error('/secret/path'))
    expect(readChangesReviewMetrics(target).failuresByCode).toEqual({
      OUTSIDE_WORKSPACE: 1,
      UNKNOWN: 1
    })
  })

  it('never throws when storage writes fail', () => {
    const target = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      }
    } as unknown as Storage
    expect(() => recordChangesReviewAttempt(target, 'open')).not.toThrow()
  })
})
