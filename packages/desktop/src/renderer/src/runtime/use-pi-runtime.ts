import type { AssistantRuntime } from "@assistant-ui/react";
import { type AgUiAssistantRuntime, type UseAgUiThreadListAdapter, useAgUiRuntime } from "@assistant-ui/react-ag-ui";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Project, SessionBootstrap, Thread, WorkbenchState } from "../../../shared/contracts.ts";
import { convertAgUiMessages, messageRepository } from "./ag-ui-messages.ts";
import { ElectronPiAgent } from "./electron-pi-agent.ts";
import { imageAttachmentAdapter } from "./image-attachments.ts";
import { sessionEventBus } from "./session-event-bus.ts";

export interface PreparedThread {
  bootstrap: SessionBootstrap;
  workbench: WorkbenchState;
}

export interface DesktopThreadActions {
  open(project: Project, threadId: string): Promise<PreparedThread>;
  create(project: Project): Promise<PreparedThread>;
  rename(project: Project, threadId: string, title: string): Promise<void>;
  archive(project: Project, threadId: string, archived: boolean): Promise<void>;
  remove(project: Project, threadId: string): Promise<void>;
  detach(): Promise<void>;
}

interface PiRuntimeOptions {
  project: Project | null;
  threads: Thread[];
  threadId: string | null;
  isSendDisabled: boolean;
}

interface PreparedSwitch extends PreparedThread {
  messages: ReturnType<typeof convertAgUiMessages>;
}

/** 使用 assistant-ui thread adapter 管理跨 Pi session 的 hydrate 与切换。 */
export function usePiRuntime(options: PiRuntimeOptions): {
  runtime: AgUiAssistantRuntime;
  actions: DesktopThreadActions;
} {
  const agent = useMemo(() => new ElectronPiAgent(), []);
  const projectRef = useRef(options.project);
  const targetProjectRef = useRef<Project | null>(null);
  const targetThreadIdRef = useRef<string | null>(null);
  const preparedRef = useRef<PreparedSwitch | null>(null);
  const committedThreadRef = useRef<{ projectId: string; threadId: string } | null>(null);
  const switchGeneration = useRef(0);
  const targetGenerationRef = useRef(0);
  projectRef.current = options.project;

  const threadList = useMemo<UseAgUiThreadListAdapter>(() => {
    const project = options.project;
    const regular = options.threads.filter(({ archived }) => !archived);
    const archived = options.threads.filter((thread) => thread.archived);
    const currentProject = () => targetProjectRef.current ?? projectRef.current;
    const currentThreadId = (adapterThreadId: string) => {
      const target = targetThreadIdRef.current;
      if (target) return target;
      const current = currentProject();
      if (!current) throw new Error("没有可用的 Project");
      return adapterThreadId.slice(current.id.length + 1);
    };
    const threadIdFromAdapter = (value: string) => {
      const current = currentProject();
      if (!current) throw new Error("没有可用的 Project");
      const prefix = `${current.id}:`;
      if (!value.startsWith(prefix)) throw new Error(`assistant-ui thread 不属于当前 Project: ${value}`);
      return value.slice(prefix.length);
    };
    return {
      threadId: project && options.threadId ? threadAdapterId(project.id, options.threadId) : undefined,
      threads: project
        ? regular.map((thread) => ({
            id: threadAdapterId(project.id, thread.id),
            remoteId: thread.id,
            title: thread.title,
            status: "regular" as const,
          }))
        : [],
      archivedThreads: project
        ? archived.map((thread) => ({
            id: threadAdapterId(project.id, thread.id),
            remoteId: thread.id,
            title: thread.title,
            status: "archived" as const,
          }))
        : [],
      async onSwitchToThread(adapterThreadId) {
        const generation = targetGenerationRef.current;
        const activeProject = currentProject();
        if (!activeProject) throw new Error("打开 session 前必须先选择 Project");
        const threadId = currentThreadId(adapterThreadId);
        const [bootstrap, workbench] = await Promise.all([
          sessionEventBus.attach(activeProject.id, threadId),
          window.desktop.workbench.get(activeProject.id, threadId),
        ]);
        if (generation !== switchGeneration.current) throw new DOMException("Thread switch superseded", "AbortError");
        await agent.attach(bootstrap);
        const messages = convertAgUiMessages(bootstrap.messages);
        preparedRef.current = { bootstrap, workbench, messages };
        return { messages, state: bootstrap.state };
      },
      async onSwitchToNewThread() {
        const generation = targetGenerationRef.current;
        const activeProject = currentProject();
        if (!activeProject) throw new Error("创建 session 前必须先选择 Project");
        const created = await window.desktop.sessions.create(activeProject.id);
        targetThreadIdRef.current = created.threadId;
        const [bootstrap, workbench] = await Promise.all([
          sessionEventBus.attach(activeProject.id, created.threadId),
          window.desktop.workbench.get(activeProject.id, created.threadId),
        ]);
        if (generation !== switchGeneration.current) throw new DOMException("Thread creation superseded", "AbortError");
        await agent.attach(bootstrap);
        preparedRef.current = { bootstrap, workbench, messages: [] };
      },
      onRename: async (adapterThreadId, title) => {
        const activeProject = currentProject();
        if (!activeProject) throw new Error("没有可用的 Project");
        await window.desktop.sessions.rename(activeProject.id, threadIdFromAdapter(adapterThreadId), title);
      },
      onArchive: async (adapterThreadId) => {
        const activeProject = currentProject();
        if (!activeProject) throw new Error("没有可用的 Project");
        await window.desktop.sessions.archive(activeProject.id, threadIdFromAdapter(adapterThreadId), true);
      },
      onUnarchive: async (adapterThreadId) => {
        const activeProject = currentProject();
        if (!activeProject) throw new Error("没有可用的 Project");
        await window.desktop.sessions.archive(activeProject.id, threadIdFromAdapter(adapterThreadId), false);
      },
      onDelete: async (adapterThreadId) => {
        const activeProject = currentProject();
        if (!activeProject) throw new Error("没有可用的 Project");
        await window.desktop.sessions.remove(activeProject.id, threadIdFromAdapter(adapterThreadId));
      },
    };
  }, [agent, options.project, options.threadId, options.threads]);

  const cancel = useCallback(() => {
    const attached = agent.attachedSession;
    if (!attached) return;
    agent.cancelActive();
    void window.desktop.sessions
      .cancel(attached.projectId, attached.threadId)
      .then(() => sessionEventBus.resync(attached.projectId, attached.threadId))
      .catch((error: unknown) => console.error("取消 Pi run 失败", error));
  }, [agent]);

  const runtime = useAgUiRuntime({
    agent,
    adapters: { attachments: imageAttachmentAdapter, threadList },
    onCancel: cancel,
    isSendDisabled: options.isSendDisabled,
  });

  useEffect(
    () =>
      sessionEventBus.onResync((bootstrap) => {
        void agent
          .attach(bootstrap)
          .then(() => {
            const messages = convertAgUiMessages(bootstrap.messages);
            runtime.thread.import(messageRepository(messages));
            if (!joinActiveRun(runtime, bootstrap, messages)) window.desktop.sessions.flush();
          })
          .catch((error: unknown) => console.error("恢复 Pi session 失败", error));
      }),
    [agent, runtime],
  );

  const actions = useMemo<DesktopThreadActions>(() => {
    const restoreCommittedThread = async () => {
      const committed = committedThreadRef.current;
      if (!committed) {
        sessionEventBus.detach();
        await agent.detach();
        runtime.thread.reset();
        return;
      }
      const bootstrap = await sessionEventBus.attach(committed.projectId, committed.threadId);
      await agent.attach(bootstrap);
      const messages = convertAgUiMessages(bootstrap.messages);
      runtime.thread.import(messageRepository(messages));
      if (!joinActiveRun(runtime, bootstrap, messages)) window.desktop.sessions.flush();
    };
    return {
      async open(project, threadId) {
        const generation = ++switchGeneration.current;
        targetGenerationRef.current = generation;
        targetProjectRef.current = project;
        targetThreadIdRef.current = threadId;
        preparedRef.current = null;
        try {
          await runtime.threads.switchToThread(threadAdapterId(project.id, threadId));
          if (generation !== switchGeneration.current) throw new DOMException("Thread switch superseded", "AbortError");
          const prepared = readPrepared(preparedRef);
          if (!prepared || prepared.bootstrap.threadId !== threadId)
            throw new Error("assistant-ui thread hydrate 未完成");
          if (!joinActiveRun(runtime, prepared.bootstrap, prepared.messages)) window.desktop.sessions.flush();
          committedThreadRef.current = { projectId: project.id, threadId };
          return prepared;
        } catch (error) {
          if (generation === switchGeneration.current) await restoreCommittedThread();
          throw error;
        } finally {
          if (generation === switchGeneration.current) {
            targetProjectRef.current = null;
            targetThreadIdRef.current = null;
          }
        }
      },
      async create(project) {
        const generation = ++switchGeneration.current;
        targetGenerationRef.current = generation;
        targetProjectRef.current = project;
        targetThreadIdRef.current = null;
        preparedRef.current = null;
        try {
          await runtime.threads.switchToNewThread();
          if (generation !== switchGeneration.current)
            throw new DOMException("Thread creation superseded", "AbortError");
          const prepared = readPrepared(preparedRef);
          if (!prepared) throw new Error("assistant-ui new thread hydrate 未完成");
          window.desktop.sessions.flush();
          committedThreadRef.current = { projectId: project.id, threadId: prepared.bootstrap.threadId };
          return prepared;
        } catch (error) {
          if (generation === switchGeneration.current) await restoreCommittedThread();
          throw error;
        } finally {
          if (generation === switchGeneration.current) {
            targetProjectRef.current = null;
            targetThreadIdRef.current = null;
          }
        }
      },
      async rename(project, threadId, title) {
        await runtime.threads.getItemById(threadAdapterId(project.id, threadId)).rename(title);
      },
      async archive(project, threadId, archived) {
        const item = runtime.threads.getItemById(threadAdapterId(project.id, threadId));
        if (archived) await item.archive();
        else await item.unarchive();
      },
      async remove(project, threadId) {
        await runtime.threads.getItemById(threadAdapterId(project.id, threadId)).delete();
      },
      async detach() {
        switchGeneration.current += 1;
        sessionEventBus.detach();
        await agent.detach();
        runtime.thread.reset();
        targetProjectRef.current = null;
        targetThreadIdRef.current = null;
        preparedRef.current = null;
        committedThreadRef.current = null;
      },
    };
  }, [agent, runtime]);

  return { runtime, actions };
}

function joinActiveRun(
  runtime: AssistantRuntime,
  bootstrap: SessionBootstrap,
  messages: ReturnType<typeof convertAgUiMessages>,
): boolean {
  if (!bootstrap.activeRun) return false;
  runtime.thread.startRun({ parentId: messages.at(-1)?.id ?? null });
  return true;
}

function threadAdapterId(projectId: string, threadId: string): string {
  return `${projectId}:${threadId}`;
}

function readPrepared(reference: { current: PreparedSwitch | null }): PreparedSwitch | null {
  return reference.current;
}
