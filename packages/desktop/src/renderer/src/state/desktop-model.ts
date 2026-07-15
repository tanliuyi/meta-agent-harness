import type {
  Project,
  SessionBootstrap,
  SessionControlState,
  Thread,
  WorkbenchState,
} from "../../../shared/contracts.ts";

export interface DesktopContextValue {
  projects: Project[];
  project: Project | null;
  threads: Thread[];
  threadId: string | null;
  bootstrap: SessionBootstrap | null;
  snapshot: SessionControlState | null;
  workbench: WorkbenchState | null;
  loading: boolean;
  error: string | null;
  chooseProject(): Promise<void>;
  openProject(projectId: string): Promise<void>;
  removeProject(projectId: string): Promise<void>;
  createThread(): Promise<void>;
  openThread(threadId: string): Promise<void>;
  renameThread(threadId: string, title: string): Promise<void>;
  setThreadArchived(threadId: string, archived: boolean): Promise<void>;
  removeThread(threadId: string): Promise<void>;
  updateWorkbench(value: Partial<WorkbenchState>): void;
  clearError(): void;
}

export interface DesktopState {
  projects: Project[];
  project: Project | null;
  threads: Thread[];
  threadId: string | null;
  bootstraps: Record<string, SessionBootstrap>;
  controls: Record<string, SessionControlState>;
  workbenches: Record<string, WorkbenchState>;
  loading: boolean;
  error: string | null;
}

export const INITIAL_STATE: DesktopState = {
  projects: [],
  project: null,
  threads: [],
  threadId: null,
  bootstraps: {},
  controls: {},
  workbenches: {},
  loading: true,
  error: null,
};

export type DesktopAction =
  | { type: "projects-loaded"; projects: Project[] }
  | { type: "project-upserted"; project: Project }
  | { type: "project-loaded"; project: Project; threads: Thread[] }
  | { type: "project-removed"; projectId: string }
  | { type: "thread-loaded"; bootstrap: SessionBootstrap; workbench: WorkbenchState }
  | { type: "thread-created"; thread: Thread; bootstrap: SessionBootstrap; workbench: WorkbenchState }
  | { type: "thread-renamed"; threadId: string; title: string }
  | { type: "thread-archived"; threadId: string; archived: boolean }
  | { type: "thread-removed"; threadId: string }
  | { type: "thread-cleared" }
  | { type: "control"; control: SessionControlState }
  | { type: "workbench"; workbench: WorkbenchState }
  | { type: "loading"; loading: boolean }
  | { type: "error"; error: string | null };

/** 对 Desktop renderer 的低频控制状态执行无副作用更新。 */
export function desktopReducer(state: DesktopState, action: DesktopAction): DesktopState {
  if (action.type === "projects-loaded") return { ...state, projects: sortProjects(action.projects) };
  if (action.type === "project-upserted") {
    return {
      ...state,
      projects: sortProjects([...state.projects.filter(({ id }) => id !== action.project.id), action.project]),
    };
  }
  if (action.type === "project-loaded")
    return { ...state, project: action.project, threads: action.threads, threadId: null };
  if (action.type === "project-removed") {
    const current = state.project?.id === action.projectId;
    return {
      ...state,
      projects: state.projects.filter(({ id }) => id !== action.projectId),
      project: current ? null : state.project,
      threads: current ? [] : state.threads,
      threadId: current ? null : state.threadId,
    };
  }
  if (action.type === "thread-loaded" || action.type === "thread-created") {
    const key = sessionKey(action.bootstrap.projectId, action.bootstrap.threadId);
    return {
      ...state,
      ...(action.type === "thread-created" ? { threads: [action.thread, ...state.threads] } : {}),
      threadId: action.bootstrap.threadId,
      bootstraps: { ...state.bootstraps, [key]: action.bootstrap },
      controls: { ...state.controls, [key]: action.bootstrap.control },
      workbenches: { ...state.workbenches, [key]: action.workbench },
    };
  }
  if (action.type === "thread-renamed") {
    return {
      ...state,
      threads: state.threads.map((thread) =>
        thread.id === action.threadId ? { ...thread, title: action.title } : thread,
      ),
    };
  }
  if (action.type === "thread-archived") {
    return {
      ...state,
      threads: state.threads.map((thread) =>
        thread.id === action.threadId ? { ...thread, archived: action.archived } : thread,
      ),
    };
  }
  if (action.type === "thread-removed")
    return { ...state, threads: state.threads.filter(({ id }) => id !== action.threadId) };
  if (action.type === "thread-cleared") return { ...state, threadId: null };
  if (action.type === "control") return applyControl(state, action.control);
  if (action.type === "workbench") {
    const key = sessionKey(action.workbench.projectId, action.workbench.threadId);
    return { ...state, workbenches: { ...state.workbenches, [key]: action.workbench } };
  }
  if (action.type === "loading") return { ...state, loading: action.loading };
  return { ...state, error: action.error };
}

function applyControl(state: DesktopState, control: SessionControlState): DesktopState {
  const key = sessionKey(control.projectId, control.threadId);
  const previous = state.controls[key];
  if (!state.bootstraps[key] || (previous && previous.revision >= control.revision)) return state;
  return {
    ...state,
    controls: { ...state.controls, [key]: control },
    threads: state.threads.map((thread) =>
      thread.id === control.threadId && thread.projectId === control.projectId
        ? { ...thread, title: control.title, running: control.running }
        : thread,
    ),
  };
}

export function sessionKey(projectId: string, threadId: string): string {
  return `${projectId}:${threadId}`;
}

export function threadFromBootstrap(bootstrap: SessionBootstrap): Thread {
  return {
    id: bootstrap.threadId,
    projectId: bootstrap.projectId,
    title: bootstrap.control.title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messageCount: bootstrap.messages.filter((message) => message.role === "user" || message.role === "assistant")
      .length,
    preview: "",
    archived: false,
    running: bootstrap.control.running,
  };
}

function sortProjects(projects: Project[]): Project[] {
  return projects.toSorted((left, right) => right.lastOpenedAt - left.lastOpenedAt);
}
