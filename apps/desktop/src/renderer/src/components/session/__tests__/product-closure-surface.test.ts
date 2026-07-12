import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(...segments: string[]): string {
  return readFileSync(join(__dirname, '..', ...segments), 'utf8')
}

describe('renderer product closure surface', () => {
  it('keeps workspace and narrow settings navigation reachable', () => {
    const header = source('SessionHeader.vue')
    const settings = source('..', '..', 'views', 'settings', 'View.vue')
    expect(header).toContain('app.isMac && !workspaceUi.sidebarOpen')
    expect(header).toContain('@click="workspaceUi.sidebarOpen = true"')
    expect(settings).toContain('settings-content__navigation-toggle')
    expect(settings).toContain('settings-navigation-drawer')
    expect(settings).toContain('@click="mobileNavigationOpen = true"')
  })

  it('opens session metadata and guards approval and command async actions', () => {
    const header = source('SessionHeader.vue')
    const approvals = source('panel', 'tabs', 'ApprovalsTab.vue')
    const commands = source('panel', 'tabs', 'CommandsTab.vue')
    expect(header).toContain('@click="openPanelTab(\'session\')"')
    expect(approvals).toContain('submittingApprovalId')
    expect(approvals).toContain('approvalError')
    expect(commands).toContain('runningCommandKey')
    expect(commands).toContain('workspaceSession.activeCommandsLoading')
    expect(commands).toContain('await workspaceSession.runCommand')
  })
})
