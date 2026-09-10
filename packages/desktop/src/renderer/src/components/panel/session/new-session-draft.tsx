import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useEffect } from "react";
import { useStore } from "zustand";
import type { DraftSessionConfig, ThinkingLevel } from "../../../../../shared/contracts.ts";
import { toPiPromptAttachments } from "../../../runtime/attachments.ts";
import { sessionRecordKey } from "../../../runtime/pi-session-store.ts";
import { useDesktopActions } from "../../../state/desktop-context.tsx";
import { selectProjects } from "../../../state/desktop-selectors.ts";
import { useDesktopStore } from "../../../state/desktop-store-context.tsx";
import {
  draftCreateRequestKey,
  isStaleExtensionSetError,
  isStaleMainAgentError,
  materializeDraftSession,
  mergeMainAgentDraftConfig,
  refreshMainAgentDraftConfig,
  selectDraftModel,
  selectDraftThinkingLevel,
} from "../../../state/draft-creation.ts";
import {
  applyStoredDraftSelection,
  persistDraftSelection,
  writeStoredDraftProject,
} from "../../../state/draft-selection-preference.ts";
import { useSessionCache } from "../../../state/session-cache-context.tsx";
import { useSessionDraft } from "../../../state/session-draft-context.tsx";
import { workbenchPanelTabKey } from "../../../state/workbench-tab-context.tsx";
import { DraftComposerThread } from "../../chat/draft-composer-thread.tsx";
import { useSessionControlSelector, useSessionScope, useSessionWorkbenchTabs } from "../../session-context.tsx";
import { NEW_SESSION_PANEL_KIND } from "../builtin-panel-kinds.ts";

/**
 * workbench-panel 中的新会话草稿：项目固定为当前主 session 所在项目，
 * 提交后创建主 session 的子会话，并作为侧边栏 tab 打开（不导航主工作区）。
 * 草稿状态按主 session 隔离（见 SessionDraftProvider），切换主 session 不串台。
 */
export function NewSessionDraft() {
  const { record } = useSessionScope();
  const actions = useDesktopActions();
  const sessionCache = useSessionCache();
  const desktopStore = useDesktopStore();
  const workbenchTabs = useSessionWorkbenchTabs();
  const parentCwd = useSessionControlSelector((control) => control?.cwd);
  const binding = useSessionDraft(record.key);
  const draft = binding?.draft ?? null;
  const runtime = binding?.runtime ?? null;
  const project =
    useStore(desktopStore, selectProjects).find((entry) => entry.id === draft?.parent.projectId && entry.available) ??
    null;
  const worktreePath = parentCwd && parentCwd !== project?.cwd ? parentCwd : undefined;

  // 加载主 session 所在项目的草稿配置；主 session 变化（换 record）时重新加载。
  useEffect(() => {
    if (!draft || draft.submitInFlight) return;
    const current = draft.retainedConfig;
    const source = draft.mainAgentSource;
    const selection =
      source === "profile" && draft.mainAgentSelection
        ? draft.mainAgentSelection
        : { kind: "inherit-parent" as const, parentThreadId: draft.parent.threadId };
    draft.setConfig(null);
    draft.setLoadError(null);
    draft.setPhase("editing");
    const requestGeneration = draft.beginConfigRequest();
    if (!parentCwd) return;
    const projectId = draft.parent.projectId;
    writeStoredDraftProject(projectId);
    let active = true;
    void window.desktop.sessions
      .getDraftConfig(projectId, worktreePath, selection)
      .then((next) => {
        if (!active || !draft.isCurrentConfigRequest(requestGeneration)) return;
        if (source === "inherit-parent" && next.mainAgent) draft.setInheritedMainAgent(next.mainAgent.snapshot);
        draft.setConfig(
          current ? mergeMainAgentDraftConfig(current, next) : applyStoredDraftSelection(next, projectId),
        );
        draft.setLoadError(null);
      })
      .catch((reason: unknown) => {
        if (active && draft.isCurrentConfigRequest(requestGeneration)) {
          draft.setLoadError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      active = false;
      draft.beginConfigRequest();
    };
  }, [draft, parentCwd, worktreePath]);

  if (!draft || !runtime) {
    return <div className="panel-content sidebar-session-loading">正在同步草稿…</div>;
  }

  const selectModel = (provider: string, modelId: string): void => {
    const next = selectDraftModel(draft.config, provider, modelId);
    persistDraftSelection(draft.parent.projectId, next);
    draft.setConfig(next);
  };

  const selectThinking = (thinkingLevel: ThinkingLevel): void => {
    const next = selectDraftThinkingLevel(draft.config, thinkingLevel);
    persistDraftSelection(draft.parent.projectId, next);
    draft.setConfig(next);
  };

  const selectMainAgent = async (
    selection: NonNullable<DraftSessionConfig["mainAgent"]>["selection"] | null,
  ): Promise<void> => {
    if (!draft.config || draft.submitInFlight) return;
    const current = draft.config;
    const previousSource = draft.mainAgentSource;
    const previousSelection = draft.mainAgentSelection;
    draft.mainAgentSelection = selection;
    draft.setMainAgentSource(selection ? "profile" : "inherit-parent");
    const requestGeneration = draft.beginConfigRequest();
    draft.createRequestIds.clear();
    draft.setConfig(null);
    draft.setLoadError(null);
    try {
      const next = await window.desktop.sessions.getDraftConfig(
        draft.parent.projectId,
        worktreePath,
        selection ?? {
          kind: "inherit-parent",
          parentThreadId: draft.parent.threadId,
        },
      );
      if (!draft.isCurrentConfigRequest(requestGeneration)) return;
      if (!selection && next.mainAgent) draft.setInheritedMainAgent(next.mainAgent.snapshot);
      draft.setConfig(mergeMainAgentDraftConfig(current, next));
    } catch (reason) {
      if (!draft.isCurrentConfigRequest(requestGeneration)) return;
      draft.mainAgentSelection = previousSelection;
      draft.setMainAgentSource(previousSource);
      draft.setConfig(current);
      draft.setLoadError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const selectPlugins = (enabledPluginIds: string[] | null): void => {
    if (!draft.config) return;
    draft.setConfig({ ...draft.config, extensions: { ...draft.config.extensions, enabledPluginIds } });
  };

  const submit = async (): Promise<void> => {
    if (draft.submitInFlight || !parentCwd) return;
    const config = draft.config;
    if (!config?.model || !config.mainAgent || config.readiness.state !== "ready") return;
    const mainAgent = config.mainAgent;
    const mainAgentSource = draft.mainAgentSource;
    const composer = runtime.thread.composer;
    const state = composer.getState();
    if (state.isEmpty) return;
    const submissionGeneration = draft.beginConfigRequest();
    draft.setSubmitInFlight(true);
    sessionCache.setDraftMaterializing(true);
    draft.setPhase("materializing");
    try {
      const attachments = await toPiPromptAttachments(state.text, state.attachments);
      const materialized = await materializeDraftSession(
        {
          projectId: draft.parent.projectId,
          ...(worktreePath ? { worktreePath } : {}),
          parentThreadId: draft.parent.threadId,
          model: { provider: config.model.provider, id: config.model.id },
          thinkingLevel: config.thinkingLevel,
          ...(mainAgentSource === "profile" ? { mainAgent: mainAgent.selection } : {}),
          extensionSetGeneration: config.extensions.extensionSetGeneration,
          ...(config.extensions.enabledPluginIds ? { enabledPluginIds: config.extensions.enabledPluginIds } : {}),
          text: attachments.text,
          images: attachments.images,
        },
        {
          requestIds: draft.createRequestIds,
          sessions: window.desktop.sessions,
          cache: sessionCache,
          onMaterialized() {
            // 子会话的父级关系由 metadata 索引从 session header 推导，主动刷新目录。
            actions.refreshProjectThreads(draft.parent.projectId);
          },
        },
      );
      const target = materialized.target;
      // 作为侧边栏 tab 打开子会话，主工作区保持在主 session；草稿 tab 随之关闭。
      workbenchTabs.openSessionTab({
        kind: "session",
        key: sessionRecordKey(target.projectId, target.threadId),
        projectId: target.projectId,
        threadId: target.threadId,
        displayName: state.text.trim().slice(0, 48) || "新会话",
      });
      workbenchTabs.closeTab(workbenchPanelTabKey(NEW_SESSION_PANEL_KIND));
      await composer.reset();
      draft.clear();
    } catch (reason) {
      draft.setPhase("editing");
      if (!draft.isCurrentConfigRequest(submissionGeneration)) throw reason;
      if (isStaleExtensionSetError(reason) || isStaleMainAgentError(reason)) {
        draft.createRequestIds.delete(draftCreateRequestKey(draft.parent.projectId, worktreePath));
        const current = config;
        const requestGeneration = draft.beginConfigRequest();
        draft.setConfig(null);
        try {
          let source =
            draft.mainAgentSource === "inherit-parent"
              ? ({ kind: "inherit-parent", parentThreadId: draft.parent.threadId } as const)
              : mainAgent.selection;
          let nextSource = draft.mainAgentSource;
          if (isStaleMainAgentError(reason) && draft.mainAgentSource === "profile") {
            const store = await window.desktop.mainAgents.getSnapshot();
            const profile = store.profiles.find(({ id }) => id === current.mainAgent?.selection.id);
            source = profile
              ? { id: profile.id, revision: profile.revision }
              : { kind: "inherit-parent", parentThreadId: draft.parent.threadId };
            nextSource = profile ? "profile" : "inherit-parent";
          }
          const next = await refreshMainAgentDraftConfig(current, () =>
            window.desktop.sessions.getDraftConfig(draft.parent.projectId, worktreePath, source),
          );
          if (!draft.isCurrentConfigRequest(requestGeneration)) return;
          draft.setMainAgentSource(nextSource);
          if (nextSource === "inherit-parent" && next.mainAgent) {
            draft.setInheritedMainAgent(next.mainAgent.snapshot);
          }
          draft.setConfig(next);
        } catch (refreshError) {
          if (!draft.isCurrentConfigRequest(requestGeneration)) return;
          draft.setConfig(current);
          draft.setLoadError(refreshError instanceof Error ? refreshError.message : String(refreshError));
        }
      }
      throw reason;
    } finally {
      draft.setSubmitInFlight(false);
      sessionCache.setDraftMaterializing(false);
    }
  };

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="panel-content sidebar-new-session-draft">
        <DraftComposerThread
          projects={project ? [project] : []}
          project={project}
          config={draft.config}
          configLoading={draft.config === null}
          phase={draft.phase === "materializing" ? "materializing" : "editing"}
          error={draft.loadError}
          diagnostics={draft.config?.extensions.diagnostics}
          fixedProject
          compact
          onProjectChange={async () => undefined}
          onModelChange={selectModel}
          onThinkingChange={selectThinking}
          inheritedMainAgent={draft.mainAgentSource === "inherit-parent"}
          inheritedMainAgentProfile={draft.inheritedMainAgent}
          onMainAgentChange={(selection) => void selectMainAgent(selection)}
          onInheritMainAgent={() => void selectMainAgent(null)}
          onPluginsChange={selectPlugins}
          onSubmit={submit}
        />
      </div>
    </AssistantRuntimeProvider>
  );
}
