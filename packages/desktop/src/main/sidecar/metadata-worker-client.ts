import { randomUUID } from "node:crypto";
import type { DraftSessionConfig, Thread } from "../../shared/contracts.ts";
import type {
  ColdOperationLease,
  CreationReservation,
  MetadataSidecarCommand,
} from "../../shared/sidecar-contracts.ts";
import type { NodeRuntimeManifest } from "./node-runtime-locator.ts";
import { SidecarWorkerClient } from "./worker-client.ts";

export class MetadataWorkerClient {
  private readonly manifest: NodeRuntimeManifest;
  private readonly agentDir: string;
  private readonly userDataDir: string;
  private readonly log?: (scope: string, text: string) => void;
  private client?: SidecarWorkerClient;
  private disposed = false;

  constructor(
    manifest: NodeRuntimeManifest,
    agentDir: string,
    userDataDir: string,
    log?: (scope: string, text: string) => void,
  ) {
    this.manifest = manifest;
    this.agentDir = agentDir;
    this.userDataDir = userDataDir;
    this.log = log;
    this.client = undefined;
  }

  async list(projectId: string, cwd: string): Promise<Thread[]> {
    return this.safeRequest<Thread[]>({ type: "listSessions", projectId, cwd });
  }

  getDraftConfig(projectId: string, cwd: string): Promise<DraftSessionConfig> {
    return this.safeRequest({ type: "getDraftConfig", projectId, cwd });
  }

  get pid(): number | undefined {
    return this.client?.pid;
  }

  get workerInstanceId(): string | undefined {
    return this.client?.instanceId;
  }

  async resolve(projectId: string, cwd: string, threadId: string): Promise<{ id: string; path: string }> {
    return this.safeRequest<{ id: string; path: string }>({ type: "resolveSession", projectId, cwd, threadId });
  }

  async upsert(projectId: string, cwd: string, sessionFile: string, thread: Thread): Promise<void> {
    await this.safeRequest({ type: "upsertSession", projectId, cwd, sessionFile, thread });
  }

  async renameCold(projectId: string, cwd: string, threadId: string, title: string) {
    const lease = createColdLease(projectId, threadId, "rename");
    await this.request({ type: "renameColdSession", projectId, cwd, threadId, title, lease }, 30_000);
  }

  async removeCold(projectId: string, cwd: string, threadId: string) {
    const lease = createColdLease(projectId, threadId, "remove");
    await this.request({ type: "removeColdSession", projectId, cwd, threadId, lease }, 30_000);
  }

  recoverCreationReservation(reservation: CreationReservation): Promise<{ status: "active" | "committed" | "orphan" }> {
    return this.safeRequest({ type: "recoverCreationReservation", reservation });
  }

  async invalidateProject(projectId: string): Promise<void> {
    await this.safeRequest({ type: "invalidateProject", projectId });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const current = this.client;
    this.client = undefined;
    await current?.shutdown();
  }

  private async safeRequest<T>(command: MetadataSidecarCommand): Promise<T> {
    try {
      return await this.request<T>(command, 30_000);
    } catch (firstError) {
      const previous = this.client;
      if (previous?.available) throw firstError;
      this.client = undefined;
      await previous?.shutdown().catch(() => undefined);
      await delay(100);
      try {
        return await this.request<T>(command, 30_000);
      } catch {
        throw firstError;
      }
    }
  }

  private request<T>(command: MetadataSidecarCommand, timeoutMs: number): Promise<T> {
    if (this.disposed) return Promise.reject(new Error("Metadata sidecar client is disposed"));
    const client = this.client?.available ? this.client : this.createClient();
    this.client = client;
    return client.request<T>(command, timeoutMs);
  }

  private createClient(): SidecarWorkerClient {
    if (this.disposed) throw new Error("Metadata sidecar client is disposed");
    let client: SidecarWorkerClient;
    client = new SidecarWorkerClient({
      manifest: this.manifest,
      binding: { role: "metadata", value: { agentDir: this.agentDir, userDataDir: this.userDataDir } },
      onStderr: (text) => this.log?.("metadata", text),
      onFailure: () => {
        if (this.client === client) this.client = undefined;
      },
    });
    return client;
  }
}

function createColdLease(
  projectId: string,
  threadId: string,
  operation: ColdOperationLease["operation"],
): ColdOperationLease {
  return { projectId, threadId, operation, nonce: randomUUID(), expiresAt: Date.now() + 30_000 };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
