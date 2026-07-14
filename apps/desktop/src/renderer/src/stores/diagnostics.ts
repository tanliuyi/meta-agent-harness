/**
 * diagnostics.ts - 统一诊断工作台状态。
 *
 * 汇总 worker/thread diagnostics、模型设置 diagnostics 和 Agent 设置 diagnostics。
 */

import type {
  AgentSettingsDiagnostic,
  ModelSettingsDiagnostic,
  ModelSettingsDiagnosticSeverity
} from '@shared/coding-agent/types'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import useAgentSettingsStore from './agent-settings'
import useModelSettingsStore from './model-settings'
import { codingAgentApi } from '@renderer/api'

export type DiagnosticsDomain = 'thread' | 'model' | 'agent'
export type DiagnosticsSeverity = ModelSettingsDiagnosticSeverity

export interface DiagnosticsItem {
  id: string
  domain: DiagnosticsDomain
  severity: DiagnosticsSeverity
  source: string
  message: string
  details?: string
  threadId?: string
  createdAt?: string
}

interface ThreadDiagnosticRecord {
  id?: string
  threadId?: string
  source?: string
  severity?: DiagnosticsSeverity
  message?: string
  details?: unknown
  createdAt?: string
}

const useDiagnosticsStore = defineStore('diagnostics', () => {
  const modelSettings = useModelSettingsStore()
  const agentSettings = useAgentSettingsStore()
  const loading = ref(false)
  const error = ref<string | null>(null)
  const threadDiagnostics = ref<DiagnosticsItem[]>([])

  const items = computed<DiagnosticsItem[]>(() =>
    [
      ...threadDiagnostics.value,
      ...modelSettings.diagnostics.map(toModelDiagnosticItem),
      ...agentSettings.diagnostics.map(toAgentDiagnosticItem)
    ].sort(sortDiagnostics)
  )

  const counts = computed(() => {
    return items.value.reduce(
      (next, item) => {
        next.total += 1
        next[item.severity] += 1
        next[item.domain] += 1
        return next
      },
      {
        total: 0,
        error: 0,
        warning: 0,
        info: 0,
        thread: 0,
        model: 0,
        agent: 0
      }
    )
  })

  async function load(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const [threadRecords] = await Promise.all([
        codingAgentApi.listDiagnostics(),
        modelSettings.snapshot ? undefined : modelSettings.load(),
        agentSettings.snapshot ? undefined : agentSettings.load()
      ])
      threadDiagnostics.value = threadRecords
        .map((record, index) => toThreadDiagnosticItem(record, index))
        .filter((item): item is DiagnosticsItem => Boolean(item))
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '诊断信息加载失败'
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    error,
    threadDiagnostics,
    items,
    counts,
    load
  }
})

function toThreadDiagnosticItem(record: unknown, index: number): DiagnosticsItem | undefined {
  if (!isRecord(record)) return undefined
  const diagnostic = record as ThreadDiagnosticRecord
  const message = typeof diagnostic.message === 'string' ? diagnostic.message : ''
  if (!message) return undefined

  return {
    id: diagnostic.id ?? `thread-${diagnostic.threadId ?? 'global'}-${index}`,
    domain: 'thread',
    severity: isSeverity(diagnostic.severity) ? diagnostic.severity : 'warning',
    source: diagnostic.source ?? 'worker',
    message,
    details: stringifyDetails(diagnostic.details),
    threadId: diagnostic.threadId,
    createdAt: diagnostic.createdAt
  }
}

function toModelDiagnosticItem(diagnostic: ModelSettingsDiagnostic): DiagnosticsItem {
  return {
    id: `model-${diagnostic.id}`,
    domain: 'model',
    severity: diagnostic.severity,
    source: diagnostic.source,
    message: diagnostic.message,
    details: diagnostic.details
  }
}

function toAgentDiagnosticItem(diagnostic: AgentSettingsDiagnostic): DiagnosticsItem {
  return {
    id: `agent-${diagnostic.id}`,
    domain: 'agent',
    severity: diagnostic.severity,
    source: diagnostic.source,
    message: diagnostic.message,
    details: diagnostic.details
  }
}

function sortDiagnostics(a: DiagnosticsItem, b: DiagnosticsItem): number {
  const severityDelta = severityRank(b.severity) - severityRank(a.severity)
  if (severityDelta !== 0) return severityDelta

  const aTime = a.createdAt ? Date.parse(a.createdAt) : 0
  const bTime = b.createdAt ? Date.parse(b.createdAt) : 0
  return bTime - aTime
}

function severityRank(severity: DiagnosticsSeverity): number {
  if (severity === 'error') return 3
  if (severity === 'warning') return 2
  return 1
}

function isSeverity(value: unknown): value is DiagnosticsSeverity {
  return value === 'error' || value === 'warning' || value === 'info'
}

function stringifyDetails(details: unknown): string | undefined {
  if (typeof details === 'string') return details
  if (details == null) return undefined
  try {
    return JSON.stringify(details)
  } catch {
    return String(details)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export default useDiagnosticsStore
