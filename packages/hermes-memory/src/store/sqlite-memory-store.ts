import { DatabaseManager } from './db.js'
import { buildFallbackFts5Query, isFts5QueryError, normalizeFts5Query } from './fts-query.js'
import { normalizeMemoryLookupText } from './memory-lookup.js'
import type { MemoryCategory } from '../types.js'

const MEMORY_SELECT_COLUMNS = `
  id,
  project,
  target,
  category,
  content,
  failure_reason,
  tool_state,
  corrected_to,
  created,
  last_referenced
`

const FAILURE_CATEGORY_SET = new Set<MemoryCategory>([
  'failure',
  'correction',
  'insight',
  'preference',
  'convention',
  'tool-quirk'
])

/**
 * A memory entry stored in SQLite.
 */
export interface SqliteMemoryEntry {
  id: number
  project: string | null
  target: 'memory' | 'user' | 'failure'
  category: MemoryCategory | null
  content: string
  failureReason: string | null
  toolState: string | null
  correctedTo: string | null
  created: string
  lastReferenced: string
}

export interface SqliteMemorySyncInput {
  content: string
  target: 'memory' | 'user' | 'failure'
  project?: string | null
  category?: MemoryCategory | null
  failureReason?: string | null
  toolState?: string | null
  correctedTo?: string | null
  created?: string | null
  lastReferenced?: string | null
}

export interface SqliteMemorySyncResult {
  action: 'inserted' | 'existing'
  entry: SqliteMemoryEntry
}

export interface SqliteMemoryUpdateResult {
  matched: number
  updated: number
  entries: SqliteMemoryEntry[]
}

export interface SqliteMemoryRemoveResult {
  matched: number
  removed: number
}

export interface SqliteMemoryRemoveOptions {
  target: 'memory' | 'user' | 'failure'
  project?: string | null
}

export interface ParsedMarkdownMemoryEntry extends SqliteMemorySyncInput {}

function today(): string {
  return new Date().toISOString().split('T')[0]
}

function normalizeNullable(value?: string | null): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeCategory(value?: MemoryCategory | null): MemoryCategory | null {
  return value ?? null
}

function mapRow(row: {
  id: number
  project: string | null
  target: string
  category: string | null
  content: string
  failure_reason: string | null
  tool_state: string | null
  corrected_to: string | null
  created: string
  last_referenced: string
}): SqliteMemoryEntry {
  return {
    id: row.id,
    project: row.project,
    target: row.target as 'memory' | 'user' | 'failure',
    category: row.category as MemoryCategory | null,
    content: row.content,
    failureReason: row.failure_reason,
    toolState: row.tool_state,
    correctedTo: row.corrected_to,
    created: row.created,
    lastReferenced: row.last_referenced
  }
}

function buildScopeConditions(
  params: unknown[],
  target?: string,
  project?: string | null,
  category?: MemoryCategory | null
): string[] {
  const conditions: string[] = []

  if (target) {
    conditions.push('target = ?')
    params.push(target)
  }

  if (project !== undefined) {
    if (project === null) {
      conditions.push('project IS NULL')
    } else {
      conditions.push('project = ?')
      params.push(project)
    }
  }

  if (category !== undefined) {
    if (category === null) {
      conditions.push('category IS NULL')
    } else {
      conditions.push('category = ?')
      params.push(category)
    }
  }

  return conditions
}

function getMemoryById(dbManager: DatabaseManager, id: number): SqliteMemoryEntry | null {
  const db = dbManager.getDb()
  const row = db
    .prepare(
      `
    SELECT ${MEMORY_SELECT_COLUMNS}
    FROM memories
    WHERE id = ?
  `
    )
    .get(id) as
    | {
        id: number
        project: string | null
        target: string
        category: string | null
        content: string
        failure_reason: string | null
        tool_state: string | null
        corrected_to: string | null
        created: string
        last_referenced: string
      }
    | undefined

  return row ? mapRow(row) : null
}

function minDate(a: string, b: string): string {
  return a <= b ? a : b
}

function maxDate(a: string, b: string): string {
  return a >= b ? a : b
}

function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&')
}

function parseMetadataComment(raw: string): {
  text: string
  created: string
  lastReferenced: string
} {
  const match = raw.match(/^(.*?)\s*<!--\s*created=([^,]+),\s*last=([^>]+)\s*-->\s*$/)
  if (match) {
    return {
      text: match[1].trim(),
      created: match[2].trim(),
      lastReferenced: match[3].trim()
    }
  }

  const fallback = today()
  return {
    text: raw.trim(),
    created: fallback,
    lastReferenced: fallback
  }
}

/**
 * Add a memory entry to the SQLite store.
 */
export function addMemory(
  dbManager: DatabaseManager,
  content: string,
  target: 'memory' | 'user' | 'failure' = 'memory',
  project: string | null = null,
  category: MemoryCategory | null = null,
  failureReason: string | null = null,
  toolState: string | null = null,
  correctedTo: string | null = null,
  created = today(),
  lastReferenced = created
): SqliteMemoryEntry {
  const db = dbManager.getDb()

  const result = db
    .prepare(
      `
    INSERT INTO memories (project, target, category, content, failure_reason, tool_state, corrected_to, created, last_referenced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      project,
      target,
      category,
      content,
      failureReason,
      toolState,
      correctedTo,
      created,
      lastReferenced
    )

  return {
    id: Number(result.lastInsertRowid),
    project,
    target,
    category,
    content,
    failureReason,
    toolState,
    correctedTo,
    created,
    lastReferenced
  }
}

/**
 * Build the visible failure-memory text stored in Markdown.
 */
export interface ParsedFailureMemoryContent {
  content: string
  category: MemoryCategory
  failureReason: string | null
  toolState: string | null
  correctedTo: string | null
  project: string | null
}

export function formatFailureMemoryContent(
  content: string,
  options: {
    category: MemoryCategory
    failureReason?: string | null
    toolState?: string | null
    correctedTo?: string | null
    project?: string | null
  }
): string {
  const categoryTag = `[${options.category}]`
  const parts = [`${categoryTag} ${content.trim()}`.trim()]
  if (options.failureReason) parts.push(`Failed: ${options.failureReason}`)
  if (options.toolState) parts.push(`Tool state: ${options.toolState}`)
  if (options.correctedTo) parts.push(`Corrected to: ${options.correctedTo}`)
  if (options.project) parts.push(`Project: ${options.project}`)
  return parts.join(' — ')
}

export function parseFailureMemoryContent(text: string): ParsedFailureMemoryContent {
  const segments = text.trim().split(' — ')
  const first = segments.shift() ?? ''
  const categoryMatch = first.match(/^\[([^\]]+)\]\s*(.*)$/s)
  const category =
    categoryMatch && FAILURE_CATEGORY_SET.has(categoryMatch[1] as MemoryCategory)
      ? (categoryMatch[1] as MemoryCategory)
      : 'failure'
  const contentSegments = [categoryMatch ? categoryMatch[2].trim() : first.trim()]
  let failureReason: string | null = null
  let toolState: string | null = null
  let correctedTo: string | null = null
  let project: string | null = null

  for (const segment of segments) {
    if (segment.startsWith('Failed: ') && !failureReason)
      failureReason = normalizeNullable(segment.slice(8))
    else if (segment.startsWith('Tool state: ') && !toolState)
      toolState = normalizeNullable(segment.slice(12))
    else if (segment.startsWith('Corrected to: ') && !correctedTo)
      correctedTo = normalizeNullable(segment.slice(14))
    else if (segment.startsWith('Project: ') && !project)
      project = normalizeNullable(segment.slice(9))
    else contentSegments.push(segment)
  }

  return {
    content: contentSegments.filter(Boolean).join(' — '),
    category,
    failureReason,
    toolState,
    correctedTo,
    project
  }
}

/**
 * Parse a Markdown memory entry into SQLite sync fields.
 * Best-effort only: if failure metadata cannot be fully reconstructed,
 * content is still imported and available for search.
 */
export function parseMarkdownMemoryEntry(
  rawEntry: string,
  target: 'memory' | 'user' | 'failure',
  project: string | null = null
): ParsedMarkdownMemoryEntry {
  const { text, created, lastReferenced } = parseMetadataComment(rawEntry)
  const parsedProject = normalizeNullable(project)

  if (target !== 'failure') {
    return {
      content: text,
      target,
      project: parsedProject,
      created,
      lastReferenced
    }
  }

  const parsed = parseFailureMemoryContent(text)
  return {
    content: text,
    target: 'failure',
    project: parsedProject,
    category: parsed.category,
    failureReason: parsed.failureReason,
    toolState: parsed.toolState,
    correctedTo: parsed.correctedTo,
    created,
    lastReferenced
  }
}

export interface ProjectMemoryIdentityMigrationResult {
  migrated: number
  merged: number
}

/**
 * Move legacy basename-scoped SQLite rows to a path-derived project id.
 * Existing rows under the new id are merged through the normal sync identity.
 */
export function migrateProjectMemoryIdentity(
  dbManager: DatabaseManager,
  legacyProject: string,
  projectId: string
): ProjectMemoryIdentityMigrationResult {
  const legacy = legacyProject.trim()
  const next = projectId.trim()
  if (!legacy || !next || legacy === next) return { migrated: 0, merged: 0 }

  const db = dbManager.getDb()
  const operation = (): ProjectMemoryIdentityMigrationResult => {
    const rows = db
      .prepare(
        `
      SELECT ${MEMORY_SELECT_COLUMNS}
      FROM memories
      WHERE project = ?
      ORDER BY id ASC
    `
      )
      .all(legacy) as Array<{
      id: number
      project: string | null
      target: 'memory' | 'user' | 'failure'
      category: MemoryCategory | null
      content: string
      failure_reason: string | null
      tool_state: string | null
      corrected_to: string | null
      created: string
      last_referenced: string
    }>

    let migrated = 0
    let merged = 0
    for (const row of rows) {
      const existing = db
        .prepare(
          `
        SELECT id FROM memories
        WHERE project = ? AND target = ? AND category IS ? AND content = ?
        ORDER BY id ASC LIMIT 1
      `
        )
        .get(next, row.target, row.category, row.content) as { id: number } | undefined

      if (existing) {
        syncMemoryEntry(dbManager, {
          project: next,
          target: row.target,
          category: row.category,
          content: row.content,
          failureReason: row.failure_reason,
          toolState: row.tool_state,
          correctedTo: row.corrected_to,
          created: row.created,
          lastReferenced: row.last_referenced
        })
        db.prepare('DELETE FROM memories WHERE id = ?').run(row.id)
        merged++
      } else {
        db.prepare('UPDATE memories SET project = ? WHERE id = ?').run(next, row.id)
        migrated++
      }
    }
    return { migrated, merged }
  }

  return db.transaction ? db.transaction(operation)() : operation()
}

/**
 * Idempotently sync a Markdown-backed memory entry into SQLite.
 * Duplicate identity is exact: project + target + category + content.
 */
export function syncMemoryEntry(
  dbManager: DatabaseManager,
  input: SqliteMemorySyncInput
): SqliteMemorySyncResult {
  const db = dbManager.getDb()
  const content = input.content.trim()
  const project = normalizeNullable(input.project)
  const category = normalizeCategory(input.category)
  const failureReason = normalizeNullable(input.failureReason)
  const toolState = normalizeNullable(input.toolState)
  const correctedTo = normalizeNullable(input.correctedTo)
  const created = input.created?.trim() || today()
  const lastReferenced = input.lastReferenced?.trim() || created

  const params: unknown[] = []
  const conditions = buildScopeConditions(params, input.target, project, category)
  conditions.push('content = ?')
  params.push(content)

  const existing = db
    .prepare(
      `
    SELECT ${MEMORY_SELECT_COLUMNS}
    FROM memories
    WHERE ${conditions.join(' AND ')}
    ORDER BY id ASC
    LIMIT 1
  `
    )
    .get(...params) as
    | {
        id: number
        project: string | null
        target: string
        category: string | null
        content: string
        failure_reason: string | null
        tool_state: string | null
        corrected_to: string | null
        created: string
        last_referenced: string
      }
    | undefined

  if (!existing) {
    return {
      action: 'inserted',
      entry: addMemory(
        dbManager,
        content,
        input.target,
        project,
        category,
        failureReason,
        toolState,
        correctedTo,
        created,
        lastReferenced
      )
    }
  }

  const updatedCreated = minDate(existing.created, created)
  const updatedLastReferenced = maxDate(existing.last_referenced, lastReferenced)
  const updatedCategory = (existing.category as MemoryCategory | null) ?? category
  const updatedFailureReason = existing.failure_reason ?? failureReason
  const updatedToolState = existing.tool_state ?? toolState
  const updatedCorrectedTo = existing.corrected_to ?? correctedTo

  db.prepare(
    `
    UPDATE memories
    SET category = ?, failure_reason = ?, tool_state = ?, corrected_to = ?, created = ?, last_referenced = ?
    WHERE id = ?
  `
  ).run(
    updatedCategory,
    updatedFailureReason,
    updatedToolState,
    updatedCorrectedTo,
    updatedCreated,
    updatedLastReferenced,
    existing.id
  )

  return {
    action: 'existing',
    entry: getMemoryById(dbManager, existing.id)!
  }
}

/**
 * Best-effort substring replacement for SQLite-backed memory sync.
 * Updates all matches in the scoped slice to recover from prior duplicate rows.
 */
export function replaceSyncedMemories(
  dbManager: DatabaseManager,
  oldText: string,
  updates: {
    content: string
    target: 'memory' | 'user' | 'failure'
    project?: string | null
    category?: MemoryCategory | null
    failureReason?: string | null
    toolState?: string | null
    correctedTo?: string | null
    lastReferenced?: string | null
  }
): SqliteMemoryUpdateResult {
  const db = dbManager.getDb()
  const normalizedOldText = normalizeMemoryLookupText(oldText)
  if (!normalizedOldText) return { matched: 0, updated: 0, entries: [] }
  const params: unknown[] = []
  const conditions = buildScopeConditions(params, updates.target, updates.project ?? undefined)
  conditions.push(`content LIKE ? ESCAPE '\\'`)
  params.push(`%${escapeLikePattern(normalizedOldText)}%`)

  const rows = db
    .prepare(
      `
    SELECT ${MEMORY_SELECT_COLUMNS}
    FROM memories
    WHERE ${conditions.join(' AND ')}
    ORDER BY id ASC
  `
    )
    .all(...params) as Array<{
    id: number
    project: string | null
    target: string
    category: string | null
    content: string
    failure_reason: string | null
    tool_state: string | null
    corrected_to: string | null
    created: string
    last_referenced: string
  }>

  if (rows.length === 0) {
    return { matched: 0, updated: 0, entries: [] }
  }

  const nextLastReferenced = updates.lastReferenced?.trim() || today()

  for (const row of rows) {
    db.prepare(
      `
      UPDATE memories
      SET content = ?,
          project = ?,
          category = ?,
          failure_reason = ?,
          tool_state = ?,
          corrected_to = ?,
          last_referenced = ?
      WHERE id = ?
    `
    ).run(
      updates.content.trim(),
      updates.project === undefined ? row.project : normalizeNullable(updates.project),
      updates.category === undefined ? row.category : updates.category,
      updates.failureReason === undefined
        ? row.failure_reason
        : normalizeNullable(updates.failureReason),
      updates.toolState === undefined ? row.tool_state : normalizeNullable(updates.toolState),
      updates.correctedTo === undefined ? row.corrected_to : normalizeNullable(updates.correctedTo),
      nextLastReferenced,
      row.id
    )
  }

  return {
    matched: rows.length,
    updated: rows.length,
    entries: rows
      .map((row) => getMemoryById(dbManager, row.id))
      .filter((entry): entry is SqliteMemoryEntry => entry !== null)
  }
}

export function replaceCanonicalSyncedMemory(
  dbManager: DatabaseManager,
  oldText: string,
  content: string,
  target: 'memory' | 'user' | 'failure',
  project: string | null
): SqliteMemoryUpdateResult {
  const failure = target === 'failure' ? parseFailureMemoryContent(content) : null
  const scopedProject = failure ? failure.project : project
  return replaceSyncedMemories(dbManager, oldText, {
    content,
    target,
    project: scopedProject,
    category: failure?.category,
    failureReason: failure?.failureReason,
    toolState: failure?.toolState,
    correctedTo: failure?.correctedTo
  })
}

/**
 * Best-effort substring removal for SQLite-backed memory sync.
 * Deletes all matches in the scoped slice to recover from prior duplicate rows.
 */
export function removeSyncedMemories(
  dbManager: DatabaseManager,
  oldText: string,
  options: SqliteMemoryRemoveOptions
): SqliteMemoryRemoveResult {
  const db = dbManager.getDb()
  const normalizedOldText = normalizeMemoryLookupText(oldText)
  if (!normalizedOldText) return { matched: 0, removed: 0 }
  const params: unknown[] = []
  const conditions = buildScopeConditions(params, options.target, options.project ?? undefined)
  conditions.push(`content LIKE ? ESCAPE '\\'`)
  params.push(`%${escapeLikePattern(normalizedOldText)}%`)

  const matchingIds = db
    .prepare(
      `
    SELECT id
    FROM memories
    WHERE ${conditions.join(' AND ')}
  `
    )
    .all(...params) as Array<{ id: number }>

  if (matchingIds.length === 0) {
    return { matched: 0, removed: 0 }
  }

  const deleteParams = matchingIds.map((row) => row.id)
  const placeholders = deleteParams.map(() => '?').join(', ')
  const result = db
    .prepare(`DELETE FROM memories WHERE id IN (${placeholders})`)
    .run(...deleteParams)

  return {
    matched: matchingIds.length,
    removed: result.changes
  }
}

/**
 * Exact removal for Markdown entries whose full content is known.
 * Used for FIFO eviction cleanup, where substring matching could remove
 * unrelated SQLite mirror rows that merely contain the evicted text.
 */
export function removeExactSyncedMemories(
  dbManager: DatabaseManager,
  content: string,
  options: SqliteMemoryRemoveOptions
): SqliteMemoryRemoveResult {
  const db = dbManager.getDb()
  const params: unknown[] = []
  const conditions = buildScopeConditions(params, options.target, options.project ?? undefined)
  conditions.push('content = ?')
  params.push(content.trim())

  const matchingIds = db
    .prepare(
      `
    SELECT id
    FROM memories
    WHERE ${conditions.join(' AND ')}
  `
    )
    .all(...params) as Array<{ id: number }>

  if (matchingIds.length === 0) {
    return { matched: 0, removed: 0 }
  }

  const deleteParams = matchingIds.map((row) => row.id)
  const placeholders = deleteParams.map(() => '?').join(', ')
  const result = db
    .prepare(`DELETE FROM memories WHERE id IN (${placeholders})`)
    .run(...deleteParams)

  return {
    matched: matchingIds.length,
    removed: result.changes
  }
}

/**
 * Search memories using FTS5.
 */
export function searchMemories(
  dbManager: DatabaseManager,
  query: string,
  options: { project?: string; target?: string; category?: MemoryCategory; limit?: number } = {}
): SqliteMemoryEntry[] {
  if (query.trim().length === 0) {
    return []
  }

  const db = dbManager.getDb()
  const { project, target, category, limit = 10 } = options

  const conditions: string[] = []
  const params: unknown[] = []

  // FTS5 match via subquery with escaped query
  const normalizedQuery = normalizeFts5Query(query)
  if (normalizedQuery.length === 0) {
    return []
  }

  const runSearch = (matchQuery: string): SqliteMemoryEntry[] => {
    const conditions: string[] = []
    const params: unknown[] = []

    conditions.push('m.id IN (SELECT rowid FROM memory_fts WHERE memory_fts MATCH ?)')
    params.push(matchQuery)

    if (project !== undefined) {
      if (project === null) {
        conditions.push('m.project IS NULL')
      } else {
        conditions.push('m.project = ?')
        params.push(project)
      }
    }

    if (target) {
      conditions.push('m.target = ?')
      params.push(target)
    }

    if (category) {
      conditions.push('m.category = ?')
      params.push(category)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const sql = `
      SELECT ${MEMORY_SELECT_COLUMNS}
      FROM memories m
      ${whereClause}
      ORDER BY m.last_referenced DESC
      LIMIT ?
    `

    try {
      const rows = db.prepare(sql).all(...params, limit) as Array<{
        id: number
        project: string | null
        target: string
        category: string | null
        content: string
        failure_reason: string | null
        tool_state: string | null
        corrected_to: string | null
        created: string
        last_referenced: string
      }>

      return rows.map(mapRow)
    } catch (err) {
      if (isFts5QueryError(err)) {
        return []
      }
      throw err
    }
  }

  const exactResults = runSearch(normalizedQuery)
  if (exactResults.length > 0) {
    return exactResults
  }

  const fallbackQuery = buildFallbackFts5Query(query)
  if (!fallbackQuery || fallbackQuery === normalizedQuery) {
    return exactResults
  }

  return runSearch(fallbackQuery)
}

/**
 * Get all memories, optionally filtered.
 */
export function getMemories(
  dbManager: DatabaseManager,
  options: { project?: string | null; target?: string; category?: MemoryCategory } = {}
): SqliteMemoryEntry[] {
  const db = dbManager.getDb()
  const { project, target, category } = options

  const conditions: string[] = []
  const params: unknown[] = []

  if (project !== undefined) {
    if (project === null) {
      conditions.push('project IS NULL')
    } else {
      conditions.push('project = ?')
      params.push(project)
    }
  }

  if (target) {
    conditions.push('target = ?')
    params.push(target)
  }

  if (category) {
    conditions.push('category = ?')
    params.push(category)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const rows = db
    .prepare(
      `
    SELECT ${MEMORY_SELECT_COLUMNS}
    FROM memories
    ${whereClause}
    ORDER BY last_referenced DESC
  `
    )
    .all(...params) as Array<{
    id: number
    project: string | null
    target: string
    category: string | null
    content: string
    failure_reason: string | null
    tool_state: string | null
    corrected_to: string | null
    created: string
    last_referenced: string
  }>

  return rows.map(mapRow)
}

/**
 * Remove a memory by ID.
 */
export function removeMemory(dbManager: DatabaseManager, id: number): boolean {
  const db = dbManager.getDb()
  const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id)
  return result.changes > 0
}

/**
 * Get recent failure memories (last N days).
 */
export function getRecentFailures(
  dbManager: DatabaseManager,
  maxAgeDays = 7,
  project?: string | null
): SqliteMemoryEntry[] {
  const db = dbManager.getDb()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - maxAgeDays)
  const cutoffStr = cutoff.toISOString().split('T')[0]

  const conditions: string[] = ['target = ?', 'created >= ?']
  const params: unknown[] = ['failure', cutoffStr]

  if (project !== undefined) {
    if (project === null) {
      conditions.push('project IS NULL')
    } else {
      conditions.push('(project = ? OR project IS NULL)')
      params.push(project)
    }
  }

  const rows = db
    .prepare(
      `
    SELECT ${MEMORY_SELECT_COLUMNS}
    FROM memories
    WHERE ${conditions.join(' AND ')}
    ORDER BY created DESC
    LIMIT 5
  `
    )
    .all(...params) as Array<{
    id: number
    project: string | null
    target: string
    category: string | null
    content: string
    failure_reason: string | null
    tool_state: string | null
    corrected_to: string | null
    created: string
    last_referenced: string
  }>

  return rows.map(mapRow)
}

/**
 * Update a memory's last_referenced date.
 */
export function touchMemory(dbManager: DatabaseManager, id: number): void {
  const db = dbManager.getDb()
  db.prepare('UPDATE memories SET last_referenced = ? WHERE id = ?').run(today(), id)
}

/**
 * Get memory statistics.
 */
export function getMemoryStats(dbManager: DatabaseManager): {
  total: number
  byProject: { project: string | null; count: number }[]
  byTarget: { target: string; count: number }[]
} {
  const db = dbManager.getDb()

  const total = (db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number })
    .count

  const byProject = db
    .prepare(
      `
    SELECT project, COUNT(*) as count
    FROM memories
    GROUP BY project
    ORDER BY count DESC
  `
    )
    .all() as { project: string | null; count: number }[]

  const byTarget = db
    .prepare(
      `
    SELECT target, COUNT(*) as count
    FROM memories
    GROUP BY target
    ORDER BY count DESC
  `
    )
    .all() as { target: string; count: number }[]

  return { total, byProject, byTarget }
}
