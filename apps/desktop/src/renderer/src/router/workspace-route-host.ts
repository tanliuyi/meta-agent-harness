import type { RouteRecordName } from 'vue-router'

export const WORKSPACE_ROUTE_NAME = 'Workspace'
export const WORKSPACE_SESSION_ROUTE_NAME = 'WorkspaceSession'
export const WORKSPACE_PORTAL_TARGET = '.app-shell__workspace-host'

export const WorkspaceRouteView = () => import('../views/workspace/View.vue')

export function isWorkspaceRouteName(routeName: RouteRecordName | null | undefined): boolean {
  return routeName === WORKSPACE_ROUTE_NAME || routeName === WORKSPACE_SESSION_ROUTE_NAME
}
