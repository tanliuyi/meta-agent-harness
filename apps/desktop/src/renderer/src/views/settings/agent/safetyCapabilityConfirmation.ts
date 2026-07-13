import type { AgentSettingsSnapshot } from '@shared/coding-agent/types'

export type AgentSafetySettings = AgentSettingsSnapshot['safety']

export const dangerousCapabilityLabels = {
  browserCdpAccess: '完整 Browser CDP',
  browserWebPermissions: '始终允许 Browser 网页权限',
  filesystemAccess: '完整文件系统访问',
  extensionUrlAccess: '扩展 URL Panel 跨源访问',
  externalProtocolAccess: '自定义外部协议'
} as const

export type DangerousCapabilityKey = keyof typeof dangerousCapabilityLabels

interface SaveSafetyWithCapabilityConfirmationOptions {
  current: AgentSafetySettings
  next: AgentSafetySettings
  confirmEscalations: (labels: string[]) => Promise<boolean>
  save: () => Promise<void>
}

export async function saveSafetyWithCapabilityConfirmation(
  options: SaveSafetyWithCapabilityConfirmationOptions
): Promise<'cancelled' | 'saved'> {
  const escalationKeys = (
    Object.keys(dangerousCapabilityLabels) as DangerousCapabilityKey[]
  ).filter((key) => options.next[key] === 'full' && options.current[key] !== 'full')

  if (escalationKeys.length > 0) {
    const confirmed = await options.confirmEscalations(
      escalationKeys.map((key) => dangerousCapabilityLabels[key])
    )
    if (!confirmed) {
      restoreDeclinedEscalations(options.current, options.next, escalationKeys)
      return 'cancelled'
    }
  }

  await options.save()
  return 'saved'
}

function restoreDeclinedEscalations(
  current: AgentSafetySettings,
  next: AgentSafetySettings,
  keys: DangerousCapabilityKey[]
): void {
  for (const key of keys) {
    switch (key) {
      case 'browserCdpAccess':
        next.browserCdpAccess = current.browserCdpAccess
        break
      case 'browserWebPermissions':
        next.browserWebPermissions = current.browserWebPermissions
        break
      case 'filesystemAccess':
        next.filesystemAccess = current.filesystemAccess
        break
      case 'extensionUrlAccess':
        next.extensionUrlAccess = current.extensionUrlAccess
        break
      case 'externalProtocolAccess':
        next.externalProtocolAccess = current.externalProtocolAccess
        break
    }
  }
}
