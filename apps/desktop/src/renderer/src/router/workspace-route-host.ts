import { defineAsyncComponent } from 'vue'
import type { RouteRecordName } from 'vue-router'

export const WORKSPACE_ROUTE_NAME = 'Workspace'
export const WORKSPACE_PORTAL_TARGET = '.app-shell__workspace-host'

export const WorkspaceRouteView = defineAsyncComponent(() => import('../views/workspace/View.vue'))

export interface WorkspaceRouteHostState {
  routerViewVisible: boolean
  workspaceMounted: boolean
  workspaceVisible: boolean
}

export function isWorkspaceRouteName(routeName: RouteRecordName | null | undefined): boolean {
  return routeName === WORKSPACE_ROUTE_NAME
}

export function resolveWorkspaceRouteHostState(
  workspaceMounted: boolean,
  routeName: RouteRecordName | null | undefined
): WorkspaceRouteHostState {
  const workspaceVisible = isWorkspaceRouteName(routeName)
  return {
    routerViewVisible: !workspaceVisible,
    workspaceMounted: workspaceMounted || workspaceVisible,
    workspaceVisible
  }
}
