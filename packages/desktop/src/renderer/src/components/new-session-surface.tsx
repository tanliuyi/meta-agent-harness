import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftSessionConfig, GitWorktree, ThinkingLevel } from "../../../shared/contracts.ts";
import { toPiPromptAttachments } from "../runtime/attachments.ts";
import { selectProjects } from "../state/desktop-selectors.ts";
import { dispatchDesktop } from "../state/desktop-store.ts";
import { useDesktopStore } from "../state/desktop-store-context.tsx";
import {
  draftCreateRequestKey,
  isCurrentDraftConfigRequest,
  isStaleExtensionSetError,
  isStaleMainAgentError,
  materializeDraftSession,
  mergeMainAgentDraftConfig,
  refreshMainAgentDraftConfig,
  selectDraftModel,
  selectDraftThinkingLevel,
} from "../state/draft-creation.ts";
import {
  applyStoredDraftSelection,
  persistDraftSelection,
  readStoredDraftProject,
  writeStoredDraftProject,
} from "../state/draft-selection-preference.ts";
import { useDraftSession } from "../state/draft-session-context.tsx";
import { useSessionCache } from "../state/session-cache-context.tsx";
import { resolveDraftProjectId, useDraftSearchParams } from "../state/session-navigation.ts";
import { DraftComposerThread } from "./chat/draft-composer-thread.tsx";
import { EmptyChatState } from "./chat/empty-chat-state.tsx";
import { NewSessionShell } from "./new-session-shell.tsx";

/** Loads draft configuration and materializes the first accepted prompt into a routed Pi session. */
export function NewSessionSurface() {
  const search = useDraftSearchParams();
  const navigate = useNavigate();
  const sessionCache = useSessionCache();
  const desktopStore = useDesktopStore();
  const draft = useDraftSession();
  const {
    runtime,
    projectId,
    setProjectId,
    config,
    setConfig,
    configProjectId,
    setConfigProjectId,
    worktreePath,
    setWorktreePath,
    phase,
    setPhase,
  } = draft;
  const {
    loadError,
    setLoadError,
    navigationTarget,
    setNavigationTarget,
    submitInFlight,
    mainAgentSelection,
    retainedConfig,
    createRequestIds,
    projectFallbackAllowed,
  } = draft;
  const catalogProjects = useStore(desktopStore, selectProjects);
  const catalogLoading = useStore(desktopStore, (state) => state.loading);
  const projects = useMemo(() => catalogProjects.filter((project) => project.available), [catalogProjects]);
  const [worktreeCatalog, setWorktreeCatalog] = useState<{ projectId: string | null; worktrees: GitWorktree[] }>({
    projectId: null,
    worktrees: [],
  });
  const worktrees = worktreeCatalog.projectId === projectId ? worktreeCatalog.worktrees : [];
  const worktreesReady = projectId !== null && worktreeCatalog.projectId === projectId;
  const configTargetId = projectId ? draftCreateRequestKey(projectId, worktreePath ?? undefined) : null;
  const configRequestGeneration = useRef(0);
  const configTargetRef = useRef(configTargetId);
  configTargetRef.current = configTargetId;

  useEffect(() => {
    configRequestGeneration.current += 1;
  }, [configTargetId]);

  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      configRequestGeneration.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!navigationTarget) return;
    const target = navigationTarget;
    setNavigationTarget(null);
    void navigate({ to: "/projects/$projectId/session/$threadId", params: target, replace: true }).catch(
      (reason: unknown) => setLoadError(reason instanceof Error ? reason.message : String(reason)),
    );
  }, [navigate, navigationTarget, setLoadError, setNavigationTarget]);

  useEffect(() => {
    if (catalogLoading) {
      setPhase((current) => (current === "materializing" ? current : "loading"));
      return;
    }
    setProjectId((selected) => {
      const resolved = resolveDraftProjectId(
        projects,
        search.projectId,
        selected,
        projectFallbackAllowed.current,
        readStoredDraftProject(),
      );
      if (search.projectId && resolved === search.projectId) projectFallbackAllowed.current = true;
      else if (selected && resolved === null) projectFallbackAllowed.current = false;
      if (resolved) writeStoredDraftProject(resolved);
      return resolved;
    });
    setPhase((current) => {
      if (current === "materializing") return current;
      return projects.length > 0 ? "editing" : "no-project";
    });
  }, [catalogLoading, projects, search.projectId]);

  useEffect(() => {
    if (!catalogLoading && projectId && !projects.some((project) => project.id === projectId)) {
      setConfig(null);
      setConfigProjectId(null);
      setLoadError(null);
    }
  }, [catalogLoading, projectId, projects]);

  useEffect(() => {
    if (submitInFlight.current) return;
    setConfig(null);
    setConfigProjectId(null);
  }, [setConfig, setConfigProjectId, submitInFlight]);

  useEffect(() => {
    if (submitInFlight.current || catalogLoading || !worktreesReady || !projectId) return;
    if (configProjectId === configTargetId) return;
    const token = { generation: ++configRequestGeneration.current, target: configTargetId };
    let active = true;
    setConfig(null);
    setLoadError(null);
    void window.desktop.sessions
      .getDraftConfig(projectId, worktreePath ?? undefined, mainAgentSelection.current ?? undefined)
      .then((next) => {
        if (!active || !isCurrentDraftConfigRequest(token, configRequestGeneration.current, configTargetRef.current))
          return;
        const current = retainedConfig.current;
        setConfig(
          current?.projectId === projectId
            ? mergeMainAgentDraftConfig(current.config, next)
            : applyStoredDraftSelection(next, projectId),
        );
        setConfigProjectId(configTargetId);
        setLoadError(null);
      })
      .catch((reason: unknown) => {
        if (active && isCurrentDraftConfigRequest(token, configRequestGeneration.current, configTargetRef.current))
          setLoadError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [
    catalogLoading,
    configProjectId,
    configTargetId,
    projectId,
    setConfig,
    setConfigProjectId,
    setLoadError,
    worktreePath,
    worktreesReady,
  ]);

  useEffect(() => {
    if (!submitInFlight.current) {
      setConfig(null);
      setConfigProjectId(null);
    }
    setWorktreeCatalog({ projectId: null, worktrees: [] });
    if (!projectId) return;
    let active = true;
    void window.desktop.projects
      .listWorktrees(projectId)
      .then((next) => {
        if (!active) return;
        setWorktreeCatalog({ projectId, worktrees: next });
        setWorktreePath((current) =>
          next.some((worktree) => worktree.path === current)
            ? current
            : (next.find((worktree) => worktree.current)?.path ?? next[0]?.path ?? null),
        );
      })
      .catch(() => {
        if (!active) return;
        setWorktreeCatalog({ projectId, worktrees: [] });
        setWorktreePath(null);
      });
    return () => {
      active = false;
    };
  }, [projectId, setConfig, setConfigProjectId, setWorktreePath]);

  const project = projects.find((entry) => entry.id === projectId) ?? null;

  useEffect(() => {
    sessionCache.setActiveKey(null);
  }, [sessionCache]);

  async function selectProject(nextProjectId: string) {
    configRequestGeneration.current += 1;

    projectFallbackAllowed.current = true;
    writeStoredDraftProject(nextProjectId);
    setProjectId(nextProjectId);
    setWorktreeCatalog({ projectId: null, worktrees: [] });
    setWorktreePath(null);
    await navigate({ to: "/new", search: { projectId: nextProjectId }, replace: true });
  }

  function selectWorktree(nextWorktreePath: string) {
    configRequestGeneration.current += 1;

    setConfig(null);
    setConfigProjectId(null);
    setWorktreePath(nextWorktreePath);
  }

  function selectModel(provider: string, modelId: string) {
    const next = selectDraftModel(config, provider, modelId);
    persistDraftSelection(projectId, next);
    setConfig(next);
  }

  function selectThinking(thinkingLevel: ThinkingLevel) {
    const next = selectDraftThinkingLevel(config, thinkingLevel);
    persistDraftSelection(projectId, next);
    setConfig(next);
  }

  async function selectMainAgent(selection: NonNullable<DraftSessionConfig["mainAgent"]>["selection"]) {
    if (submitInFlight.current || !projectId || !config) return;
    const previousSelection = mainAgentSelection.current;
    mainAgentSelection.current = selection;
    const current = config;
    const target = configTargetId;
    const token = { generation: ++configRequestGeneration.current, target };
    createRequestIds.delete(draftCreateRequestKey(projectId, worktreePath ?? undefined));
    setConfig(null);
    setLoadError(null);
    try {
      const next = await window.desktop.sessions.getDraftConfig(projectId, worktreePath ?? undefined, selection);
      if (!isCurrentDraftConfigRequest(token, configRequestGeneration.current, configTargetRef.current)) return;
      setConfig(mergeMainAgentDraftConfig(current, next));
    } catch (reason) {
      if (!isCurrentDraftConfigRequest(token, configRequestGeneration.current, configTargetRef.current)) return;
      mainAgentSelection.current = previousSelection;
      setConfig(current);
      setLoadError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function selectPlugins(enabledPluginIds: string[] | null) {
    if (!config) return;
    setConfig({ ...config, extensions: { ...config.extensions, enabledPluginIds } });
  }

  async function submit() {
    if (submitInFlight.current) return;
    if (
      !projectId ||
      configProjectId !== configTargetId ||
      !config?.model ||
      !config.mainAgent ||
      config.readiness.state !== "ready"
    )
      return;
    const mainAgent = config.mainAgent;
    const composer = runtime.thread.composer;
    const state = composer.getState();
    if (state.isEmpty) return;
    submitInFlight.current = true;
    sessionCache.setDraftMaterializing(true);
    setPhase("materializing");
    try {
      const attachments = await toPiPromptAttachments(state.text, state.attachments);
      const materialized = await materializeDraftSession(
        {
          projectId,
          ...(worktreePath ? { worktreePath } : {}),
          model: { provider: config.model.provider, id: config.model.id },
          thinkingLevel: config.thinkingLevel,
          mainAgent: mainAgent.selection,
          extensionSetGeneration: config.extensions.extensionSetGeneration,
          ...(config.extensions.enabledPluginIds ? { enabledPluginIds: config.extensions.enabledPluginIds } : {}),
          text: attachments.text,
          images: attachments.images,
        },
        {
          requestIds: createRequestIds,
          sessions: window.desktop.sessions,
          cache: sessionCache,
          onMaterialized(bootstrap) {
            dispatchDesktop(desktopStore, { type: "thread-catalog-added", bootstrap });
          },
        },
      );
      const target = materialized.target;
      const nextProjectId = projects.some((project) => project.id === target.projectId)
        ? target.projectId
        : (projects[0]?.id ?? null);
      await draft.clear(nextProjectId, target);
    } catch (reason) {
      setPhase("editing");
      if (!mounted.current) throw reason;
      if (isStaleExtensionSetError(reason) || isStaleMainAgentError(reason)) {
        createRequestIds.delete(draftCreateRequestKey(projectId, worktreePath ?? undefined));
        const current = config;
        const target = configTargetId;
        const token = { generation: ++configRequestGeneration.current, target };
        setConfig(null);
        try {
          let selection = mainAgent.selection;
          if (isStaleMainAgentError(reason)) {
            const store = await window.desktop.mainAgents.getSnapshot();
            const profile = store.profiles.find(({ id }) => id === selection.id);
            selection = profile
              ? { id: profile.id, revision: profile.revision }
              : (store.profiles.find(({ id }) => id === store.defaultAgentId) ?? store.profiles[0] ?? selection);
          }
          const next = await refreshMainAgentDraftConfig(current, () =>
            window.desktop.sessions.getDraftConfig(projectId, worktreePath ?? undefined, selection),
          );
          if (!isCurrentDraftConfigRequest(token, configRequestGeneration.current, configTargetRef.current)) {
            throw reason;
          }
          mainAgentSelection.current = next.mainAgent?.selection ?? mainAgentSelection.current;
          setConfig(next);
          setConfigProjectId(target);
        } catch (refreshError) {
          if (isCurrentDraftConfigRequest(token, configRequestGeneration.current, configTargetRef.current)) {
            setConfig(current);
            setConfigProjectId(target);
            setLoadError(refreshError instanceof Error ? refreshError.message : String(refreshError));
          }
        }
      }
      throw reason;
    } finally {
      submitInFlight.current = false;
      sessionCache.setDraftMaterializing(false);
    }
  }

  if (phase === "no-project") {
    return (
      <NewSessionShell disabled={!projectId}>
        <EmptyChatState
          title="没有可用工作区"
          detail={loadError ?? "通用工作区不可用，且没有可用的 Project。请添加一个 Project。"}
        />
      </NewSessionShell>
    );
  }

  return (
    <NewSessionShell disabled={!projectId}>
      <DraftComposerThread
        projects={projects}
        project={project}
        worktrees={worktrees}
        worktreePath={worktreePath}
        config={config}
        configLoading={config === null}
        phase={phase === "materializing" ? "materializing" : "editing"}
        error={loadError}
        diagnostics={config?.extensions.diagnostics}
        onProjectChange={selectProject}
        onWorktreeChange={selectWorktree}
        onModelChange={selectModel}
        onThinkingChange={selectThinking}
        onMainAgentChange={(selection) => void selectMainAgent(selection)}
        onPluginsChange={selectPlugins}
        onSubmit={submit}
      />
    </NewSessionShell>
  );
}
