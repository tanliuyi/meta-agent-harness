import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionSupervisor } from "../src/main/pi/session-supervisor.ts";
import type { ThreadWorkerRegistry } from "../src/main/sidecar/thread-worker-registry.ts";
import type { ProjectStore } from "../src/main/store/project-store.ts";
import type {
  DraftSessionConfig,
  SessionBootstrap,
  SessionCreateInput,
  SessionPush,
  Thread,
} from "../src/shared/contracts.ts";
import { PROTOCOL_VERSION } from "../src/shared/contracts.ts";

interface RegistryMock {
  value: ThreadWorkerRegistry;
  list: ReturnType<typeof vi.fn>;
  getDraftConfig: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  attach: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  acknowledge: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

describe("SessionSupervisor", () => {
  let workers: RegistryMock;

  beforeEach(() => {
    workers = registryMock();
  });

  it("overlays ProjectStore archive state on sidecar catalog", async () => {
    workers.list.mockResolvedValue([thread("visible"), thread("archived")]);
    const supervisor = new SessionSupervisor(projectStore({ archived: true }), workers.value);

    await expect(supervisor.list("project")).resolves.toEqual([thread("visible")]);
    await expect(supervisor.list("project", true)).resolves.toEqual([
      thread("visible"),
      { ...thread("archived"), archived: true },
    ]);
    await supervisor.dispose();
  });

  it("forwards draft config and explicit create input to sidecars", async () => {
    const config = draftConfig();
    const input: SessionCreateInput = {
      projectId: "project",
      createRequestId: "create-request",
      model: { provider: "openai", id: "gpt" },
      thinkingLevel: "high",
    };
    workers.getDraftConfig.mockResolvedValue(config);
    workers.create.mockResolvedValue(bootstrap());
    const supervisor = new SessionSupervisor(projectStore(), workers.value);

    await expect(supervisor.getDraftConfig("project")).resolves.toEqual(config);
    await expect(supervisor.create(input)).resolves.toEqual(bootstrap());
    expect(workers.getDraftConfig).toHaveBeenCalledWith("project");
    expect(workers.create).toHaveBeenCalledWith(input);
    await supervisor.dispose();
  });

  it("atomically replaces attachments and ignores stale detach", async () => {
    const supervisor = new SessionSupervisor(projectStore(), workers.value);
    const firstPush = vi.fn<(update: SessionPush) => void>();
    const secondPush = vi.fn<(update: SessionPush) => void>();
    const first = await supervisor.attach(1, "project", "thread", firstPush);
    const second = await supervisor.attach(1, "project", "thread", secondPush);

    supervisor.detach(1, first.attachmentId);
    supervisor.receive(controlPush("thread"), "worker", 1);

    expect(firstPush).not.toHaveBeenCalled();
    expect(secondPush).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: second.attachmentId,
        workerInstanceId: "worker",
        sidecarSequence: 1,
      }),
    );
    await supervisor.dispose();
  });

  it("routes all thread-owned pushes only to the active attachment", async () => {
    const supervisor = new SessionSupervisor(projectStore(), workers.value);
    const push = vi.fn<(update: SessionPush) => void>();
    await supervisor.attach(1, "project", "active", push);

    supervisor.receive(controlPush("background"), "background-worker", 1);
    supervisor.receive(timelinePush("background"), "background-worker", 2);

    expect(push).not.toHaveBeenCalled();
    expect(workers.acknowledge).toHaveBeenCalledWith("background-worker", 1);
    expect(workers.acknowledge).toHaveBeenCalledWith("background-worker", 2);
    await supervisor.dispose();
  });

  it("returns worker event credit only after the matching renderer attachment acknowledges", async () => {
    const supervisor = new SessionSupervisor(projectStore(), workers.value);
    const push = vi.fn<(update: SessionPush) => void>();
    const attachment = await supervisor.attach(7, "project", "thread", push);

    supervisor.receive(timelinePush("thread"), "thread-worker", 9);
    expect(workers.acknowledge).not.toHaveBeenCalled();

    supervisor.acknowledge(7, "stale-attachment", "thread-worker", 9);
    expect(workers.acknowledge).not.toHaveBeenCalled();

    supervisor.acknowledge(7, attachment.attachmentId, "thread-worker", 9);
    expect(workers.acknowledge).toHaveBeenCalledWith("thread-worker", 9);
    await supervisor.dispose();
  });

  it("bounds an attachment delivery queue and requests a fresh bootstrap on overflow", async () => {
    const supervisor = new SessionSupervisor(projectStore(), workers.value);
    const push = vi.fn<(update: SessionPush) => void>();
    await supervisor.attach(1, "project", "thread", push);

    for (let sequence = 1; sequence <= 129; sequence += 1) {
      supervisor.receive(timelinePush("thread"), "thread-worker", sequence);
    }

    expect(push).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "runtime-availability",
        availability: expect.objectContaining({ state: "recovering" }),
      }),
    );
    expect(workers.acknowledge).toHaveBeenCalledWith("thread-worker", 129);
    await supervisor.dispose();
  });

  it("requests a fresh bootstrap when an attachment stops acknowledging", async () => {
    vi.useFakeTimers();
    try {
      const supervisor = new SessionSupervisor(projectStore(), workers.value);
      const push = vi.fn<(update: SessionPush) => void>();
      await supervisor.attach(1, "project", "thread", push);

      supervisor.receive(timelinePush("thread"), "thread-worker", 1);
      vi.advanceTimersByTime(5_001);

      expect(push).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: "runtime-availability",
          availability: expect.objectContaining({ state: "recovering" }),
        }),
      );
      expect(workers.acknowledge).toHaveBeenCalledWith("thread-worker", 1);
      await supervisor.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the current attachment when a stale attach resolves after a newer failure", async () => {
    const stale = deferred<SessionBootstrap>();
    workers.attach
      .mockResolvedValueOnce(bootstrap("current"))
      .mockImplementationOnce(() => stale.promise)
      .mockRejectedValueOnce(new Error("latest failed"));
    const supervisor = new SessionSupervisor(projectStore(), workers.value);
    const currentPush = vi.fn<(update: SessionPush) => void>();
    const stalePush = vi.fn<(update: SessionPush) => void>();
    const failedPush = vi.fn<(update: SessionPush) => void>();
    const current = await supervisor.attach(1, "project", "current", currentPush);
    const staleAttach = supervisor.attach(1, "project", "stale", stalePush);
    const failedAttach = supervisor.attach(1, "project", "failed", failedPush);

    await expect(failedAttach).rejects.toThrow("latest failed");
    stale.resolve(bootstrap("stale"));
    const staleResult = await staleAttach;
    supervisor.detach(1, staleResult.attachmentId);
    supervisor.receive(controlPush("current"), "current-worker", 1);

    expect(currentPush).toHaveBeenCalledWith(expect.objectContaining({ attachmentId: current.attachmentId }));
    expect(stalePush).not.toHaveBeenCalled();
    expect(failedPush).not.toHaveBeenCalled();
    await supervisor.dispose();
  });
});

function registryMock(): RegistryMock {
  const list = vi.fn(async () => [thread()]);
  const getDraftConfig = vi.fn(async () => draftConfig());
  const create = vi.fn(async () => bootstrap());
  const attach = vi.fn(async (_projectId: string, threadId: string) => bootstrap(threadId));
  const detach = vi.fn();
  const acknowledge = vi.fn();
  const dispose = vi.fn(async () => {});
  return {
    list,
    getDraftConfig,
    create,
    attach,
    detach,
    acknowledge,
    dispose,
    value: {
      list,
      getDraftConfig,
      create,
      attach,
      detach,
      acknowledge,
      dispose,
    } as unknown as ThreadWorkerRegistry,
  };
}

function projectStore(options?: { archived?: boolean }): ProjectStore {
  return {
    isArchived: (_projectId: string, threadId: string) => Boolean(options?.archived && threadId === "archived"),
  } as unknown as ProjectStore;
}

function thread(id = "thread"): Thread {
  return {
    id,
    projectId: "project",
    title: "question",
    createdAt: 1,
    updatedAt: 2,
    messageCount: 1,
    preview: "question",
    archived: false,
    running: false,
  };
}

function bootstrap(threadId = "thread"): SessionBootstrap {
  return {
    protocolVersion: PROTOCOL_VERSION,
    projectId: "project",
    threadId,
    timeline: {
      protocolVersion: PROTOCOL_VERSION,
      projectId: "project",
      threadId,
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
      threadId,
      title: "question",
      updatedAt: 2,
      cwd: "/workspace",
      running: false,
      queueModes: { steering: "one-at-a-time", followUp: "one-at-a-time" },
      models: [],
      commands: [],
      thinkingLevel: "off",
      thinkingLevels: ["off"],
      readiness: { state: "ready" },
      hostRequests: [],
      extensionUi: { statuses: {}, workingVisible: true, editorRevision: 0, toolsExpanded: false, widgets: [] },
    },
  };
}

function controlPush(threadId: string) {
  return { type: "control" as const, projectId: "project", threadId, control: bootstrap(threadId).control };
}

function timelinePush(threadId: string) {
  return {
    type: "timeline" as const,
    projectId: "project",
    threadId,
    batch: {
      protocolVersion: PROTOCOL_VERSION,
      projectId: "project",
      threadId,
      fromSequence: 1,
      toSequence: 1,
      events: [
        {
          protocolVersion: PROTOCOL_VERSION,
          projectId: "project",
          threadId,
          sequence: 1,
          event: { type: "queue-replaced" as const, items: [] },
        },
      ],
    },
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: (value) => resolvePromise?.(value) };
}

function draftConfig(): DraftSessionConfig {
  return {
    models: [],
    commands: [],
    model: null,
    thinkingLevel: "off",
    thinkingLevels: ["off"],
    readiness: { state: "missing-model" },
  };
}
