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

  it('disables the session panel before project selection and guards async actions', () => {
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
    const resizablePaneSeparator = source(
      '..',
      'ui',
      'resizable-pane-separator',
      'ResizablePaneSeparator.vue'
    )
    const overview = source('panel', 'tabs', 'SessionOverviewTab.vue')
    const sessionPanel = source('SessionPanel.vue')
    const panelTabs = source('panel', 'SessionPanelTabs.vue')
    const browser = source('panel', 'tabs', 'BrowserPreviewPanelTab.vue')
    const extensionWebview = source('panel', 'tabs', 'ExtensionWebviewPanelTab.vue')
    const browserPage = source('panel', 'tabs', 'BrowserPreviewPage.vue')
    const browserPermissionHost = source('..', 'browser', 'BrowserPermissionRequestHost.vue')
    const app = source('..', '..', 'App.vue')
    const safetySettings = source('..', '..', 'views', 'settings', 'agent', 'SafetyView.vue')
    const memory = source('..', '..', 'views', 'settings', 'memory', 'MemorySettingsView.vue')
    const approvals = source('panel', 'tabs', 'ApprovalsTab.vue')
    const commands = source('panel', 'tabs', 'CommandsTab.vue')
    expect(header).toContain('@click="openPanelTab(\'session\')"')
    expect(header).not.toContain('v-if="session.sessionId" class="session-header__actions"')
    expect(header).toContain(
      ':disabled="!session.sessionId && !workspaceSession.isNewSessionActive"'
    )
    expect(workspaceContent).toContain(
      'Boolean(activeSession.value) || workspaceSession.isNewSessionActive'
    )
    expect(workspaceContent).toContain('v-if="shouldRenderSessionPanel"')
    expect(workspaceContent).toContain(':collapsed="!isSessionPanelOpen"')
    expect(workspaceContent).toContain(':disabled="!hasSessionPanelContext"')
    expect(workspaceContent).not.toContain('toggleSessionPanelFullscreen')
    expect(workspaceContent).not.toContain('isSessionPanelFullscreen')
    expect(workspaceContent).not.toContain('floatingChat')
    expect(sessionPanel).toContain(':disabled="disabled"')
    expect(sessionPanel).not.toContain('fullscreen')
    expect(sessionPanel).not.toContain('Maximize2')
    expect(sessionPanel).not.toContain('Minimize2')
    expect(workspaceView).toContain('workspaceSession.isNewSessionActive')
    expect(workspaceView).toContain("'workspace--resizing-sidebar': isSidebarResizing")
    expect(workspaceView).toContain('@resize-state-change="isSidebarResizing = $event"')
    expect(workspaceView).toContain('<ResizeDragShield v-if="isSidebarResizing"')
    expect(workspaceContent).toContain('<ResizeDragShield v-if="isSessionPanelResizing"')
    expect(resizablePaneSeparator).toContain("emit('resizeStateChange', resizing)")
    expect(overview).toContain(
      'workspaceSession.activeSession?.projectId ?? workspaceSession.activeProjectId'
    )
    expect(sessionPanel).toContain("'has-attention': collapsed && hasAttention")
    expect(panelTabs).toContain('workspaceSession.activeSessionPanelTabsKey')
    expect(panelTabs).not.toContain('openTabs.value.some((tab) => tab.id === tabId)')
    expect(panelTabs).toContain("panel.source.component === 'browser-preview'")
    expect(panelTabs).toContain('@attention="handleBrowserAttention"')
    expect(panelTabs).toContain(':has-attention="attentionTabIds.length > 0"')
    expect(panelTabs).toContain('Object.entries(workspaceSession.runtimeByThreadId)')
    expect(panelTabs).toContain('browserSessionInstances')
    expect(panelTabs).toContain('getBrowserSessionScope(')
    expect(panelTabs).toContain('const MAX_SESSION_PANEL_CACHE_ENTRIES = 12')
    expect(panelTabs).toContain('const cachedOpenTabs = shallowReactive<CachedOpenTab[]>([])')
    expect(panelTabs).toContain('reconcileSessionPanelCache(cachedOpenTabs')
    expect(panelTabs).toContain(
      'liveThreadIds: new Set([...sessionThreadIds, ...runtimeThreadIds])'
    )
    expect(panelTabs).toContain('v-for="tab in cachedOpenTabs"')
    expect(panelTabs).toContain(':key="tab.cacheKey"')
    expect(panelTabs).toContain(':max="1"')
    expect(panelTabs).toContain('tab.sessionKey === workspaceSession.activeSessionPanelTabsKey')
    expect(panelTabs).not.toContain('keepAliveEpoch')
    expect(panelTabs).toContain('v-for="instance in browserSessionInstances"')
    expect(panelTabs).toContain(
      ':thread-id="activeExtensionPanelId ? workspaceSession.activeSessionId'
    )
    expect(panelTabs).toContain('@close="handleCloseBrowserPanel"')
    expect(panelTabs).toContain('if (browserTab) closeTab(browserTab.instanceId)')
    expect(browser).toContain('store.runtimeByThreadId[props.threadId]')
    expect(browser).toContain('sendResult(threadId, message.requestId')
    expect(browser).toContain("{ flush: 'sync', immediate: true }")
    expect(browser).toContain('v-for="tab in tabsState.tabs"')
    expect(browser).toContain('v-for="tab in pageTabs"')
    expect(browser).toContain('createBrowserGuideTab(createBrowserId())')
    expect(browser).toContain('class="browser-preview-guide__toolbar"')
    expect(browser).toContain("if (tabsState.tabs.length === 0) emit('close', props.sessionScope)")
    expect(browser).toContain('await nextTick()')
    expect(browser).toContain('requireBrowserTab(')
    expect(browser).toContain('browserId: tab.id')
    expect(browser).toContain('enqueueSerialBrowserCommand(commandExecutionQueue')
    expect(browser).toContain('createBrowserCommandLifecycle(')
    expect(browser).toContain('await lifecycle.settled')
    expect(browser).toContain('assertBrowserCommandResultBudget(message.command, result)')
    expect(browser).toContain('consumeExtensionPanelMessages(')
    expect(browser).toContain('decideBrowserReveal({')
    expect(browser).toContain('openPanelTab(tabId)')
    expect(browser).toContain('onOpenRequested')
    expect(extensionWebview).toContain('const panelThreadId = props.threadId')
    expect(extensionWebview).toContain('panelThreadId === workspaceSession.activeSessionId')
    expect(extensionWebview).toContain('hostActive: panelVisible.value')
    expect(extensionWebview).toContain('data:text/html;charset=utf-8')
    expect(extensionWebview).toContain(':src="urlHostSource"')
    expect(extensionWebview).toContain(
      "agentSettings.snapshot?.safety.extensionUrlAccess === 'full'"
    )
    expect(extensionWebview).toContain('unrestrictedUrlAccess: unrestrictedUrlAccess.value')
    expect(browserPage).toContain('defineExpose({')
    expect(browserPage).toContain('executeCommand,')
    expect(browserPage).toContain('globalThis.__metaBrowserRefIds ||= new WeakMap()')
    expect(browserPage).toContain('globalThis.__metaBrowserRefSequence')
    expect(browserPage).toContain('while (refs.size > 1000)')
    expect(browserPage).toContain('document.createTreeWalker(')
    expect(browserPage).toContain('NodeFilter.SHOW_TEXT')
    expect(browserPage).toContain('rawText.slice(0, 16384)')
    expect(browserPage).not.toContain('document.body?.innerText')
    expect(browserPage).not.toContain("document.querySelectorAll('a,button,input")
    expect(browserPage).not.toContain('refs.clear();')
    expect(browserPermissionHost).toContain('onPermissionRequested')
    expect(browserPermissionHost).toContain("confirmText: '允许'")
    expect(browserPermissionHost).toContain('<template>')
    expect(app).toMatch(/<ConfirmDialogProvider>[\s\S]*<BrowserPermissionRequestHost\s*\/>/)
    expect(safetySettings).toContain('saveSafetyWithConfirmation')
    expect(safetySettings).toContain('了解风险并开启')
    expect(safetySettings).not.toContain('showMessageBox')
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
