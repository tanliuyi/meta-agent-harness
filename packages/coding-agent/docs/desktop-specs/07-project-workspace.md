# 07. Project / Workspace Spec

## 目标

在 Meta Agent Desktop 中引入 Project / Workspace 作为 desktop 产品入口和归属边界，把当前 `createThread({ cwd })` 改为 `createThread({ projectId })`。

本 spec 不改变 `packages/coding-agent` 的 Pi-compatible runtime 语义。`Project.path` 在 Electron main 中解析为 runtime `cwd`，继续传给 worker protocol。renderer 不再构造或传递 `cwd`。

## 范围

第一阶段交付：

- Project registry。
- Project preload API 与 IPC handlers。
- Thread 强制归属 Project。
- desktop metadata 增加 Project 与 Thread 归属信息。
- Renderer Project store。
- Sidebar 从 `cwd input` 改为 Project-first UI。
- 不保留 desktop 旧 `createThread({ cwd })` API。

第一阶段不交付：

- 多根 Workspace。
- Project 文件树。
- Git 面板。
- Diff viewer。
- Terminal panel。
- 产品化 settings 页面。
- Pi session/event/config/resource/extension/tool 语义改造。

## 产品模型

```text
Project
  本地代码项目，拥有 path、名称、状态、最近打开时间和项目级设置

Workspace
  当前打开 Project 的 UI 工作区，第一阶段不单独持久化

Thread
  Project 下的 coding thread，沿用 packages/coding-agent 的核心产品对象

Session
  Pi-compatible JSONL session，是 agent context 和 branching 的 canonical persistence

Worker
  执行 thread 的 runtime 实例，由 Electron main 的 thread worker registry 管理
```

映射关系：

```text
Project.path      -> StartThreadInput.cwd
Thread.threadId   -> StartThreadInput.threadId
Thread.title      -> StartThreadInput.title
Thread.sessionFile -> StartThreadInput.sessionFile
```

## Shared Types

新增：

```ts
export type ProjectStatus = 'available' | 'missing' | 'permissionDenied' | 'invalid'

export interface ProjectSummary {
  projectId: string
  name: string
  path: string
  status: ProjectStatus
  createdAt: string
  updatedAt: string
  lastOpenedAt?: string
}

export interface CreateProjectInput {
  path: string
  name?: string
}

export interface RenameProjectInput {
  projectId: string
  name: string
}

export interface ProjectIdInput {
  projectId: string
}
```

修改：

```ts
export interface CreateThreadInput {
  threadId?: string
  projectId: string
  sessionFile?: string
  title?: string
  agentDir?: string
}

export interface ThreadSummary {
  threadId: string
  projectId: string
  sessionFile?: string
  title?: string
  status: ThreadStatus
  archivedAt?: string
  createdAt: string
  updatedAt: string
}

export interface ThreadSnapshot {
  threadId: string
  projectId: string
  cwd: string
  sessionFile?: string
  title?: string
  status: ThreadStatus
  thinkingLevel: ThinkingLevel
  messages: ThreadMessage[]
  toolCalls: unknown[]
  fileChanges: unknown[]
  approvals: unknown[]
  queue: {
    steering: string[]
    followUp: string[]
  }
  diagnostics: unknown[]
}
```

说明：

- `CreateThreadInput.cwd` 必须删除。
- `ThreadSummary.cwd` 必须删除。
- `ThreadSnapshot.cwd` 暂时保留，因为它是 runtime snapshot 字段，便于诊断和 worker 恢复；renderer UI 不应把它作为主入口展示。
- `ThreadSummary.projectId` 和 `ThreadSnapshot.projectId` 必须存在。

## Preload API

新增：

```ts
type CodingAgentApi = {
  listProjects(): Promise<ProjectSummary[]>
  createProject(): Promise<ProjectSummary | undefined>
  openProject(projectId: string): Promise<ProjectSummary>
  getProject(projectId: string): Promise<ProjectSummary>
  renameProject(input: RenameProjectInput): Promise<void>

  createThread(input: CreateThreadInput): Promise<ThreadSnapshot>
  listThreads(input?: { projectId?: string }): Promise<ThreadSummary[]>
}
```

删除或禁止：

```ts
createThread(input: { cwd: string }): Promise<ThreadSnapshot>
```

IPC channels 建议：

```ts
projectCreate: 'coding-agent:create-project'
projectOpen: 'coding-agent:open-project'
projectGet: 'coding-agent:get-project'
projectList: 'coding-agent:list-projects'
projectRename: 'coding-agent:rename-project'
```

## Main 进程

新增 `ProjectStore`：

```ts
class ProjectStore {
  saveProject(project: ProjectSummary): void
  getProject(projectId: string): ProjectSummary | undefined
  findProjectByPath(path: string): ProjectSummary | undefined
  listProjects(): ProjectSummary[]
  updateProject(projectId: string, patch: Partial<ProjectSummary>): void
}
```

路径规则：

- 保存前必须 normalize/resolve path。
- path 必须是目录。
- path 不存在时 project 状态为 `missing`。
- path 存在但不可访问时状态为 `permissionDenied`。
- path 是文件或非法路径时状态为 `invalid`。

`createThread` 流程：

1. 校验 `projectId`。
2. 从 `ProjectStore` 读取 project。
3. 校验 project 未归档。
4. 刷新 project path status。
5. 非 `available` 时拒绝创建 thread。
6. 生成或使用 `threadId`。
7. 写入 thread registry，包含 `projectId`。
8. 调用 thread worker registry：

```ts
await acquireThreadWorker({
  threadId,
  cwd: project.path,
  sessionFile,
  title,
  agentDir
})
```

`restartThread` / `ensureWorker` 流程：

1. 从 thread registry 读取 `projectId`。
2. 从 ProjectStore 读取 project。
3. 使用 `project.path` 作为 worker cwd。
4. 不再从 thread summary 读取 cwd。

## Metadata Registry

Desktop 不引入 SQLite。Project / Thread registry 使用轻量 metadata 文件，或从
sessions 目录派生后写入宿主 metadata。metadata 只保存产品归属和展示信息，不保存
conversation messages。

建议 metadata 形态：

```ts
type DesktopMetadata = {
  version: 1
  projects: ProjectSummary[]
  threads: ThreadSummary[]
}
```

开发期迁移策略：

- 不保留旧 `cwd -> thread` desktop API。
- 如果检测到旧 metadata 缺少 project 归属，可以丢弃 metadata 并从 JSONL session 目录重建最小 thread 列表。
- JSONL session 文件不应因 registry 重建而删除。
- 如需辅助开发，可提供一次性脚本从旧 thread `cwd` 生成 project/thread，但该脚本不是运行时兼容层。

## Renderer Store

新增 `workspace-project`：

```ts
state:
  projects: Record<string, ProjectSummary>
  loading: boolean
  errorMessage?: string

actions:
  loadProjects()
  createProject()
  openProject(projectId)
  renameProject(projectId, name)
```

调整 `workspace-session`：

- 删除 `cwdInput`。
- 增加对 active project 的依赖。
- `loadThreads` 调用 `listThreads({ projectId })`。
- `createThread` 必须从 active project 创建。
- 无 active project 时禁止创建 thread，并给出 UI 状态。

## UI 规格

Sidebar 第一阶段结构：

```text
Project section
  Open/Add Project button
  Recent projects list

Thread section
  New Thread button
  Threads for active project
```

行为：

- 用户点击添加 Project 后，由 main 进程打开系统目录选择器选择本地项目目录。
- 用户先添加或打开 project。
- active project 下才能创建 thread。
- thread list 只显示 active project 的 threads。
- thread item 显示 title/status/updated time，不以 cwd 作为主标题。
- Project missing/permissionDenied/invalid 时禁用 New Thread。

空状态：

- 无 project：提示打开本地项目。
- active project 无 thread：提示创建 thread。
- project missing：提示路径不存在。
- permission denied：提示检查权限。

## 事件与 Snapshot

Project lifecycle event 建议：

```ts
type ProjectProjectionEvent =
  | { type: 'project.created'; project: ProjectSummary }
  | { type: 'project.opened'; project: ProjectSummary }
  | { type: 'project.updated'; project: ProjectSummary }
```

Thread projection event 必须包含 `threadId`，需要时包含 `projectId`：

```ts
type ThreadProjectionEvent = {
  threadId: string
  projectId: string
  type: string
}
```

Thread snapshot 必须包含 `projectId`，允许包含 runtime `cwd`。

## 文件变更清单

共享类型：

- `apps/desktop/src/shared/coding-agent/types.ts`
- `apps/desktop/src/shared/coding-agent/channels.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/preload/index.d.ts`

Main：

- `apps/desktop/src/main/coding-agent/project-store.ts`
- `apps/desktop/src/main/coding-agent/ipc.ts`
- `apps/desktop/src/main/coding-agent/thread-lifecycle.ts`
- `apps/desktop/src/main/coding-agent/thread-manager-core.ts`
- `apps/desktop/src/main/coding-agent/thread-store.ts`
- `apps/desktop/src/main/coding-agent/thread-session-commands.ts`

Renderer：

- `apps/desktop/src/renderer/src/stores/workspace-project.ts`
- `apps/desktop/src/renderer/src/stores/workspace-session.ts`
- `apps/desktop/src/renderer/src/views/workspace/components/sidebar/Sidebar.vue`
- `apps/desktop/src/renderer/src/views/workspace/components/content/WorkspaceContent.vue`
- `apps/desktop/src/renderer/src/components/session/SessionHeader.vue`

Specs：

- `packages/coding-agent/docs/desktop-specs/04-electron-ipc.md`
- `packages/coding-agent/docs/desktop-specs/05-state-storage.md`
- `packages/coding-agent/docs/desktop-specs/06-phase-one-acceptance.md`

## 实施步骤

1. 更新共享类型和 preload API。
2. 新增 project IPC channels。
3. 新增 `ProjectStore` 和 metadata version。
4. 修改 thread registry metadata，让 thread summary 写入 `projectId`。
5. 修改 `createThread`，从 `projectId` 解析 `Project.path`。
6. 修改 `restartThread` 和 `ensureWorker`，从 project 解析 cwd。
7. 修改 `listThreads` 支持 `{ projectId }` 过滤。
8. 新增 renderer `workspace-project` store，创建 Project 时通过 preload 触发 main 层目录选择器。
9. 修改 `workspace-session`，删除 `cwdInput`。
10. 修改 Sidebar，加入 project section 和 active project thread list。
11. 更新验收测试和 smoke script。

## 验收

功能验收：

- 可以创建 project。
- 创建 project 时通过系统目录选择器选择目录，不在 renderer 手输 path。
- 可以列出 projects。
- 可以打开 project，并更新 `lastOpenedAt`。
- 可以在 active project 下创建 thread。
- `createThread` 不接受 `cwd`。
- worker 启动时收到的 `cwd` 等于 `Project.path`。
- `listThreads({ projectId })` 只返回该 project 的 threads。
- thread snapshot 包含 `projectId`。
- project missing/permissionDenied/invalid 时不能创建 thread。

数据验收：

- metadata 包含 projects 和 threads。
- `ThreadSummary.projectId` 是显式字段。
- 删除 metadata 后可以从 JSONL session 目录重建 registry。
- JSONL session 文件不是由 ProjectStore 管理或删除。

Renderer 验收：

- 无 active project 时无法创建 thread。
- active project 切换后 thread list 随之切换。
- Sidebar 不再出现 `cwd` 作为主创建入口。
- prompt/abort/approval 主链路保持可用。

兼容验收：

- Pi-compatible JSONL session 语义不变。
- canonical event 语义不变。
- resource/settings/extension/tool 发现语义不变。
- Project API 只存在于 desktop control protocol，不污染 canonical runtime protocol。
