export type ChangesReviewAction = 'open' | 'reveal'
export type ChangesReviewFailureCode =
  | 'INVALID_INPUT'
  | 'MISSING_CWD'
  | 'NOT_IN_CHANGES'
  | 'OUTSIDE_WORKSPACE'
  | 'NOT_FOUND'
  | 'OPEN_FAILED'
  | 'UNKNOWN'

export interface ChangesReviewMetrics {
  impressions: number
  openAttempts: number
  openSuccesses: number
  revealAttempts: number
  revealSuccesses: number
  failuresByCode: Partial<Record<ChangesReviewFailureCode, number>>
}

export const CHANGES_REVIEW_METRICS_KEY = 'experiments.changes-review-launch.v1'
const FAILURE_CODES = [
  'INVALID_INPUT',
  'MISSING_CWD',
  'NOT_IN_CHANGES',
  'OUTSIDE_WORKSPACE',
  'NOT_FOUND',
  'OPEN_FAILED',
  'UNKNOWN'
] as const
const impressedThreads = new Set<string>()

export function emptyChangesReviewMetrics(): ChangesReviewMetrics {
  return {
    impressions: 0,
    openAttempts: 0,
    openSuccesses: 0,
    revealAttempts: 0,
    revealSuccesses: 0,
    failuresByCode: {}
  }
}

export function readChangesReviewMetrics(storage: Pick<Storage, 'getItem'>): ChangesReviewMetrics {
  try {
    const value = storage.getItem(CHANGES_REVIEW_METRICS_KEY)
    if (!value) return emptyChangesReviewMetrics()
    const parsed = JSON.parse(value) as Partial<ChangesReviewMetrics>
    const numberKeys = [
      'impressions',
      'openAttempts',
      'openSuccesses',
      'revealAttempts',
      'revealSuccesses'
    ] as const
    if (numberKeys.some((key) => !Number.isSafeInteger(parsed[key]) || (parsed[key] ?? -1) < 0)) {
      return emptyChangesReviewMetrics()
    }
    const failuresByCode = Object.fromEntries(
      FAILURE_CODES.flatMap((code) => {
        const count = parsed.failuresByCode?.[code]
        return Number.isSafeInteger(count) && (count ?? -1) >= 0 ? [[code, count]] : []
      })
    )
    return {
      impressions: parsed.impressions!,
      openAttempts: parsed.openAttempts!,
      openSuccesses: parsed.openSuccesses!,
      revealAttempts: parsed.revealAttempts!,
      revealSuccesses: parsed.revealSuccesses!,
      failuresByCode
    }
  } catch {
    return emptyChangesReviewMetrics()
  }
}

function updateMetrics(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  update: (metrics: ChangesReviewMetrics) => void
): void {
  try {
    const metrics = readChangesReviewMetrics(storage)
    update(metrics)
    storage.setItem(CHANGES_REVIEW_METRICS_KEY, JSON.stringify(metrics))
  } catch {
    // Metrics must never block the review action.
  }
}

export function recordChangesReviewImpression(storage: Storage, threadId: string): void {
  if (!threadId || impressedThreads.has(threadId)) return
  impressedThreads.add(threadId)
  updateMetrics(storage, (metrics) => {
    metrics.impressions += 1
  })
}

export function recordChangesReviewAttempt(storage: Storage, action: ChangesReviewAction): void {
  updateMetrics(storage, (metrics) => {
    metrics[action === 'open' ? 'openAttempts' : 'revealAttempts'] += 1
  })
}

export function recordChangesReviewSuccess(storage: Storage, action: ChangesReviewAction): void {
  updateMetrics(storage, (metrics) => {
    metrics[action === 'open' ? 'openSuccesses' : 'revealSuccesses'] += 1
  })
}

export function recordChangesReviewFailure(storage: Storage, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const code = FAILURE_CODES.find((candidate) => message.includes(candidate)) ?? 'UNKNOWN'
  updateMetrics(storage, (metrics) => {
    metrics.failuresByCode[code] = (metrics.failuresByCode[code] ?? 0) + 1
  })
}
