import { type Dispatch, type RefObject, useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { Project, WorkbenchState } from "../../../shared/contracts.ts";
import { sessionEventBus } from "../runtime/session-event-bus.ts";
import type { DesktopThreadActions, PreparedThread } from "../runtime/use-pi-runtime.ts";
import {
  type DesktopAction,
  type DesktopContextValue,
  desktopReducer,
  INITIAL_STATE,
  sessionKey,
  threadFromBootstrap,
} from "./desktop-model.ts";

/** 组合 Desktop IPC、权威快照和本地 Workbench cache。 */
export function useDesktopController(threadActions: RefObject<DesktopThreadActions | null>): DesktopContextValue {
  const [state, dispatch] = useReducer(desktopReducer, INITIAL_STATE);
  const activeProjectId = useRef(state.project?.id);
  activeProjectId.current = state.project?.id;

  const report = useCallback((value: unknown) => {
    dispatch({ type: "error", error: value instanceof Error ? value.message : String(value) });
  }, []);

  const loadThread = useCallback(
    async (project: Project, threadId: string) => {
      try {
        const actions = threadActions.current;
        if (!actions) throw new Error("assistant-ui thread adapter 尚未就绪");
        dispatchPrepared(await actions.open(project, threadId), false, dispatch);
      } catch (value) {
        if (value instanceof DOMException && value.name === "AbortError") return;
        report(value);
      }
    },
    [report, threadActions],
  );

  const loadProject = useCallback(
    async (project: Project) => {
      const threads = await window.desktop.sessions.list(project.id, true);
      dispatch({ type: "project-loaded", project, threads });
      const first = threads.find(({ archived }) => !archived);
      if (first) await loadThread(project, first.id);
      else await threadActions.current?.detach();
    },
    [loadThread, threadActions],
  );

  useEffect(() => {
    let active = true;
    void Promise.all([window.desktop.projects.list(), window.desktop.projects.getActive()])
      .then(async ([projects, current]) => {
        if (!active) return;
        dispatch({ type: "projects-loaded", projects });
        if (current?.available) await loadProject(current);
      })
      .catch(report)
      .finally(() => {
        if (active) dispatch({ type: "loading", loading: false });
      });
    return () => {
      active = false;
    };
  }, [loadProject, report]);

  useEffect(() => sessionEventBus.onControl((control) => dispatch({ type: "control", control })), []);
  useEffect(
    () => () => {
      void threadActions.current?.detach();
    },
    [threadActions],
  );

  const chooseProject = useCallback(async () => {
    try {
      const project = await window.desktop.projects.choose();
      if (!project) return;
      dispatch({ type: "project-upserted", project });
      await loadProject(project);
    } catch (value) {
      report(value);
    }
  }, [loadProject, report]);

  const openProject = useCallback(
    async (projectId: string) => {
      try {
        await loadProject(await window.desktop.projects.open(projectId));
      } catch (value) {
        report(value);
      }
    },
    [loadProject, report],
  );

  const removeProject = useCallback(
    async (projectId: string) => {
      try {
        await window.desktop.projects.remove(projectId);
        if (activeProjectId.current === projectId) await threadActions.current?.detach();
        dispatch({ type: "project-removed", projectId });
      } catch (value) {
        report(value);
      }
    },
    [report, threadActions],
  );

  const createThread = useCallback(async () => {
    if (!state.project) return;
    try {
      const actions = threadActions.current;
      if (!actions) throw new Error("assistant-ui thread adapter 尚未就绪");
      dispatchPrepared(await actions.create(state.project), true, dispatch);
    } catch (value) {
      if (value instanceof DOMException && value.name === "AbortError") return;
      report(value);
    }
  }, [report, state.project, threadActions]);

  const openThread = useCallback(
    async (threadId: string) => {
      if (state.project) await loadThread(state.project, threadId);
    },
    [loadThread, state.project],
  );

  const renameThread = useCallback(
    async (threadId: string, title: string) => {
      if (!state.project) return;
      try {
        const actions = threadActions.current;
        if (!actions) throw new Error("assistant-ui thread adapter 尚未就绪");
        await actions.rename(state.project, threadId, title);
        dispatch({ type: "thread-renamed", threadId, title });
      } catch (value) {
        report(value);
      }
    },
    [report, state.project, threadActions],
  );

  const setThreadArchived = useCallback(
    async (threadId: string, archived: boolean) => {
      if (!state.project) return;
      try {
        const actions = threadActions.current;
        if (!actions) throw new Error("assistant-ui thread adapter 尚未就绪");
        await actions.archive(state.project, threadId, archived);
        dispatch({ type: "thread-archived", threadId, archived });
        if (archived && state.threadId === threadId) {
          const next = state.threads.find((thread) => thread.id !== threadId && !thread.archived);
          if (next) await loadThread(state.project, next.id);
          else {
            await actions.detach();
            dispatch({ type: "thread-cleared" });
          }
        }
      } catch (value) {
        report(value);
      }
    },
    [loadThread, report, state.project, state.threadId, state.threads, threadActions],
  );

  const removeThread = useCallback(
    async (threadId: string) => {
      if (!state.project) return;
      try {
        const actions = threadActions.current;
        if (!actions) throw new Error("assistant-ui thread adapter 尚未就绪");
        await actions.remove(state.project, threadId);
        dispatch({ type: "thread-removed", threadId });
        if (state.threadId === threadId) {
          const next = state.threads.find((thread) => thread.id !== threadId && !thread.archived);
          if (next) await loadThread(state.project, next.id);
          else {
            await actions.detach();
            dispatch({ type: "thread-cleared" });
          }
        }
      } catch (value) {
        report(value);
      }
    },
    [loadThread, report, state.project, state.threadId, state.threads, threadActions],
  );

  const updateWorkbench = useCallback(
    (value: Partial<WorkbenchState>) => {
      if (!state.project || !state.threadId) return;
      const key = sessionKey(state.project.id, state.threadId);
      const previous = state.workbenches[key];
      if (!previous) return;
      const workbench = { ...previous, ...value };
      dispatch({ type: "workbench", workbench });
      void window.desktop.workbench.update(workbench).catch(report);
    },
    [report, state.project, state.threadId, state.workbenches],
  );

  const key = state.project && state.threadId ? sessionKey(state.project.id, state.threadId) : "";
  return useMemo(
    () => ({
      projects: state.projects,
      project: state.project,
      threads: state.threads,
      threadId: state.threadId,
      bootstrap: state.bootstraps[key] ?? null,
      snapshot: state.controls[key] ?? state.bootstraps[key]?.control ?? null,
      workbench: state.workbenches[key] ?? null,
      loading: state.loading,
      error: state.error,
      chooseProject,
      openProject,
      removeProject,
      createThread,
      openThread,
      renameThread,
      setThreadArchived,
      removeThread,
      updateWorkbench,
      clearError: () => dispatch({ type: "error", error: null }),
    }),
    [
      state,
      key,
      chooseProject,
      openProject,
      removeProject,
      createThread,
      openThread,
      renameThread,
      setThreadArchived,
      removeThread,
      updateWorkbench,
    ],
  );
}

function dispatchPrepared(prepared: PreparedThread, created: boolean, dispatch: Dispatch<DesktopAction>): void {
  if (created) {
    dispatch({
      type: "thread-created",
      thread: threadFromBootstrap(prepared.bootstrap),
      bootstrap: prepared.bootstrap,
      workbench: prepared.workbench,
    });
    return;
  }
  dispatch({ type: "thread-loaded", bootstrap: prepared.bootstrap, workbench: prepared.workbench });
}
