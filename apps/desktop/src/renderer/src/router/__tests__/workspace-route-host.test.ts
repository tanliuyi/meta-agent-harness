import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isWorkspaceRouteName,
  WORKSPACE_ROUTE_NAME,
  WORKSPACE_SESSION_ROUTE_NAME
} from '../workspace-route-host'

describe('workspace route host', () => {
  it('recognizes the workspace container and session child routes', () => {
    expect(isWorkspaceRouteName(WORKSPACE_ROUTE_NAME)).toBe(true)
    expect(isWorkspaceRouteName(WORKSPACE_SESSION_ROUTE_NAME)).toBe(true)
    expect(isWorkspaceRouteName('SettingsGeneral')).toBe(false)
  })

  it('uses a standard nested route and unmounts workspace outside its route', () => {
    const appSource = readFileSync(join(__dirname, '..', '..', 'App.vue'), 'utf8')
    const indexSource = readFileSync(join(__dirname, '..', '..', '..', 'index.html'), 'utf8')
    const routerSource = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')
    const routeHostSource = readFileSync(join(__dirname, '..', 'workspace-route-host.ts'), 'utf8')
    const workspaceSource = readFileSync(
      join(__dirname, '..', '..', 'views', 'workspace', 'View.vue'),
      'utf8'
    )
    const sidebarSource = readFileSync(
      join(__dirname, '..', '..', 'views', 'workspace', 'components', 'sidebar', 'Sidebar.vue'),
      'utf8'
    )

    expect(appSource).toContain('<RouterView />')
    expect(appSource).not.toContain('v-show=')
    expect(indexSource.match(/crossorigin="anonymous"/g)).toHaveLength(2)
    expect(routerSource).toContain("path: ':sessionId'")
    expect(routerSource).toContain(
      "component: () => import('@/views/workspace/components/content/WorkspaceSession.vue')"
    )
    expect(routeHostSource).toContain(
      "WorkspaceRouteView = () => import('../views/workspace/View.vue')"
    )
    expect(routeHostSource).not.toContain('defineAsyncComponent')
    expect(workspaceSource).toContain('class="workspace app-shell__workspace-host"')
    expect(workspaceSource).toContain('<Sidebar :visible="workspaceUi.sidebarOpen" />')
    expect(sidebarSource).toContain('<aside v-show="visible" class="workspace__sidebar">')
    expect(workspaceSource).toContain('<RouterView v-slot="{ Component, route }">')
    expect(workspaceSource).not.toContain('<KeepAlive>')
    expect(workspaceSource).not.toContain('import WorkspaceContent')
  })

  it('route-gates global shortcuts outside workspace routes', () => {
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

  it('keeps workspace-owned teleports inside the workspace host', () => {
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
