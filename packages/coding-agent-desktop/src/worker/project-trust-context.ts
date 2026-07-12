/**
 * 实现 desktop transport 驱动的 Pi project trust 上下文。
 */

import type { ProjectTrustContext } from '@earendil-works/pi-coding-agent'
import type { ApprovalBridge } from './approval-bridge.ts'

/**
 * 创建 desktop project trust 上下文。
 * @param options - 创建选项。
 * @returns ProjectTrustContext 实例。
 */
export function createDesktopProjectTrustContext(options: {
  cwd: string
  approvalBridge: ApprovalBridge
  hasUI: boolean
}): ProjectTrustContext {
  return {
    cwd: options.cwd,
    mode: 'rpc',
    hasUI: options.hasUI,
    ui: {
      select: async (title, choices) => {
        if (!options.hasUI) {
          return undefined
        }
        const response = await options.approvalBridge.request({
          approvalId: crypto.randomUUID(),
          action: 'project_trust',
          risk: 'high',
          scope: 'workspace',
          subject: title,
          choices,
          defaultAction: 'deny'
        })
        if (!response.allow) {
          return undefined
        }
        if (response.choice !== undefined && choices.includes(response.choice)) {
          return response.choice
        }
        return choices[0]
      },
      confirm: async (title, message) => {
        if (!options.hasUI) {
          return false
        }
        const response = await options.approvalBridge.request({
          approvalId: crypto.randomUUID(),
          action: 'project_trust_confirm',
          risk: 'high',
          scope: 'workspace',
          subject: `${title}\n${message}`,
          defaultAction: 'deny'
        })
        return response.allow
      },
      input: async () => undefined,
      notify: () => {}
    }
  }
}
