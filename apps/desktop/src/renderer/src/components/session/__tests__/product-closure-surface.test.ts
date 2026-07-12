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

  it('opens the session panel for existing and new sessions and guards async actions', () => {
    const header = source('SessionHeader.vue')
    const workspaceContent = source(
      '..',
      '..',
      'views',
      'workspace',
      'components',
      'content',
      'WorkspaceContent.vue'
    )
    const workspaceView = source('..', '..', 'views', 'workspace', 'View.vue')
    const overview = source('panel', 'tabs', 'SessionOverviewTab.vue')
    const panelTabs = source('panel', 'SessionPanelTabs.vue')
    const browser = source('panel', 'tabs', 'BrowserPreviewPanelTab.vue')
    const browserPage = source('panel', 'tabs', 'BrowserPreviewPage.vue')
    const memory = source('..', '..', 'views', 'settings', 'memory', 'MemorySettingsView.vue')
    const approvals = source('panel', 'tabs', 'ApprovalsTab.vue')
    const commands = source('panel', 'tabs', 'CommandsTab.vue')
    expect(header).toContain('@click="openPanelTab(\'session\')"')
    expect(header).not.toContain('v-if="session.sessionId" class="session-header__actions"')
    expect(workspaceContent).toContain(
      'Boolean(activeSession.value) || workspaceSession.isNewSessionActive'
    )
    expect(workspaceContent).toContain('v-if="hasSessionPanelContext && shouldRenderSessionPanel"')
    expect(workspaceView).toContain('workspaceSession.isNewSessionActive')
    expect(overview).toContain(
      'workspaceSession.activeSession?.projectId ?? workspaceSession.activeProjectId'
    )
    expect(panelTabs).toContain('workspaceSession.activeSessionPanelTabsKey')
    expect(panelTabs).not.toContain('openTabs.value.some((tab) => tab.id === tabId)')
    expect(panelTabs).toContain("panel.source.component === 'browser-preview'")
    expect(browser).toContain('Object.entries(store.runtimeByThreadId)')
    expect(browser).toContain('sendResult(threadId, message.requestId')
    expect(browser).toContain("{ flush: 'sync', immediate: true }")
    expect(browser).toContain('v-for="tab in tabsState.tabs"')
    expect(browser).toContain('requireBrowserTab(')
    expect(browser).toContain('browserId: tab.id')
    expect(browser).toContain('`page:${targetBrowserId}`')
    expect(browser).toContain('withBrowserCommandTimeout(')
    expect(browser).toContain('consumeExtensionPanelMessages(')
    expect(browser).toContain('onOpenRequested')
    expect(browserPage).toContain('defineExpose({')
    expect(browserPage).toContain('executeCommand,')
    expect(browserPage).toContain(
      "label=\"showDeviceToolbar ? 'Hide device toolbar' : 'Show device toolbar'\""
    )
    expect(browserPage).toContain(
      'v-if="showDeviceToolbar" class="browser-preview__device-controls"'
    )
    expect(memory).toContain('projectGeneration += 1')
    expect(memory).toContain('requestedProjectGeneration === projectGeneration')
    expect(approvals).toContain('submittingApprovalId')
    expect(approvals).toContain('approvalError')
    expect(commands).toContain('runningCommandKey')
    expect(commands).toContain('workspaceSession.activeCommandsLoading')
    expect(commands).toContain('await workspaceSession.runCommand')
  })
})
