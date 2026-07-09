import { statSync } from 'node:fs'
import type {
  LoadSessionTreeBranchesInput,
  LoadSessionTreeBranchesResult,
  SessionTreeBranchEntryRow,
  SessionTreeBranchFilter,
  SessionTreeBranchRow,
  SessionTreeBranchSegmentRow
} from '@shared/coding-agent/types'
import type {
  SessionEntry,
  SessionTreeNode
} from '@coding-agent-src/core/session-manager'
import { loadSessionManagerModule } from './session-manager-lazy'

interface FlatSessionTreeEntry {
  node: SessionTreeNode
  depth: number
  visualDepth: number
}

interface SessionTreeBranchesCacheEntry {
  key: string
  currentEntryId: string | null
  flatEntries: FlatSessionTreeEntry[]
}

interface BuildSessionTreeBranchesInput
  extends Pick<LoadSessionTreeBranchesInput, 'query' | 'filter' | 'viewMode'> {
  currentEntryId?: string | null
}

const sessionTreeBranchesCache = new Map<string, SessionTreeBranchesCacheEntry>()

/**
 * 从完整 session JSONL 派生扁平 tree 视图。
 * @param sessionFile - session JSONL 文件。
 * @param input - 查询输入。
 * @returns 扁平 tree rows。
 */
export async function buildSessionTreeBranches(
  sessionFile: string,
  input: BuildSessionTreeBranchesInput = {}
): Promise<LoadSessionTreeBranchesResult> {
  const { currentEntryId: persistedCurrentEntryId, flatEntries } =
    await loadFlatSessionTree(sessionFile)
  const currentEntryId =
    input.currentEntryId !== undefined ? input.currentEntryId : persistedCurrentEntryId
  const filter = input.filter ?? 'default'
  const query = input.query?.trim().toLowerCase() ?? ''
  const viewMode = input.viewMode ?? 'branches'
  const shouldReturnEntryRows =
    viewMode === 'entries' || query.length > 0 || (filter !== 'default' && filter !== 'all')
  const visibleEntries = flatEntries.filter((entry) =>
    matchesBranchEntry(entry.node, filter, query)
  )
  const visibleEntryIds = new Set(visibleEntries.map((entry) => entry.node.entry.id))
  const rows = shouldReturnEntryRows
    ? visibleEntries.map((entry) => toBranchEntryRow(entry, currentEntryId, visibleEntryIds))
    : compressBranchEntries(visibleEntries, currentEntryId, visibleEntryIds)
  return {
    rows: normalizeBranchRowDepth(rows),
    totalEntries: flatEntries.length,
    visibleEntries: visibleEntries.length,
    currentEntryId
  }
}

async function loadFlatSessionTree(sessionFile: string): Promise<SessionTreeBranchesCacheEntry> {
  const cacheKey = getSessionTreeBranchesCacheKey(sessionFile)
  const cached = sessionTreeBranchesCache.get(sessionFile)
  if (cached?.key === cacheKey) {
    return cached
  }
  const { SessionManager } = await loadSessionManagerModule()
  const manager = SessionManager.open(sessionFile)
  const entry = {
    key: cacheKey,
    currentEntryId: manager.getLeafId(),
    flatEntries: flattenSessionTree(manager.getTree())
  }
  sessionTreeBranchesCache.set(sessionFile, entry)
  return entry
}

function getSessionTreeBranchesCacheKey(sessionFile: string): string {
  try {
    const stat = statSync(sessionFile)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return 'missing'
  }
}

function flattenSessionTree(
  nodes: SessionTreeNode[],
  depth = 0,
  visualDepth = 0
): FlatSessionTreeEntry[] {
  return nodes.flatMap((node) => {
    const nodeVisualDepth = visualDepth
    const childVisualDepth = visualDepth + (isSessionTreeBranchPoint(node) ? 1 : 0)
    return [
      { node, depth, visualDepth: nodeVisualDepth },
      ...flattenSessionTree(node.children, depth + 1, childVisualDepth)
    ]
  })
}

function compressBranchEntries(
  entries: FlatSessionTreeEntry[],
  currentEntryId: string | null,
  visibleEntryIds: Set<string>
): SessionTreeBranchRow[] {
  const result: SessionTreeBranchRow[] = []
  let segment: FlatSessionTreeEntry[] = []
  const flushSegment = (): void => {
    if (segment.length === 0) {
      return
    }
    const first = segment[0]
    const last = segment[segment.length - 1]
    result.push({
      kind: 'segment',
      id: `segment:${first.node.entry.id}:${last.node.entry.id}`,
      count: segment.length,
      firstEntryId: first.node.entry.id,
      lastEntryId: last.node.entry.id,
      depth: first.depth,
      visualDepth: first.visualDepth
    } satisfies SessionTreeBranchSegmentRow)
    segment = []
  }
  for (const entry of entries) {
    if (shouldShowBranchEntry(entry.node, currentEntryId, visibleEntryIds)) {
      flushSegment()
      result.push(toBranchEntryRow(entry, currentEntryId, visibleEntryIds))
      continue
    }
    segment.push(entry)
  }
  flushSegment()
  return result
}

function normalizeBranchRowDepth(rows: SessionTreeBranchRow[]): SessionTreeBranchRow[] {
  const stack: Array<{ originalDepth: number; visualDepth: number }> = []
  return rows.map((row) => {
    while (stack.length > 0 && stack[stack.length - 1].originalDepth >= row.visualDepth) {
      stack.pop()
    }
    const parent = stack[stack.length - 1]
    const visualDepth = row.visualDepth === 0 ? 0 : (parent?.visualDepth ?? -1) + 1
    stack.push({ originalDepth: row.visualDepth, visualDepth })
    return { ...row, visualDepth }
  })
}

function toBranchEntryRow(
  entry: FlatSessionTreeEntry,
  currentEntryId: string | null,
  visibleEntryIds: Set<string>
): SessionTreeBranchEntryRow {
  const node = entry.node
  const visibleChildCount = getVisibleSessionTreeChildCount(node, visibleEntryIds)
  return {
    kind: 'entry',
    id: node.entry.id,
    entryId: node.entry.id,
    parentId: node.entry.parentId,
    type: node.entry.type,
    timestamp: node.entry.timestamp,
    title: buildEntryTitle(node.entry),
    summary: buildEntrySummary(node.entry),
    label: node.label,
    labelTimestamp: node.labelTimestamp,
    depth: entry.depth,
    visualDepth: entry.visualDepth,
    childCount: visibleChildCount,
    leaf: visibleChildCount === 0,
    branchPoint: visibleChildCount > 1,
    current: node.entry.id === currentEntryId
  }
}

function shouldShowBranchEntry(
  node: SessionTreeNode,
  currentEntryId: string | null,
  visibleEntryIds: Set<string>
): boolean {
  const visibleChildCount = getVisibleSessionTreeChildCount(node, visibleEntryIds)
  return (
    node.entry.parentId === null ||
    node.entry.id === currentEntryId ||
    Boolean(node.label) ||
    visibleChildCount === 0 ||
    visibleChildCount > 1 ||
    node.entry.type === 'branch_summary' ||
    node.entry.type === 'compaction'
  )
}

function matchesBranchEntry(
  node: SessionTreeNode,
  filter: SessionTreeBranchFilter,
  query: string
): boolean {
  if (!matchesFilter(node, filter)) {
    return false
  }
  if (!query) {
    return true
  }
  return [
    node.entry.id,
    node.entry.type,
    buildEntryTitle(node.entry),
    buildEntrySummary(node.entry),
    node.label
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(query))
}

function matchesFilter(node: SessionTreeNode, filter: SessionTreeBranchFilter): boolean {
  switch (filter) {
    case 'user':
      return node.entry.type === 'message' && node.entry.message.role === 'user'
    case 'labeled':
      return Boolean(node.label)
    case 'no-tools':
      return !isSettingsSessionTreeNode(node) && !isToolSessionTreeNode(node)
    case 'default':
      return !isSettingsSessionTreeNode(node)
    case 'all':
      return true
  }
}

function isToolSessionTreeNode(node: SessionTreeNode): boolean {
  const title = buildEntryTitle(node.entry)
  return title.startsWith('toolResult:') || title.startsWith('tool:')
}

function isSettingsSessionTreeNode(node: SessionTreeNode): boolean {
  return ['label', 'custom', 'model_change', 'thinking_level_change'].includes(node.entry.type)
}

function getVisibleSessionTreeChildCount(
  node: SessionTreeNode,
  visibleEntryIds: Set<string>
): number {
  return node.children.filter(
    (child) => visibleEntryIds.has(child.entry.id) && shouldIndentSessionTreeNode(child)
  ).length
}

function shouldIndentSessionTreeNode(node: SessionTreeNode): boolean {
  return !['model_change', 'thinking_level_change'].includes(node.entry.type)
}

function isSessionTreeBranchPoint(node: SessionTreeNode): boolean {
  return node.children.filter(shouldIndentSessionTreeNode).length > 1
}

function buildEntryTitle(entry: SessionEntry): string {
  switch (entry.type) {
    case 'message':
      return `${entry.message.role}: ${truncateText(extractMessageText(entry.message), 48) || 'message'}`
    case 'thinking_level_change':
      return `thinking: ${entry.thinkingLevel}`
    case 'model_change':
      return `model: ${entry.provider}/${entry.modelId}`
    case 'compaction':
      return 'compaction'
    case 'branch_summary':
      return 'branch summary'
    case 'custom':
      return `custom: ${entry.customType}`
    case 'custom_message':
      return `custom message: ${entry.customType}`
    case 'label':
      return entry.label ? `label: ${entry.label}` : 'label removed'
    case 'session_info':
      return entry.name ? `session: ${entry.name}` : 'session info'
  }
}

function buildEntrySummary(entry: SessionEntry): string | undefined {
  switch (entry.type) {
    case 'message':
      return truncateText(extractMessageText(entry.message), 120) || undefined
    case 'compaction':
    case 'branch_summary':
      return truncateText(entry.summary, 120)
    case 'label':
      return entry.targetId
    default:
      return undefined
  }
}

function extractMessageText(message: unknown): string {
  if (!isRecord(message)) {
    return ''
  }
  const content = message.content
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .map((part) => {
      if (!isRecord(part)) {
        return ''
      }
      if (typeof part.text === 'string') {
        return part.text
      }
      if (typeof part.content === 'string') {
        return part.content
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
