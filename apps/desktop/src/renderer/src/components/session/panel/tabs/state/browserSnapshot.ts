export const DEFAULT_BROWSER_SNAPSHOT_LIMIT = 50
export const MAX_BROWSER_SNAPSHOT_LIMIT = 200
export const MAX_BROWSER_SNAPSHOT_OFFSET = 10_000
export const BROWSER_SNAPSHOT_CONTEXT_BUDGET_BYTES = 24 * 1024
const BROWSER_SNAPSHOT_RESPONSE_BUDGET_BYTES = 23 * 1024
const MAX_URL_LENGTH = 2048
const MAX_TITLE_LENGTH = 200
const MAX_USER_AGENT_LENGTH = 512
const MAX_BODY_TEXT_LENGTH = 12_000
const MAX_ELEMENT_TEXT_LENGTH = 120
const MAX_ACCESSIBLE_TEXT_LENGTH = 120
const MAX_EMULATION_PLATFORM_LENGTH = 128
const MAX_PRESET_LENGTH = 64

export interface BrowserSnapshotOptions {
  limit: number
  offset: number
  includeHidden: boolean
}

export interface BrowserSnapshotElement {
  ref: string
  tagName: string
  text: string
  bounds: { x: number; y: number; width: number; height: number }
  accessibility: { role: string | null; name: string }
  state: { disabled: boolean; checked: boolean | null; expanded: boolean | null }
  inViewport: boolean
}

export interface BrowserSnapshotResult {
  url: string
  title: string
  viewport: { width: number; height: number; dpr: number }
  touch: number
  userAgent: string
  text: string
  textTruncated?: boolean
  interactive: BrowserSnapshotElement[]
  page: {
    total: number
    eligible: number
    scanned: number
    returned: number
    offset: number
    truncated: boolean
    hiddenExcluded: number
    scanTruncated: boolean
  }
  emulation?: unknown
  preset?: unknown
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  return Number.isInteger(value) ? Math.max(minimum, Math.min(maximum, value as number)) : fallback
}

export function resolveBrowserSnapshotOptions(
  payload: Record<string, unknown>
): BrowserSnapshotOptions {
  return {
    limit: boundedInteger(
      payload.limit,
      DEFAULT_BROWSER_SNAPSHOT_LIMIT,
      1,
      MAX_BROWSER_SNAPSHOT_LIMIT
    ),
    offset: boundedInteger(payload.offset, 0, 0, MAX_BROWSER_SNAPSHOT_OFFSET),
    includeHidden: payload.includeHidden === true
  }
}

function boundedString(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.slice(0, maximum) : ''
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function compactEmulation(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  return {
    enabled: input.enabled === true,
    width: finiteNumber(input.width),
    height: finiteNumber(input.height),
    deviceScaleFactor: finiteNumber(input.deviceScaleFactor),
    mobile: input.mobile === true,
    touch: input.touch === true,
    orientation: input.orientation === 'landscape' ? 'landscape' : 'portrait',
    ...(typeof input.userAgent === 'string'
      ? { userAgent: boundedString(input.userAgent, MAX_USER_AGENT_LENGTH) }
      : {}),
    ...(typeof input.platform === 'string'
      ? { platform: boundedString(input.platform, MAX_EMULATION_PLATFORM_LENGTH) }
      : {})
  }
}

function trimStringToBudget(
  value: string,
  assign: (next: string) => void,
  snapshot: BrowserSnapshotResult
): void {
  if (browserSnapshotSerializedBytes(snapshot) <= BROWSER_SNAPSHOT_RESPONSE_BUDGET_BYTES) return
  const characters = Array.from(value)
  let lower = 0
  let upper = characters.length
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2)
    assign(characters.slice(0, middle).join(''))
    if (browserSnapshotSerializedBytes(snapshot) <= BROWSER_SNAPSHOT_RESPONSE_BUDGET_BYTES) {
      lower = middle
    } else {
      upper = middle - 1
    }
  }
  assign(characters.slice(0, lower).join(''))
}

function fitSnapshotBaseToBudget(snapshot: BrowserSnapshotResult): void {
  if (browserSnapshotSerializedBytes(snapshot) > BROWSER_SNAPSHOT_RESPONSE_BUDGET_BYTES) {
    snapshot.page.truncated = true
  }
  trimStringToBudget(snapshot.text, (value) => (snapshot.text = value), snapshot)
  trimStringToBudget(snapshot.userAgent, (value) => (snapshot.userAgent = value), snapshot)
  trimStringToBudget(snapshot.url, (value) => (snapshot.url = value), snapshot)
  trimStringToBudget(snapshot.title, (value) => (snapshot.title = value), snapshot)

  const emulation = snapshot.emulation
  if (emulation && typeof emulation === 'object' && !Array.isArray(emulation)) {
    const record = emulation as Record<string, unknown>
    if (typeof record.userAgent === 'string') {
      trimStringToBudget(record.userAgent, (value) => (record.userAgent = value), snapshot)
    }
    if (typeof record.platform === 'string') {
      trimStringToBudget(record.platform, (value) => (record.platform = value), snapshot)
    }
  }
  if (typeof snapshot.preset === 'string') {
    trimStringToBudget(snapshot.preset, (value) => (snapshot.preset = value), snapshot)
  }

  if (browserSnapshotSerializedBytes(snapshot) > BROWSER_SNAPSHOT_RESPONSE_BUDGET_BYTES) {
    throw new Error('Browser snapshot metadata exceeds the context budget')
  }
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function compactElement(value: BrowserSnapshotElement): BrowserSnapshotElement {
  return {
    ref: boundedString(value.ref, 80),
    tagName: boundedString(value.tagName, 32),
    text: boundedString(value.text, MAX_ELEMENT_TEXT_LENGTH),
    bounds: {
      x: finiteNumber(value.bounds?.x),
      y: finiteNumber(value.bounds?.y),
      width: finiteNumber(value.bounds?.width),
      height: finiteNumber(value.bounds?.height)
    },
    accessibility: {
      role:
        typeof value.accessibility?.role === 'string'
          ? boundedString(value.accessibility.role, 80)
          : null,
      name: boundedString(value.accessibility?.name, MAX_ACCESSIBLE_TEXT_LENGTH)
    },
    state: {
      disabled: value.state?.disabled === true,
      checked: nullableBoolean(value.state?.checked),
      expanded: nullableBoolean(value.state?.expanded)
    },
    inViewport: value.inViewport === true
  }
}

export function browserSnapshotSerializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value, null, 2)).byteLength
}

/**
 * Product requirement: default snapshots are compact context indexes. Detailed attributes and
 * computed styles stay available through inspect, while this final guard keeps model context bounded.
 */
export function compactBrowserSnapshot(snapshot: BrowserSnapshotResult): BrowserSnapshotResult {
  const sourceInteractive = Array.isArray(snapshot.interactive) ? snapshot.interactive : []
  const emulation = compactEmulation(snapshot.emulation)
  const base: BrowserSnapshotResult = {
    url: boundedString(snapshot.url, MAX_URL_LENGTH),
    title: boundedString(snapshot.title, MAX_TITLE_LENGTH),
    viewport: {
      width: finiteNumber(snapshot.viewport?.width),
      height: finiteNumber(snapshot.viewport?.height),
      dpr: finiteNumber(snapshot.viewport?.dpr)
    },
    touch: finiteNumber(snapshot.touch),
    userAgent: boundedString(snapshot.userAgent, MAX_USER_AGENT_LENGTH),
    text: boundedString(snapshot.text, MAX_BODY_TEXT_LENGTH),
    ...(snapshot.textTruncated === true ? { textTruncated: true } : {}),
    interactive: [],
    page: {
      total: finiteNumber(snapshot.page?.total),
      eligible: finiteNumber(snapshot.page?.eligible),
      scanned: finiteNumber(snapshot.page?.scanned),
      returned: 0,
      offset: finiteNumber(snapshot.page?.offset),
      truncated: snapshot.page?.truncated === true,
      hiddenExcluded: finiteNumber(snapshot.page?.hiddenExcluded),
      scanTruncated: snapshot.page?.scanTruncated === true
    },
    ...(emulation === undefined ? {} : { emulation }),
    ...(typeof snapshot.preset === 'string'
      ? { preset: boundedString(snapshot.preset, MAX_PRESET_LENGTH) }
      : {})
  }

  fitSnapshotBaseToBudget(base)

  for (const value of sourceInteractive) {
    const candidate = compactElement(value)
    const next = [...base.interactive, candidate]
    const trial = {
      ...base,
      interactive: next,
      page: { ...base.page, returned: next.length }
    }
    if (browserSnapshotSerializedBytes(trial) > BROWSER_SNAPSHOT_RESPONSE_BUDGET_BYTES) {
      base.page.truncated = true
      break
    }
    base.interactive = next
  }

  base.page.returned = base.interactive.length
  if (base.interactive.length < sourceInteractive.length) base.page.truncated = true
  if (browserSnapshotSerializedBytes(base) > BROWSER_SNAPSHOT_RESPONSE_BUDGET_BYTES) {
    throw new Error('Browser snapshot exceeds the context budget')
  }
  return base
}
