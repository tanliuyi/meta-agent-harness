# Project / Workspace Architecture

## 背景

Meta Agent Desktop 是 desktop-first 的 AI Coding Agent Workbench，不是 Pi CLI 的桌面套壳。它构建在 `packages/coding-agent` 提供的 Pi-compatible runtime 之上，并要求底层保持同构的 session、event、config、resource、extension 和 tool 语义。

当前 desktop 代码仍然继承了 CLI agent 的入口模型：用户输入一个 `cwd`，main 进程基于这个目录创建 `thread`，worker 在该目录下运行 agent。这个模型适合作为 runtime 边界，但不适合作为桌面产品的一等入口。desktop app 应该让用户先管理本地项目和工作区，再在项目内创建 coding thread、管理 session 历史、审批、变更和上下文。

## 目标

把 desktop 层的产品模型直接切换为：

```text
Project / Workspace
  -> Thread
  -> Session / Run
  -> Tool calls / Approvals / File changes
```

其中 `Project.path` 仍然会传给底层 coding-agent runtime 作为 `cwd`，但 `cwd` 只作为实现细节存在。

本次重构不保留 desktop 的旧 `createThread({ cwd })` 产品接口，不为旧 thread/snapshot 提供兼容展示层。项目仍在早期阶段，允许通过重置 desktop 本地数据库完成数据模型切换。

注意：本文不把 `packages/coding-agent` 的 `thread` 重命名为 `Task`。在本产品中，thread 继续表示 coding agent 的核心工作对象；worker 是执行 thread 的 runtime 实例。task 如果出现，应仅表示一次用户意图或 worker 执行，不作为 project 下的主数据层。

## 非目标

- 第一阶段不重写 `packages/coding-agent` 的 runtime。
- 第一阶段不重命名 `packages/coding-agent` runtime 的 `thread` / `session` / `worker` 概念。
- 第一阶段不创建与 Pi session/event/config/resource/extension/tool 语义不兼容的 desktop-only 核心分支。
- 第一阶段不改变 worker 命令中的 `cwd` 语义：`Project.path` 仍作为 runtime `cwd`。
  worker 承载方式切换为 Electron `utilityProcess.fork()`，不再使用 desktop stdio worker。
- 第一阶段不引入多根 workspace 的复杂能力，先支持一个 project 对应一个本地目录。
- 第一阶段不实现完整文件树、diff、terminal、Git 面板，只为这些能力预留实体和边界。

## 现状

关键代码路径：

- `apps/desktop/src/shared/coding-agent/types.ts`
  - `CreateThreadInput.cwd`
  - `ThreadSummary.cwd`
  - `ThreadSnapshot.cwd`
- `apps/desktop/src/main/coding-agent/thread-lifecycle.ts`
  - `createThread` 校验 `input.cwd`
  - `acquireThreadWorker({ cwd })`
- `apps/desktop/src/main/coding-agent/thread-manager-core.ts`
  - thread registry 以 `threadId` 为主键，snapshot 中直接暴露 `cwd`
- `apps/desktop/src/main/coding-agent/thread-store.ts`
  - SQLite 只持久化 `threads` 和 `thread_snapshots`
- `apps/desktop/src/renderer/src/stores/workspace-session.ts`
  - renderer 直接维护 `cwdInput`
  - `createThread` 直接调用 `window.api.codingAgent.createThread({ cwd })`
- `apps/desktop/src/renderer/src/views/workspace/components/sidebar/Sidebar.vue`
  - UI 直接展示 `cwd` 输入框

这意味着 desktop 目前没有稳定的 project registry，也没有 project 级配置、权限、最近项目、thread 归属和 future workspace 面板边界。

## 核心实体

### Project

Project 是 desktop 产品的一等实体，表示一个本地代码项目。它把原本散落在 thread 上的 `cwd` 产品化为可管理、可恢复、可配置的归属边界。

```ts
export interface ProjectSummary {
  projectId: string
  name: string
  path: string
  status: 'available' | 'missing' | 'permissionDenied'
  createdAt: string
  updatedAt: string
  lastOpenedAt?: string
}
```

可后续扩展：

```ts
export interface ProjectSettings {
  projectId: string
  defaultProvider?: string
  defaultModelId?: string
  defaultThinkingLevel?: ThinkingLevel
  approvalPolicy?: ApprovalPolicy
  agentDir?: string
}
```

### Workspace

在当前阶段，Workspace 可以先作为 UI 概念存在，代表当前打开的 project 工作区。暂不需要单独持久化 `Workspace` 表。

后续如果要支持多根目录、monorepo 子项目集合、远程 workspace，可以再把 Workspace 提升为独立实体。

### Thread

Thread 是某个 project 下的一条 coding agent 工作线。它是 `packages/coding-agent/docs/desktop-architecture.md` 定义的核心产品对象：包含项目工作目录、持久化 session、agent 进程、模型/reasoning 配置、事件流和生命周期操作。

在 runtime 语义里，thread 不是一次短任务，也不是单个 worker 进程。一个 thread 可以停止、重启、继续 prompt、切换 session、fork/clone/compact；worker 是 thread 当前运行时的承载实例。

```ts
export interface ThreadSummary {
  threadId: string
  projectId: string
  title?: string
  status: ThreadStatus
  sessionFile?: string
  archivedAt?: string
  createdAt: string
  updatedAt: string
}
```

### Session / Run

Session 是 Pi-compatible JSONL 对话与上下文历史，归属于 thread 的当前或可切换历史。Run 是一次实际 agent loop 或 worker 执行过程。当前 runtime 已经有 session 文件、状态和事件流，desktop 第一阶段只需要保持现状，不额外拆表。

SQLite 可以索引 session metadata、thread registry、tool timeline 和 file changes，但 JSONL session 仍是 agent 上下文、branching 和兼容导入导出的 canonical persistence。

后续可以在 desktop store 中增加：

- `thread_sessions`
- `agent_runs`
- `tool_calls`
- `file_changes`
- `approval_requests`

## IPC 边界

建议新增 project 相关 IPC。Project API 属于 desktop control protocol；prompt、session、model、thinking、compaction、approval、extension UI 等能力继续沿用 canonical coding-agent protocol。

第一阶段可以继续放在 `codingAgent` API 下，便于控制改动范围：

```ts
export interface CreateProjectInput {
  path: string
  name?: string
}

export interface CreateThreadInput {
  projectId: string
  title?: string
  initialPrompt?: string
  sessionFile?: string
  agentDir?: string
}
```

建议新增能力：

```ts
listProjects(): Promise<ProjectSummary[]>
createProject(): Promise<ProjectSummary | undefined>
openProject(projectId: string): Promise<ProjectSummary>
renameProject(input: RenameProjectInput): Promise<void>
createThread(input: CreateThreadInput): Promise<ThreadSnapshot>
listThreads(input?: { projectId?: string }): Promise<ThreadSummary[]>
```

`createThread` 必须接收 `projectId`。main 进程根据 `projectId` 读取 `Project.path`，再把该路径作为 `cwd` 传给 worker。renderer 不再构造或传递 `cwd`。

## Main 进程架构

建议从当前 `CodingThreadManager` 拆出 project 责任：

```text
ProjectStore
  管理 projects 表、路径校验、最近打开时间、归档

ProjectManager
  管理 project 生命周期和 project 级设置

CodingThreadManager
  管理 coding thread 生命周期、thread worker 绑定、runtime commands
  创建 thread 时通过 projectId 解析 cwd
```

第一阶段可以不创建完整 `ProjectManager`，直接在 main IPC 层组合 `ProjectStore + CodingThreadManager`。

Worker 由 Electron main 通过 `utilityProcess.fork()` 启动。main 侧的 worker client
使用 `postMessage` 投递结构化命令，worker 入口通过 `process.parentPort` 接收命令、
回发响应和事件。`cwd` 仍由 `CreateThreadInput.projectId -> Project.path` 解析得到，
并作为 `thread.start` 输入传给 worker；renderer 不知道 worker pid，也不直接操作
worker transport。每个运行中的 thread 绑定一个独立 utility process worker，main
侧只维护 threadId 到 worker 的 registry，不设置 agent 并行上限。

## SQLite Schema

当前表：

```sql
threads(thread_id, summary_json, updated_at)
thread_snapshots(thread_id, snapshot_json, updated_at)
```

建议切换为：

```sql
create table if not exists projects (
  project_id text primary key,
  name text not null,
  path text not null unique,
  status text not null,
  created_at text not null,
  updated_at text not null,
  last_opened_at text,
  archived_at text,
  summary_json text not null
);

create table if not exists threads (
  thread_id text primary key,
  project_id text not null,
  summary_json text not null,
  updated_at text not null,
  foreign key(project_id) references projects(project_id)
);

create index if not exists idx_threads_project_id
  on threads(project_id);
```

第一阶段可以继续把 thread 和 project 的完整 summary 存在 JSON 中，但 `project_id` 必须成为 `threads` 表的显式列，用于过滤、约束和后续演进。

数据库只保存 desktop registry、索引和 projection。它不能替代 Pi-compatible JSONL session，也不能成为实时事件或 agent context 的第二真相源。

由于不保留兼容层，开发期可以采用以下策略之一：

1. 删除旧 `meta-agent.db` 后重建。
2. 增加 schema version，检测到旧 schema 时清空 desktop registry。
3. 提供一次性 dev migration，仅从旧 thread 的 cwd 生成 project/thread，但不保留旧 API。

## Renderer 状态模型

当前 store 名称 `workspace-session` 可以保留，但职责需要拆分：

```text
workspace-project
  projects
  create/open/rename project

workspace-session
  所有 project 下的 threads，按 projectId 分组展示
  activeThreadId
  sendPrompt/abort/approval/session 操作
```

UI 上建议从：

```text
cwd input
thread list
```

演进为：

```text
Project switcher / recent projects
Open Project button
Active project metadata
Thread list for active project
New Thread button
```

## UI 信息架构

建议主界面结构：

```text
Sidebar
  Project switcher
  Recent projects
  Threads in active project

Main
  Thread header
  Chat / execution timeline

Inspector
  Project context
  Approvals
  Files / changes
  Sessions
  Runtime settings
```

第一阶段只需要替换 sidebar 的输入心智：

- 把 `cwd` 输入改成 `Open Project`，由 main 层打开系统目录选择器。
- 创建 thread 时默认使用 active project。
- thread item 显示 title、status，不再把 cwd 当主标题。

## 迁移计划

### Phase 1: Desktop Project Registry

目标：建立 project/workspace 概念，但 runtime 仍然使用 cwd。

- 新增 `ProjectSummary`、`CreateProjectInput` 等共享类型。
- 新增 project IPC channels。
- 新增 `ProjectStore`，持久化 projects。
- `createThread({ projectId })` 内部解析 `project.path` 为 `cwd`。
- 删除 desktop 侧 `createThread({ cwd })` 入口。
- `ThreadSummary` 和 `ThreadSnapshot` 必须包含 `projectId`。
- renderer 不再维护 `cwdInput`。
- renderer 新增 `workspace-project` store。
- sidebar 从 cwd 输入调整为 project 打开和 project 下 thread 列表。

验收标准：

- 用户可以添加/打开一个 project。
- 用户可以在 active project 下创建 thread。
- renderer 创建 thread 时不传 cwd。
- desktop 本地 registry 中的 thread 都有 projectId。
- worker 通过 Electron `utilityProcess.fork()` 启动，命令链路使用
  `postMessage`/`process.parentPort`，但 runtime 收到的 `cwd` 仍等于 `Project.path`。

### Phase 2: Project-aware Threads

目标：完善 project 下的 thread 管理和恢复体验。

- `listThreads({ projectId })` 支持按 project 过滤。
- UI 支持 project 切换时更新 thread list。
- 最近打开 project 能自动恢复。
- 空 project、无 active thread、project missing 等状态有清晰 UI。

验收标准：

- 不同 project 的 thread 不混在一起。
- 最近打开 project 能恢复。
- 归档 project 不影响 thread 数据，但默认隐藏。

### Phase 3: Project Settings and Trust

目标：把模型、权限、agentDir、project trust 等配置提升到 project 级。

- 新增 project settings。
- thread 创建时继承 project 默认模型和 thinking level。
- approval scope 中的 `workspace` 明确映射到 project。
- 接入 coding-agent runtime 现有 ProjectTrust 能力。

验收标准：

- 同一 project 的 thread 共享默认模型和权限策略。
- 用户能理解审批作用范围是当前 project。

### Phase 4: Workspace Panels

目标：让 desktop app 从聊天壳变成工作台。

- Project 文件树。
- Git branch/status。
- File changes / diff viewer。
- Terminal panel。
- Tool calls timeline。
- Session browser / fork graph。

验收标准：

- 用户不需要离开 app 就能理解 agent 做了什么。
- 用户能在 project 范围内查看、批准、回滚或继续任务。

## 第一阶段建议文件变更

共享类型：

- `apps/desktop/src/shared/coding-agent/types.ts`
- `apps/desktop/src/shared/coding-agent/channels.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/preload/index.d.ts`

Main：

- `apps/desktop/src/main/coding-agent/project-store.ts`
- `apps/desktop/src/main/coding-agent/ipc.ts`
- `apps/desktop/src/main/coding-agent/thread-lifecycle.ts`
- `apps/desktop/src/main/coding-agent/thread-store.ts`
- `apps/desktop/src/main/coding-agent/thread-manager-core.ts`

Renderer：

- `apps/desktop/src/renderer/src/stores/workspace-project.ts`
- `apps/desktop/src/renderer/src/stores/workspace-session.ts`
- `apps/desktop/src/renderer/src/views/workspace/components/sidebar/Sidebar.vue`
- `apps/desktop/src/renderer/src/components/session/SessionHeader.vue`

## 命名建议

用户可见名称：

- 使用 `Project` 或 `Workspace`，不要显示 `cwd`。
- 如果只支持单目录项目，UI 文案优先用 `Project`。
- `Workspace` 保留给“当前工作区视图”或未来多项目集合。

代码名称：

- 数据实体用 `Project`。
- UI 页面和布局继续用 `Workspace`。
- runtime 参数保留 `cwd`。

## 设计原则

- `cwd` 是 runtime 细节，不是产品入口。
- Meta Agent Desktop 是 desktop-first 产品，不是 Pi CLI 的图形外壳。
- desktop 构建在 Pi-compatible runtime 之上，不重新发明 agent runtime。
- 保持 session/event/config/resource/extension/tool 语义同构。
- `Project` 是 desktop 产品的归属边界。
- `Thread` 沿用 `packages/coding-agent` 的核心产品对象，但在 desktop 中不应该脱离 project 存在。
- `Worker` 是 thread 的执行承载，不是 project 下的主产品层。
- `workspace` 审批范围应映射到当前 project。
- SQLite 是 registry/index/projection，不是 session canonical persistence。
- 不保留旧 `cwd -> thread` desktop API。
- 先建立边界，再扩展文件树、Git、diff、terminal 等重 UI 能力。
