import { errorMessage } from "@renderer/shared/lib/error-message";
import { useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MainAgentCatalog,
  MainAgentConfiguration,
  MainAgentMutationInput,
  MainAgentProfile,
  MainAgentStoreSnapshot,
} from "../../../../../shared/main-agent-contracts.ts";

export type MainAgentSettingsStatus = "loading" | "ready" | "dirty" | "saving" | "saved" | "conflict" | "error";

export interface MainAgentEditorDraft {
  id: string | null;
  revision: number;
  name: string;
  description: string;
  builtin: boolean;
  configuration: MainAgentConfiguration;
}

export function createMainAgentDraft(source: MainAgentProfile): MainAgentEditorDraft {
  return structuredClone(source);
}

export function createNewMainAgentDraft(source: MainAgentProfile): MainAgentEditorDraft {
  return {
    ...structuredClone(source),
    id: null,
    revision: 0,
    name: "新智能体",
    description: "",
    builtin: false,
  };
}

export function validateMainAgentDraft(draft: MainAgentEditorDraft): string[] {
  const errors: string[] = [];
  const name = draft.name.trim();
  if (!name) errors.push("名称不能为空");
  if (name.length > 80) errors.push("名称不能超过 80 个字符");
  if (draft.description.trim().length > 500) errors.push("描述不能超过 500 个字符");
  if (draft.configuration.prompt.mode === "replace" && !draft.configuration.prompt.text.trim())
    errors.push("完全替换基础提示词时，提示词不能为空");
  return errors;
}

export function mainAgentDraftEqual(profile: MainAgentProfile, draft: MainAgentEditorDraft): boolean {
  return JSON.stringify(profile) === JSON.stringify(draft);
}

export function useMainAgentSettingsController() {
  const [snapshot, setSnapshot] = useState<MainAgentStoreSnapshot>();
  const [catalog, setCatalog] = useState<MainAgentCatalog>();
  const [draft, setDraft] = useState<MainAgentEditorDraft>();
  const [status, setStatus] = useState<MainAgentSettingsStatus>("loading");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const mounted = useRef(true);
  const snapshotRef = useRef<MainAgentStoreSnapshot | undefined>(undefined);
  const draftRef = useRef<MainAgentEditorDraft | undefined>(undefined);
  const busy = useRef(false);
  const dirtyRef = useRef(false);

  const original = draft?.id ? snapshot?.profiles.find((profile) => profile.id === draft.id) : undefined;
  const dirty = Boolean(draft && (draft.id === null || !original || !mainAgentDraftEqual(original, draft)));
  const errors = useMemo(() => (draft ? validateMainAgentDraft(draft) : []), [draft]);
  const routeBlocker = useBlocker({ shouldBlockFn: () => dirty, withResolver: true, enableBeforeUnload: false });

  const setEditorDirty = useCallback((nextDirty: boolean) => {
    if (dirtyRef.current === nextDirty) return;
    dirtyRef.current = nextDirty;
    window.desktop.mainAgents.setEditorDirty(nextDirty);
  }, []);

  const chooseFromSnapshot = useCallback(
    (next: MainAgentStoreSnapshot, preferredId?: string | null): MainAgentEditorDraft => {
      const profile =
        next.profiles.find((candidate) => candidate.id === preferredId) ??
        next.profiles.find((candidate) => candidate.id === next.defaultAgentId) ??
        next.profiles[0];
      if (!profile) throw new Error("智能体配置中没有可用条目");
      return createMainAgentDraft(profile);
    },
    [],
  );

  const replaceSnapshot = useCallback(
    (next: MainAgentStoreSnapshot, preferredId?: string | null, nextStatus: MainAgentSettingsStatus = "ready") => {
      if (!mounted.current) return;
      const nextDraft = chooseFromSnapshot(next, preferredId);
      snapshotRef.current = next;
      draftRef.current = nextDraft;
      setSnapshot(next);
      setDraft(nextDraft);
      setEditorDirty(false);
      setError(undefined);
      setStatus(nextStatus);
    },
    [chooseFromSnapshot, setEditorDirty],
  );

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setStatus("loading");
    setError(undefined);
    try {
      const [nextSnapshot, nextCatalog] = await Promise.all([
        window.desktop.mainAgents.getSnapshot(),
        window.desktop.mainAgents.getCatalog(),
      ]);
      if (!mounted.current) return;
      setCatalog(nextCatalog);
      replaceSnapshot(nextSnapshot, draftRef.current?.id);
    } catch (value) {
      if (!mounted.current) return;
      setError(errorMessage(value));
      setStatus("error");
    } finally {
      busy.current = false;
    }
  }, [replaceSnapshot]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      setEditorDirty(false);
    };
  }, [load, setEditorDirty]);

  const mutateDraft = useCallback(
    (change: (current: MainAgentEditorDraft) => MainAgentEditorDraft) => {
      if (busy.current || !draftRef.current) return;
      const next = change(structuredClone(draftRef.current));
      draftRef.current = next;
      setDraft(next);
      setNotice(undefined);
      setError(undefined);
      const nextDirty =
        next.id === null ||
        !snapshotRef.current?.profiles.some((profile) => profile.id === next.id && mainAgentDraftEqual(profile, next));
      setEditorDirty(nextDirty);
      setStatus(nextDirty ? "dirty" : "ready");
    },
    [setEditorDirty],
  );

  const mutate = useCallback(
    async (buildInput: (current: MainAgentStoreSnapshot) => MainAgentMutationInput, success: string) => {
      const current = snapshotRef.current;
      if (!current || busy.current) return false;
      busy.current = true;
      setStatus("saving");
      setError(undefined);
      setNotice(undefined);
      try {
        const result = await window.desktop.mainAgents.mutate(buildInput(current));
        if (result.status === "conflict") {
          setError("配置已被其他窗口修改。当前草稿已保留，请重新载入后再处理。");
          setStatus("conflict");
          return false;
        }
        const oldIds = new Set(current.profiles.map(({ id }) => id));
        const createdId = result.snapshot.profiles.find(({ id }) => !oldIds.has(id))?.id;
        replaceSnapshot(result.snapshot, createdId ?? draftRef.current?.id, "saved");
        setNotice(success);
        return true;
      } catch (value) {
        if (!mounted.current) return false;
        setError(errorMessage(value));
        setStatus("error");
        return false;
      } finally {
        busy.current = false;
      }
    },
    [replaceSnapshot],
  );

  const save = useCallback(async () => {
    const currentDraft = draftRef.current;
    if (!currentDraft || validateMainAgentDraft(currentDraft).length > 0) return false;
    if (currentDraft.id === null) {
      return mutate(
        (current) => ({
          action: "create",
          expectedRevision: current.revision,
          profile: {
            name: currentDraft.name,
            description: currentDraft.description,
            configuration: structuredClone(currentDraft.configuration),
          },
        }),
        "智能体已创建。",
      );
    }
    const profileId = currentDraft.id;
    return mutate(
      (current) => ({
        action: "update",
        expectedRevision: current.revision,
        profile: { ...structuredClone(currentDraft), id: profileId },
      }),
      "智能体已保存，新会话将使用最新配置。",
    );
  }, [mutate]);

  return {
    snapshot,
    catalog,
    draft,
    status,
    error,
    notice,
    dirty,
    errors,
    busy: status === "loading" || status === "saving",
    routeBlocked: routeBlocker.status === "blocked",
    mutateDraft,
    save,
    reload: load,
    select(id: string) {
      if (dirty || !snapshotRef.current) return;
      const next = chooseFromSnapshot(snapshotRef.current, id);
      draftRef.current = next;
      setDraft(next);
      setError(undefined);
      setNotice(undefined);
      setStatus("ready");
    },
    create() {
      if (dirty || !snapshotRef.current) return;
      const source =
        snapshotRef.current.profiles.find((profile) => profile.id === snapshotRef.current?.defaultAgentId) ??
        snapshotRef.current.profiles[0];
      if (!source) return;
      const next = createNewMainAgentDraft(source);
      draftRef.current = next;
      setDraft(next);
      setEditorDirty(true);
      setStatus("dirty");
      setError(undefined);
      setNotice(undefined);
    },
    discardDraft() {
      const current = snapshotRef.current;
      if (!current) return;
      const next = chooseFromSnapshot(current, draftRef.current?.id);
      draftRef.current = next;
      setDraft(next);
      setEditorDirty(false);
      setStatus("ready");
      setError(undefined);
    },
    duplicate: (id: string) =>
      mutate((current) => ({ action: "duplicate", expectedRevision: current.revision, id }), "智能体副本已创建。"),
    remove: (id: string) =>
      mutate((current) => ({ action: "delete", expectedRevision: current.revision, id }), "智能体已删除。"),
    setDefault: (id: string) =>
      mutate(
        (current) => ({ action: "set-default", expectedRevision: current.revision, id }),
        "新会话默认智能体已更新。",
      ),
    resetBuiltin: () =>
      mutate((current) => ({ action: "reset-builtin", expectedRevision: current.revision }), "默认智能体已恢复。"),
    discardAndProceed() {
      setEditorDirty(false);
      routeBlocker.proceed?.();
    },
    cancelRouteChange: () => routeBlocker.reset?.(),
  };
}
