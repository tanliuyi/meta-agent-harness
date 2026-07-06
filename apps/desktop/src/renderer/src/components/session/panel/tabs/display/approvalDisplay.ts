import type { ApprovalRequest, ApprovalResponse } from '@shared/coding-agent/types'

export type ApprovalScope = ApprovalResponse['scope']

export function getApprovalRiskLabel(risk: ApprovalRequest['risk']): string {
  switch (risk) {
    case 'high':
      return '高风险'
    case 'medium':
      return '中风险'
    case 'low':
      return '低风险'
  }
}

export function getApprovalScopeLabel(scope: ApprovalScope): string {
  switch (scope) {
    case 'workspace':
      return '工作区'
    case 'thread':
      return '线程'
    case 'once':
      return '一次'
  }
}
