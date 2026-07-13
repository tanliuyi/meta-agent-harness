import { describe, expect, it, vi } from 'vitest'
import type { AgentSettingsSnapshot } from '@shared/coding-agent/types'
import { saveSafetyWithCapabilityConfirmation } from '../safetyCapabilityConfirmation'

type AgentSafetySettings = AgentSettingsSnapshot['safety']

describe('Safety capability confirmation', () => {
  it('取消时恢复本次提权字段并保留其他草稿', async () => {
    const current = createSafetySettings()
    const next = createSafetySettings()
    next.browserCdpAccess = 'full'
    next.filesystemAccess = 'full'
    next.enableAnalytics = true
    const confirmEscalations = vi.fn(async () => false)
    const save = vi.fn(async () => undefined)

    await expect(
      saveSafetyWithCapabilityConfirmation({ current, next, confirmEscalations, save })
    ).resolves.toBe('cancelled')

    expect(confirmEscalations).toHaveBeenCalledWith(['完整 Browser CDP', '完整文件系统访问'])
    expect(next.browserCdpAccess).toBe('safe')
    expect(next.filesystemAccess).toBe('safe')
    expect(next.enableAnalytics).toBe(true)
    expect(save).not.toHaveBeenCalled()
  })

  it('确认提权后保存完整能力', async () => {
    const current = createSafetySettings()
    const next = createSafetySettings()
    next.externalProtocolAccess = 'full'
    const save = vi.fn(async () => undefined)

    await expect(
      saveSafetyWithCapabilityConfirmation({
        current,
        next,
        confirmEscalations: vi.fn(async () => true),
        save
      })
    ).resolves.toBe('saved')

    expect(next.externalProtocolAccess).toBe('full')
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('没有新增提权时直接保存且不请求确认', async () => {
    const current = createSafetySettings()
    current.browserCdpAccess = 'full'
    const next = { ...current, enableAnalytics: true }
    const confirmEscalations = vi.fn(async () => true)
    const save = vi.fn(async () => undefined)

    await saveSafetyWithCapabilityConfirmation({ current, next, confirmEscalations, save })

    expect(confirmEscalations).not.toHaveBeenCalled()
    expect(save).toHaveBeenCalledTimes(1)
  })
})

function createSafetySettings(): AgentSafetySettings {
  return {
    defaultProjectTrust: 'ask',
    enableInstallTelemetry: false,
    enableAnalytics: false,
    enableSkillCommands: true,
    warnAnthropicExtraUsage: true,
    browserCdpAccess: 'safe',
    browserWebPermissions: 'prompt',
    filesystemAccess: 'safe',
    extensionUrlAccess: 'safe',
    externalProtocolAccess: 'safe'
  }
}
