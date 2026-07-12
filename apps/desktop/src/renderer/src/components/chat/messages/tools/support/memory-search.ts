import { getToolStatusLabel, type ToolStatus } from './tool-message'

export type MemorySearchTarget = 'memory' | 'user' | 'failure'

export interface MemorySearchPresentation {
  status: ToolStatus | undefined
  name: string
  target: MemorySearchTarget | undefined
  targetLabel: string | undefined
}

const targetLabels: Record<Exclude<MemorySearchTarget, 'memory'>, string> = {
  user: '用户偏好',
  failure: '经验记录'
}

const statusLabels = {
  queued: '正在搜索记忆',
  running: '正在搜索记忆',
  succeeded: '已搜索记忆',
  failed: '搜索记忆失败',
  cancelled: '取消搜索记忆'
}

function resolveMemorySearchStatus(
  status: ToolStatus | undefined,
  isError: boolean
): ToolStatus | undefined {
  return isError ? 'failed' : status
}

function getMemorySearchStatusLabel(status: ToolStatus | undefined): string {
  return getToolStatusLabel(status, statusLabels)
}

function getMemorySearchTargetLabel(
  target: MemorySearchTarget | undefined,
  project: unknown
): string | undefined {
  if (!target) return undefined
  if (target !== 'memory') return targetLabels[target]
  if (typeof project === 'string' && project.trim()) return '项目记忆'
  if (project === null) return '全局记忆'
  return '记忆'
}

function asMemorySearchTarget(value: string | undefined): MemorySearchTarget | undefined {
  return value === 'memory' || value === 'user' || value === 'failure' ? value : undefined
}

export function getMemorySearchPresentation(input: {
  status: ToolStatus | undefined
  isError: boolean
  target: string | undefined
  project: unknown
}): MemorySearchPresentation {
  const status = resolveMemorySearchStatus(input.status, input.isError)
  const target = asMemorySearchTarget(input.target)
  return {
    status,
    name: getMemorySearchStatusLabel(status),
    target,
    targetLabel: getMemorySearchTargetLabel(target, input.project)
  }
}
