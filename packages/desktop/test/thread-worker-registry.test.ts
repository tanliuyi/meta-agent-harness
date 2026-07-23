import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MetadataWorkerClient } from "../src/main/sidecar/metadata-worker-client.ts";
import type { NodeRuntimeManifest } from "../src/main/sidecar/node-runtime-locator.ts";
import {
  type ThreadWorkerClient,
  ThreadWorkerRegistry,
  type ThreadWorkerRegistryOptions,
} from "../src/main/sidecar/thread-worker-registry.ts";
import type { WorkerClientOptions } from "../src/main/sidecar/worker-client.ts";
import {
  type JsonValue,
  PROTOCOL_VERSION,
  type SessionBootstrap,
  type SessionCreateInput,
  type SessionPushPayload,
  type Thread,
} from "../src/shared/contracts.ts";
import {
  SIDECAR_PROTOCOL_VERSION,
  type SidecarCommand,
  type SidecarEventBody,
  type SidecarReady,
} from "../src/shared/sidecar-contracts.ts";

describe("ThreadWorkerRegistry", () => {
  let userDataDir: string;

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), "thread-worker-registry-"));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("single-flights concurrent opens for the same thread", async () => {
    const harness = createHarness(userDataDir);
    const registry = new ThreadWorkerRegistry(harness.options);

    const [first, second] = await Promise.all([
      registry.attach("project", "thread"),
      registry.attach("project", "thread"),
    ]);

    expect(first.threadId).toBe("thread");
    expect(second.threadId).toBe("thread");
    expect(harness.clients).toHaveLength(1);
    expect(harness.clients[0]?.requests.filter((type) => type === "bootstrap")).toHaveLength(2);
    registry.detach("project", "thread");
    registry.detach("project", "thread");
    await registry.dispose();
  });

  it("loads draft configuration through the metadata worker", async () => {
    const harness = createHarness(userDataDir);
    const registry = new ThreadWorkerRegistry(harness.options);

    await expect(registry.getDraftConfig("project")).resolves.toMatchObject({ readiness: { state: "missing-model" } });
    expect(harness.options.metadata.getDraftConfig).toHaveBeenCalledWith("project", "/workspace");
    expect(harness.clients).toHaveLength(0);
    await registry.dispose();
  });

  it("reserves capacity while a worker is still starting", async () => {
    const readyGate = deferred<void>();
    const harness = createHarness(userDataDir, { readyGate, maxLiveWorkers: 1 });
    const registry = new ThreadWorkerRegistry(harness.options);
    const firstAttach = registry.attach("project", "first");
    await waitFor(() => harness.clients.length === 1);

    await expect(registry.attach("project", "second")).rejects.toThrow("All 1 Desktop thread workers are busy");
    expect(harness.clients).toHaveLength(1);

    readyGate.resolve();
    await firstAttach;
    registry.detach("project", "first");
    await registry.dispose();
  });

  it("routes acknowledgements to a worker before thread registration completes", async () => {
    const readyGate = deferred<void>();
    const harness = createHarness(userDataDir, { readyGate });
    const registry = new ThreadWorkerRegistry(harness.options);
    const attachment = registry.attach("project", "thread");
    await waitFor(() => harness.clients.length === 1);
    const client = harness.clients[0];
    if (!client) throw new Error("Worker was not created");

    client.emit(sessionPush("thread"));
    expect(harness.push).toHaveBeenCalledWith(expect.objectContaining({ threadId: "thread" }), client.instanceId, 1);
    registry.acknowledge(client.instanceId, 1);

    expect(client.acknowledgements).toEqual([1]);
    readyGate.resolve();
    await attachment;
    registry.detach("project", "thread");
    await registry.dispose();
    registry.acknowledge(client.instanceId, 2);
    expect(client.acknowledgements).toEqual([1]);
  });

  it("drops events from a retired worker generation", async () => {
    const harness = createHarness(userDataDir);
    const registry = new ThreadWorkerRegistry(harness.options);
    await registry.attach("project", "thread");
    registry.detach("project", "thread");
    const retired = harness.clients[0];
    if (!retired) throw new Error("First worker was not created");
    retired.crash(new Error("forced crash"));
    registry.acknowledge(retired.instanceId, 99);
    expect(retired.acknowledgements).toEqual([]);

    await registry.attach("project", "thread");
    const current = harness.clients[1];
    if (!current) throw new Error("Replacement worker was not created");
    retired.emit(sessionPush("thread"));
    current.emit(sessionPush("thread"));

    expect(harness.push).toHaveBeenCalledTimes(1);
    expect(harness.push).toHaveBeenCalledWith(expect.objectContaining({ threadId: "thread" }), current.instanceId, 1);
    expect(harness.failed).toHaveBeenCalledTimes(1);
    registry.detach("project", "thread");
    await registry.dispose();
  });

  it("does not evict an attached worker and evicts it after detach", async () => {
    vi.useFakeTimers({ now: 0 });
    const harness = createHarness(userDataDir, { idleTtlMs: 1 });
    const registry = new ThreadWorkerRegistry(harness.options);
    await registry.attach("project", "thread");
    const client = harness.clients[0];
    if (!client) throw new Error("Worker was not created");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(client.shutdownCount).toBe(0);

    registry.detach("project", "thread");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(client.shutdownCount).toBe(1);
    await registry.dispose();
  });

  it("routes cold and live rename through their exclusive owners", async () => {
    const harness = createHarness(userDataDir);
    const registry = new ThreadWorkerRegistry(harness.options);

    await registry.rename("project", "cold", "Cold title");
    expect(harness.metadataRenameCold).toHaveBeenCalledWith("project", "/workspace", "cold", "Cold title");

    await registry.attach("project", "live");
    await registry.rename("project", "live", "Live title");
    expect(harness.clients[0]?.requests).toContain("rename");
    expect(harness.clients[0]?.requests).toContain("getSummary");
    expect(harness.metadataRenameCold).toHaveBeenCalledTimes(1);
    registry.detach("project", "live");
    await registry.dispose();
  });

  it("materializes one worker for duplicate create request IDs", async () => {
    const harness = createHarness(userDataDir);
    const registry = new ThreadWorkerRegistry(harness.options);
    const input: SessionCreateInput = {
      projectId: "project",
      createRequestId: "create-request",
      model: { provider: "provider", id: "model" },
      thinkingLevel: "off",
    };

    const [first, second] = await Promise.all([registry.create(input), registry.create(input)]);

    expect(first.threadId).toBe(second.threadId);
    expect(harness.clients).toHaveLength(1);
    await registry.dispose();
  });

  it("waits for pending creation before completing shutdown", async () => {
    const readyGate = deferred<void>();
    const harness = createHarness(userDataDir, { readyGate });
    const registry = new ThreadWorkerRegistry(harness.options);
    const creation = registry.create({
      projectId: "project",
      createRequestId: "create-during-shutdown",
      model: { provider: "provider", id: "model" },
      thinkingLevel: "off",
    });
    await waitFor(() => harness.clients.length === 1);
    let disposed = false;
    const disposal = registry.dispose().then(() => {
      disposed = true;
    });

    await Promise.resolve();
    expect(disposed).toBe(false);
    readyGate.resolve();
    await creation;
    await disposal;
    expect(harness.clients[0]?.shutdownCount).toBe(1);
  });

  it("rejects catalog and cold mutations after project draining starts", async () => {
    const harness = createHarness(userDataDir);
    const registry = new ThreadWorkerRegistry(harness.options);
    await registry.removeProject("project");

    await expect(registry.list("project")).rejects.toThrow("Project project is being removed");
    await expect(registry.rename("project", "thread", "title")).rejects.toThrow("Project project is being removed");
    await expect(registry.remove("project", "thread")).rejects.toThrow("Project project is being removed");
    expect(harness.metadataRenameCold).not.toHaveBeenCalled();
    await registry.dispose();
  });
});

interface Harness {
  options: ThreadWorkerRegistryOptions;
  clients: FakeWorkerClient[];
  push: ReturnType<typeof vi.fn>;
  failed: ReturnType<typeof vi.fn>;
  metadataRenameCold: ReturnType<typeof vi.fn>;
}

function createHarness(
  userDataDir: string,
  overrides?: { readyGate?: ReturnType<typeof deferred<void>>; idleTtlMs?: number; maxLiveWorkers?: number },
): Harness {
  const clients: FakeWorkerClient[] = [];
  const push = vi.fn<(payload: SessionPushPayload, workerInstanceId: string, sidecarSequence: number) => void>();
  const failed = vi.fn<(projectId: string, threadId: string, error: Error) => void>();
  const metadataRenameCold = vi.fn(async () => {});
  const metadata = {
    list: vi.fn(async () => []),
    getDraftConfig: vi.fn(async () => ({
      models: [],
      commands: [],
      model: null,
      thinkingLevel: "off",
      thinkingLevels: ["off"],
      readiness: { state: "missing-model" },
    })),
    resolve: vi.fn(async (_projectId: string, _cwd: string, threadId: string) => ({
      id: threadId,
      path: join(userDataDir, `${threadId}.jsonl`),
    })),
    upsert: vi.fn(async () => {}),
    renameCold: metadataRenameCold,
    removeCold: vi.fn(async () => {}),
    recoverCreationReservation: vi.fn(async () => ({ status: "orphan" as const })),
    invalidateProject: vi.fn(async () => {}),
  } as unknown as MetadataWorkerClient;
  const options: ThreadWorkerRegistryOptions = {
    manifest: manifest(),
    metadata,
    userDataDir,
    agentDir: join(userDataDir, "agent"),
    getCwd: () => "/workspace",
    push,
    failed,
    resync: vi.fn(),
    createWorkerClient: (clientOptions) => {
      const client = new FakeWorkerClient(clientOptions, overrides?.readyGate);
      clients.push(client);
      return client;
    },
    idleTtlMs: overrides?.idleTtlMs,
    maxLiveWorkers: overrides?.maxLiveWorkers,
  };
  return { options, clients, push, failed, metadataRenameCold };
}

class FakeWorkerClient implements ThreadWorkerClient {
  readonly instanceId: string;
  readonly requests: SidecarCommand["type"][] = [];
  readonly acknowledgements: number[] = [];
  shutdownCount = 0;
  private readonly options: WorkerClientOptions;
  private readonly bootstrap: SessionBootstrap;
  private readonly readyGate?: ReturnType<typeof deferred<void>>;

  constructor(options: WorkerClientOptions, readyGate?: ReturnType<typeof deferred<void>>) {
    this.options = options;
    this.readyGate = readyGate;
    this.instanceId = `worker-${fakeWorkerSequence++}`;
    if (options.binding.role !== "thread") throw new Error(`Unexpected fake worker role: ${options.binding.role}`);
    const threadId =
      options.binding.value.mode === "open" ? options.binding.value.threadId : options.binding.value.sessionId;
    this.bootstrap = bootstrap(threadId);
  }

  async ready(): Promise<SidecarReady> {
    await this.readyGate?.promise;
    return {
      kind: "ready",
      protocolVersion: SIDECAR_PROTOCOL_VERSION,
      workerInstanceId: this.instanceId,
      role: "thread",
      runtime: this.options.manifest.compatibility,
      result: this.bootstrap as unknown as JsonValue,
    };
  }

  async request<T>(command: SidecarCommand): Promise<T> {
    this.requests.push(command.type);
    if (command.type === "bootstrap") return this.bootstrap as unknown as T;
    if (command.type === "getSummary") return thread(this.bootstrap.threadId) as unknown as T;
    return null as T;
  }

  acknowledge(sequence: number): void {
    this.acknowledgements.push(sequence);
  }

  async shutdown(): Promise<void> {
    this.shutdownCount += 1;
  }

  emit(event: SidecarEventBody, sequence = 1): void {
    this.options.onEvent?.({
      kind: "event",
      protocolVersion: SIDECAR_PROTOCOL_VERSION,
      workerInstanceId: this.instanceId,
      sequence,
      creditCost: 1,
      event,
    });
  }

  crash(error: Error): void {
    this.options.onFailure?.(error);
  }
}

let fakeWorkerSequence = 1;

function bootstrap(threadId: string): SessionBootstrap {
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
      title: threadId,
      updatedAt: 1,
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

function thread(threadId: string): Thread {
  return {
    id: threadId,
    projectId: "project",
    title: threadId,
    createdAt: 1,
    updatedAt: 1,
    messageCount: 0,
    preview: "",
    archived: false,
    running: false,
  };
}

function sessionPush(threadId: string): SidecarEventBody {
  return {
    type: "session-push",
    payload: {
      type: "runtime-availability",
      projectId: "project",
      threadId,
      availability: { state: "ready", unknownOutcome: false },
    },
  };
}

function manifest(): NodeRuntimeManifest {
  return {
    nodePath: process.execPath,
    npmCliPath: process.execPath,
    piExecutable: process.execPath,
    entries: { thread: "", metadata: "" },
    compatibility: {
      nodeVersion: process.version,
      modulesAbi: process.versions.modules,
      napi: process.versions.napi ?? "unknown",
      platform: process.platform,
      arch: process.arch,
      osRelease: "test",
      libc: "test",
      toolchain: "test",
      piVersion: "test",
      runtimeCompatibilityId: "test",
    },
    integrity: {
      nodePath: "",
      npmCliPath: "",
      piExecutable: "",
      entries: { thread: "", metadata: "" },
      files: {},
    },
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value?: T): void } {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: (value) => resolvePromise(value as T) };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Condition was not reached");
}
