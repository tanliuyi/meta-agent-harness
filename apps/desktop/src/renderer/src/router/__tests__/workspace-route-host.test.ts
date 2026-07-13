import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveWorkspaceRouteHostState } from '../workspace-route-host'

describe('workspace route host', () => {
  it('mounts lazily, remains mounted, and never renders a second workspace branch', () => {
    let state = resolveWorkspaceRouteHostState(false, 'SettingsGeneral')
    expect(state).toEqual({
      routerViewVisible: true,
      workspaceMounted: false,
      workspaceVisible: false
    })

    state = resolveWorkspaceRouteHostState(state.workspaceMounted, 'Workspace')
    expect(state).toEqual({
      routerViewVisible: false,
      workspaceMounted: true,
      workspaceVisible: true
    })

    state = resolveWorkspaceRouteHostState(state.workspaceMounted, 'SettingsAgent')
    expect(state).toEqual({
      routerViewVisible: true,
      workspaceMounted: true,
      workspaceVisible: false
    })

    state = resolveWorkspaceRouteHostState(state.workspaceMounted, 'Workspace')
    expect(state).toEqual({
      routerViewVisible: false,
      workspaceMounted: true,
      workspaceVisible: true
    })
  })

  it('wires the persistent host to the same async component as the router record', () => {
    const appSource = readFileSync(join(__dirname, '..', '..', 'App.vue'), 'utf8')
    const routerSource = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')

    expect(appSource).toContain('v-if="workspaceRouteState.workspaceMounted"')
    expect(appSource).toContain('v-show="workspaceRouteState.workspaceVisible"')
    expect(appSource).toContain('v-if="workspaceRouteState.routerViewVisible"')
    expect(routerSource).toContain('component: WorkspaceRouteView')
  })

  it('route-gates global shortcuts while the mounted workspace is hidden', () => {
    const chatViewSource = readFileSync(
      join(__dirname, '..', '..', 'components', 'chat', 'ChatView.vue'),
      'utf8'
    )
    const browserPageSource = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'components',
        'session',
        'panel',
        'tabs',
        'BrowserPreviewPage.vue'
      ),
      'utf8'
    )

    expect(chatViewSource).toContain('!isWorkspaceRouteName(route.name)')
    expect(browserPageSource).toContain('!isWorkspaceRouteName(route.name)')
  })

  it('route-gates extension panel visibility while the workspace host remains mounted', () => {
    const extensionPanelSource = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'components',
        'session',
        'panel',
        'tabs',
        'ExtensionWebviewPanelTab.vue'
      ),
      'utf8'
    )

    expect(extensionPanelSource).toContain(
      'componentActive.value && isWorkspaceRouteName(route.name)'
    )
    expect(extensionPanelSource).toContain('() => route.name')
    expect(extensionPanelSource).toContain('setPanelVisible(panelVisible.value)')
  })

  it('keeps workspace-owned teleports inside the persistent host', () => {
    const workspaceTeleportSources = [
      join(__dirname, '..', '..', 'components', 'chat', 'composer', 'Composer.vue'),
      join(__dirname, '..', '..', 'components', 'chat', 'ImagePreviewDialog.vue'),
      join(__dirname, '..', '..', 'components', 'chat', 'messages', 'AssistantMessage.vue')
    ].map((path) => readFileSync(path, 'utf8'))

    for (const source of workspaceTeleportSources) {
      expect(source).toContain(':to="WORKSPACE_PORTAL_TARGET"')
      expect(source).not.toContain('to="body"')
    }
  })
})
