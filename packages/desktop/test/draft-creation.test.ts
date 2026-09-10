import { describe, expect, it, vi } from "vitest";
import { createSessionRecord } from "../src/renderer/src/runtime/pi-session-store.ts";
import {
  ensureDraftCreateRequestId,
  isCurrentDraftConfigRequest,
  materializeDraftSession,
  mergeMainAgentDraftConfig,
  refreshMainAgentDraftConfig,
} from "../src/renderer/src/state/draft-creation.ts";
import type { SessionBootstrap, SessionCommandResult } from "../src/shared/contracts.ts";
import { PROTOCOL_VERSION } from "../src/shared/contracts.ts";

describe("draft creation request", () => {
  it("同一 Project 的创建重试复用 request ID", () => {
    const requestIds = new Map<string, string>();
    const createId = vi.fn().mockReturnValueOnce("first").mockReturnValueOnce("second");

    expect(ensureDraftCreateRequestId(requestIds, "project", createId)).toBe("first");
    expect(ensureDraftCreateRequestId(requestIds, "project", createId)).toBe("first");
    expect(createId).toHaveBeenCalledOnce();

    requestIds.delete("project");
    expect(ensureDraftCreateRequestId(requestIds, "project", createId)).toBe("second");
  });

  it("按 create、attach、prompt 顺序提交，不切换路由活动会话", async () => {
    const harness = createHarness();

    await expect(materializeDraftSession(input(), harness.dependencies)).resolves.toEqual({
      target: { projectId: "project", threadId: "thread" },
      outcome: "accepted",
    });

    expect(harness.order).toEqual(["create", "attach", "prompt", "catalog"]);
    expect(harness.onMaterialized).toHaveBeenCalledWith(expect.objectContaining({ threadId: "thread" }));
  });

  it("将选中的 worktree 加入创建请求", async () => {
    const harness = createHarness();

    await materializeDraftSession({ ...input(), worktreePath: "/workspace/worktree" }, harness.dependencies);

    expect(harness.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project",
        mainAgent: { id: "agent-a", revision: 3 },
        worktreePath: "/workspace/worktree",
      }),
    );
    expect(harness.dependencies.requestIds).toHaveLength(0);
  });

  it("does not apply a delayed profile response after the routed draft target changes", async () => {
    let resolveResponse: ((value: ReturnType<typeof draftConfig>) => void) | undefined;
    const response = new Promise<ReturnType<typeof draftConfig>>((resolve) => {
      resolveResponse = resolve;
    });
    const oldRequest = { generation: 2, target: "project-a\0/worktree-a" };
    let currentGeneration = 2;
    let currentTarget: string | null = oldRequest.target;
    const applied: string[] = [];
    const request = response.then((config) => {
      if (isCurrentDraftConfigRequest(oldRequest, currentGeneration, currentTarget)) {
        applied.push(config.mainAgent.selection.id);
      }
    });

    currentGeneration = 3;
    currentTarget = "project-b\0/worktree-b";
    resolveResponse?.(draftConfig("late-agent", 1));
    await request;

    expect(applied).toEqual([]);
  });

  it("orchestrates exactly one stale-extension reload without losing user-owned choices", async () => {
    const current = {
      ...draftConfig("agent-a", 1),
      thinkingLevel: "high" as const,
    };
    const refreshed = {
      ...draftConfig("agent-a", 1),
      extensions: { ...draftConfig("agent-a", 1).extensions, extensionSetGeneration: "extensions-new" },
    };
    const load = vi.fn(async () => refreshed);

    await expect(refreshMainAgentDraftConfig(current, load)).resolves.toMatchObject({
      thinkingLevel: "high",
      extensions: { extensionSetGeneration: "extensions-new" },
    });
    expect(load).toHaveBeenCalledOnce();
  });

  it("preserves model, thinking, and plugin choices across main-agent draft resolution", () => {
    const base = draftConfig("agent-a", 1);
    const current = {
      ...base,
      thinkingLevel: "high" as const,
      extensions: { ...base.extensions, enabledPluginIds: ["plugin-a"] },
    };

    expect(mergeMainAgentDraftConfig(current, draftConfig("agent-b", 2))).toMatchObject({
      model: current.model,
      thinkingLevel: "high",
      mainAgent: { selection: { id: "agent-b", revision: 2 } },
      extensions: { enabledPluginIds: ["plugin-a"] },
      readiness: { state: "ready" },
    });
  });

  it("omits mainAgent when a manual child inherits the parent snapshot", async () => {
    const harness = createHarness();
    const { mainAgent: _mainAgent, ...inheritedInput } = input();

    await materializeDraftSession(inheritedInput, harness.dependencies);

    expect(harness.create).toHaveBeenCalledWith(expect.not.objectContaining({ mainAgent: expect.anything() }));
  });

  it("attach 失败时 retire cache 并删除未提交 session", async () => {
    const harness = createHarness();
    harness.ensureAttached.mockRejectedValueOnce(new Error("attach failed"));

    await expect(materializeDraftSession(input(), harness.dependencies)).rejects.toThrow("attach failed");

    expect(harness.retire).toHaveBeenCalledWith("project\u0000thread");
    expect(harness.remove).toHaveBeenCalledWith("project", "thread", "subtree");
    expect(harness.prompt).not.toHaveBeenCalled();
    expect(harness.onMaterialized).not.toHaveBeenCalled();
  });

  it("preflight 失败时清理 session，未知结果时保留 session", async () => {
    const rejected = createHarness({ accepted: false, queued: false, error: "rejected" });

    await expect(materializeDraftSession(input(), rejected.dependencies)).rejects.toThrow("rejected");
    expect(rejected.retire).toHaveBeenCalledOnce();
    expect(rejected.remove).toHaveBeenCalledOnce();
    expect(rejected.onMaterialized).not.toHaveBeenCalled();

    const unknown = createHarness();
    unknown.prompt.mockRejectedValueOnce(new Error("unknown outcome"));
    await expect(materializeDraftSession(input(), unknown.dependencies)).resolves.toEqual({
      target: { projectId: "project", threadId: "thread" },
      outcome: "unknown",
    });
    expect(unknown.retire).not.toHaveBeenCalled();
    expect(unknown.remove).not.toHaveBeenCalled();
    expect(unknown.onMaterialized).toHaveBeenCalledWith(expect.objectContaining({ threadId: "thread" }));
  });
});

function input() {
  return {
    projectId: "project",
    model: { provider: "provider", id: "model" },
    thinkingLevel: "off" as const,
    extensionSetGeneration: "extensions-generation",
    mainAgent: { id: "agent-a", revision: 3 },
    text: "hello",
    images: [],
  };
}

function draftConfig(id: string, revision: number) {
  return {
    models: [
      {
        provider: "provider",
        id: "model",
        name: "Model",
        contextWindow: 100_000,
        thinking: true,
        thinkingLevels: ["off", "high"] as const,
      },
    ],
    commands: [],
    model: { provider: "provider", id: "model", name: "Model" },
    thinkingLevel: "off" as const,
    thinkingLevels: ["off", "high"] as const,
    readiness: { state: "ready" as const },
    extensions: { extensionSetGeneration: "extensions-generation", diagnostics: [] },
    mainAgent: {
      selection: { id, revision },
      profiles: [{ id, revision, name: id, description: "", builtin: false }],
      snapshot: {
        version: 1 as const,
        profileId: id,
        profileRevision: revision,
        profileName: id,
        createdAt: 1,
        configuration: {
          prompt: {
            mode: "default" as const,
            text: "",
            includeGlobalRules: true,
            includeProjectRules: true,
            includeSkills: true,
          },
          tools: null,
          builtinPluginIds: null,
        },
      },
      tools: [],
      builtinPlugins: [],
      promptSources: [],
    },
  };
}

function createHarness(promptResult: SessionCommandResult = { accepted: true, queued: false }) {
  const order: string[] = [];
  const create = vi.fn(async () => {
    order.push("create");
    return bootstrap();
  });
  const ensureAttached = vi.fn(async () => {
    order.push("attach");
    return createSessionRecord({ projectId: "project", threadId: "thread" });
  });
  const prompt = vi.fn(async () => {
    order.push("prompt");
    return promptResult;
  });
  const remove = vi.fn(async () => undefined);
  const retire = vi.fn(async () => undefined);
  const onMaterialized = vi.fn(() => order.push("catalog"));
  return {
    order,
    create,
    ensureAttached,
    prompt,
    remove,
    retire,
    onMaterialized,
    dependencies: {
      requestIds: new Map<string, string>(),
      sessions: { create, prompt, remove },
      cache: { ensureAttached, retire },
      onMaterialized,
    },
  };
}

function bootstrap(): SessionBootstrap {
  return {
    protocolVersion: PROTOCOL_VERSION,
    projectId: "project",
    threadId: "thread",
    timeline: {
      protocolVersion: PROTOCOL_VERSION,
      projectId: "project",
      threadId: "thread",
      cursor: 0,
      headId: null,
      nodes: [],
      queue: [],
      phase: "idle",
    },
    control: {
      protocolVersion: PROTOCOL_VERSION,
      revision: 0,
      projectId: "project",
      threadId: "thread",
      title: "新会话",
      updatedAt: 0,
      cwd: "/workspace",
      running: false,
      queueModes: { steering: "one-at-a-time", followUp: "one-at-a-time" },
      models: [],
      commands: [],
      thinkingLevel: "off",
      thinkingLevels: ["off"],
      readiness: { state: "ready" },
      hostRequests: [],
      extensionSet: { generation: "extensions-generation", diagnostics: [], reloadRequired: false },
      extensionHost: { statuses: {}, widgets: [] },
    },
  };
}
