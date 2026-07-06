/**
 * workspace-startup.ts - Workspace 首屏数据加载编排。
 */

type LoadThreadsOptions = {
  deferActiveSnapshot?: boolean
  selectLatestActiveProjectThread?: boolean
}

interface WorkspaceStartupLoaders {
  loadProjects: () => Promise<void>
  loadThreads: (contextId?: string, options?: LoadThreadsOptions) => Promise<void>
}

/**
 * 并行加载 Workspace 首屏需要的 project/thread metadata。
 * 这两个 IPC 互不依赖；activeProjectId 的持久化值在 store 创建时已恢复。
 */
export async function loadWorkspaceStartupData(loaders: WorkspaceStartupLoaders): Promise<void> {
  await Promise.all([
    loaders.loadProjects(),
    loaders.loadThreads(undefined, { deferActiveSnapshot: true })
  ])
}
