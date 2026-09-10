import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { DesktopExtensionSourcePolicy } from "../src/main/extensions/desktop-extension-source-policy.ts";
import { MainAgentConfigService } from "../src/main/settings/main-agent-config-service.ts";
import type { MetadataWorkerClient } from "../src/main/sidecar/metadata-worker-client.ts";
import type { SidecarRuntimeManifest } from "../src/main/sidecar/sidecar-runtime-manifest.ts";
import { type ThreadWorkerClient, ThreadWorkerRegistry } from "../src/main/sidecar/thread-worker-registry.ts";
import type { WorkerClientOptions } from "../src/main/sidecar/worker-client.ts";
import { type JsonValue, PROTOCOL_VERSION, type SessionBootstrap, type Thread } from "../src/shared/contracts.ts";
import type { ResolvedExtensionSet } from "../src/shared/desktop-extension-contracts.ts";
import {
  SIDECAR_PROTOCOL_VERSION,
  type SidecarCommand,
  type SidecarEventBody,
} from "../src/shared/sidecar-contracts.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function bootstrap(generation: string, cwd: string): SessionBootstrap {
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
      title: "thread",
      updatedAt: 1,
      cwd,
      running: false,
      queueModes: { steering: "one-at-a-time", followUp: "one-at-a-time" },
      models: [],
      commands: [],
      thinkingLevel: "off",
      thinkingLevels: ["off"],
      readiness: { state: "ready" },
      hostRequests: [],
      extensionSet: { generation, diagnostics: [], reloadRequired: false },
      extensionHost: { statuses: {}, widgets: [] },
    },
  };
}
function summary(running: boolean): Thread {
  return {
    id: "thread",
    projectId: "project",
    title: "thread",
    createdAt: 1,
    updatedAt: 2,
    messageCount: 1,
    preview: "test",
    archived: false,
    running,
  };
}

describe("Desktop deferred plugin reload", () => {
  let directory: string;
  let registry: ThreadWorkerRegistry;
  let generation: string;
  let metadataGate: ReturnType<typeof deferred> | undefined;
  let promptGate: ReturnType<typeof deferred> | undefined;
  let failReload: boolean;
  let rejectMetadata: boolean;
  const clients: Array<{
    options: WorkerClientOptions;
    shutdown: ReturnType<typeof vi.fn>;
    requests: SidecarCommand[];
  }> = [];
  const revoked: string[] = [];
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "desktop-reload-"));
    await writeFile(
      join(directory, "thread.jsonl"),
      `${JSON.stringify({ type: "session", id: "thread", cwd: directory })}\n`,
    );
    clients.length = 0;
    revoked.length = 0;
    generation = "old";
    metadataGate = undefined;
    promptGate = undefined;
    failReload = false;
    rejectMetadata = false;
    const resolve = async (): Promise<ResolvedExtensionSet> => ({
      generation,
      projectId: "project",
      entries: [],
      diagnostics: [],
      resolvedAt: 0,
    });
    const metadata = {
      list: async () => [],
      resolve: async () => ({ id: "thread", path: join(directory, "thread.jsonl") }),
      upsert: async () => {
        await metadataGate?.promise;
        if (rejectMetadata) throw new Error("disk error");
      },
    } as unknown as MetadataWorkerClient;
    registry = new ThreadWorkerRegistry({
      manifest: { compatibility: {} } as SidecarRuntimeManifest,
      metadata,
      userDataDir: directory,
      agentDir: directory,
      extensionSourcePolicy: {
        resolve,
        resolveWithAll: async () => ({ set: await resolve(), allEntries: [] }),
      } as unknown as DesktopExtensionSourcePolicy,
      mainAgents: new MainAgentConfigService(directory),
      getCwd: () => directory,
      resolveSessionCwd: async (_id, cwd) => cwd,
      getWorkspaceKey: async () => directory,
      push: () => {},
      failed: () => {},
      resync: () => {},
      registerBrowserSession: () => `cap-${clients.length}`,
      revokeBrowserSession: (_identity, token) => revoked.push(token),
      createWorkerClient: (options) => {
        if (options.binding.role !== "thread") throw new Error("wrong binding");
        const current = options.binding.value;
        const state = bootstrap(current.extensionSet.generation, directory);
        const instanceId = `worker-${clients.length}`;
        const requests: SidecarCommand[] = [];
        const shutdown = vi.fn(async () => {});
        clients.push({ options, shutdown, requests });
        const client: ThreadWorkerClient = {
          instanceId,
          ready: async () => ({
            kind: "ready",
            protocolVersion: SIDECAR_PROTOCOL_VERSION,
            role: "thread",
            workerInstanceId: instanceId,
            runtime: options.manifest.compatibility,
            result: state as unknown as JsonValue,
          }),
          acknowledge: () => {},
          shutdown,
          async request<T>(command: SidecarCommand): Promise<T> {
            requests.push(command);
            if (command.type === "bootstrap") return state as T;
            if (command.type === "getPluginRuntime")
              return {
                generation: current.extensionSet.generation,
                captured: [{ pluginId: "design.tools", methods: [{ name: "inspect" }] }],
              } as T;
            if (command.type === "prompt") await promptGate?.promise;
            if (command.type === "reloadResources" && failReload)
              return { accepted: false, queued: false, error: "plugin initialization failed" } as T;
            return { accepted: true, queued: false } as T;
          },
        };
        return client;
      },
    });
    await registry.attach("project", "thread");
  });
  afterEach(async () => {
    promptGate?.resolve();
    metadataGate?.resolve();
    await registry.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  function emit(body: SidecarEventBody) {
    clients[0].options.onEvent?.({
      kind: "event",
      protocolVersion: SIDECAR_PROTOCOL_VERSION,
      workerInstanceId: "worker-0",
      sequence: 1,
      creditCost: 1,
      event: body,
    });
  }

  test("returns scheduled during run_code and waits for both settled metadata and command completion before replacement and continuation", async () => {
    promptGate = deferred();
    const prompt = registry.prompt({
      projectId: "project",
      threadId: "thread",
      requestId: "initial",
      text: "Develop design plugin",
      images: [],
    });
    await vi.waitFor(() => expect(clients[0].requests.some((command) => command.type === "prompt")).toBe(true));
    emit({ type: "summary-changed", summary: summary(true) });
    generation = "new";
    const result = registry.schedulePluginReload(
      "project",
      "thread",
      "reload-design",
      "Verify design.tools with plugin_runtime",
    );
    expect(result.state).toBe("scheduled");
    expect(clients[0].shutdown).not.toHaveBeenCalled();
    metadataGate = deferred();
    emit({ type: "summary-changed", summary: summary(false) });
    promptGate.resolve();
    await prompt;
    expect(registry.getPluginReloadStatus("project", "thread", "reload-design").state).toBe("scheduled");
    expect(clients[0].shutdown).not.toHaveBeenCalled();
    metadataGate.resolve();
    await vi.waitFor(() =>
      expect(registry.getPluginReloadStatus("project", "thread", "reload-design")).toMatchObject({
        state: "applied",
        workerInstanceId: "worker-1",
        generation: "new",
        continuationAccepted: true,
      }),
    );
    expect(revoked).toContain("cap-0");
    expect(clients[0].shutdown).toHaveBeenCalledTimes(1);
    expect(clients[1].requests).toContainEqual(
      expect.objectContaining({
        type: "prompt",
        input: expect.objectContaining({ text: expect.stringContaining("Verify design.tools") }),
      }),
    );
    expect(await registry.getPluginRuntime("project", "thread", "design.tools")).toMatchObject({
      workerInstanceId: "worker-1",
      runtime: { generation: "new", captured: [{ pluginId: "design.tools" }] },
      state: { reloadRequired: false },
    });
    expect(registry.schedulePluginReload("project", "thread", "reload-design").state).toBe("applied");
  });

  test("reloads unchanged generations through existing resource reload and records rejected reload as failed", async () => {
    failReload = true;
    expect(registry.schedulePluginReload("project", "thread", "failed").state).toMatch(/scheduled|applying/);
    await vi.waitFor(() =>
      expect(registry.getPluginReloadStatus("project", "thread", "failed")).toMatchObject({
        state: "failed",
        error: "plugin initialization failed",
      }),
    );
    expect(clients).toHaveLength(1);
    expect(clients[0].requests.some((command) => command.type === "reloadResources")).toBe(true);
  });

  test("does not reload when settled metadata persistence fails and rejects cross-thread status lookups", async () => {
    emit({ type: "summary-changed", summary: summary(true) });
    registry.schedulePluginReload("project", "thread", "disk-failure");
    metadataGate = deferred();
    rejectMetadata = true;
    emit({ type: "summary-changed", summary: summary(false) });
    metadataGate.resolve();
    await vi.waitFor(() =>
      expect(registry.getPluginReloadStatus("project", "thread", "disk-failure")).toMatchObject({
        state: "failed",
        error: "Metadata persistence failed before reload",
      }),
    );
    expect(clients[0].shutdown).not.toHaveBeenCalled();
    expect(() => registry.getPluginReloadStatus("project", "other", "disk-failure")).toThrow("Unknown");
  });
});
