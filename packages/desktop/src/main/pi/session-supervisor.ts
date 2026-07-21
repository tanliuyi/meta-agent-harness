import { randomUUID } from "node:crypto";
import type {
  ClearedQueue,
  DraftSessionConfig,
  HostResponse,
  SessionAttachment,
  SessionBootstrap,
  SessionBranchInput,
  SessionBranchResult,
  SessionCommandResult,
  SessionControlState,
  SessionCreateInput,
  SessionEditInput,
  SessionPromptInput,
  SessionPush,
  SessionPushPayload,
  SessionReloadInput,
  Thread,
} from "../../shared/contracts.ts";
import type { ThreadWorkerRegistry } from "../sidecar/thread-worker-registry.ts";
import type { ProjectStore } from "../store/project-store.ts";

interface RendererSubscription {
  attachmentId: string;
  projectId: string;
  threadId: string;
  send(update: SessionPush): void;
  pendingEvents: number;
  pendingBytes: number;
  resyncing: boolean;
}

interface PendingRendererAttachment {
  requestId: symbol;
  projectId: string;
  threadId: string;
}

interface PendingDeliveryAck {
  workerInstanceId: string;
  sidecarSequence: number;
  ownerIds: Set<number>;
  ownerBytes: Map<number, number>;
  timer: ReturnType<typeof setTimeout>;
}

export interface SessionSupervisorOptions {
  log?(scope: string, text: string): void;
}

const MAX_ATTACHMENT_PENDING_EVENTS = 128;
const MAX_ATTACHMENT_PENDING_BYTES = 16 * 1024 * 1024;
const DELIVERY_ACK_TIMEOUT_MS = 5_000;

/** Electron-only facade for renderer attachments, ProjectStore overlays, and sidecar routing. */
export class SessionSupervisor {
  private readonly subscriptions = new Map<number, RendererSubscription>();
  private readonly pendingAttachments = new Map<number, PendingRendererAttachment>();
  private readonly pendingDeliveryAcks = new Map<string, PendingDeliveryAck>();
  private runtimeStatusSequence = 0;
  private readonly projects: ProjectStore;
  private readonly workers: ThreadWorkerRegistry;
  private readonly log?: SessionSupervisorOptions["log"];
  private disposed = false;

  constructor(projects: ProjectStore, workers: ThreadWorkerRegistry, options: SessionSupervisorOptions = {}) {
    this.projects = projects;
    this.workers = workers;
    this.log = options.log;
  }

  async list(projectId: string, includeArchived = false): Promise<Thread[]> {
    return (await this.workers.list(projectId))
      .map((thread) => ({ ...thread, archived: this.projects.isArchived(projectId, thread.id) }))
      .filter((thread) => includeArchived || !thread.archived);
  }

  getDraftConfig(projectId: string): Promise<DraftSessionConfig> {
    return this.workers.getDraftConfig(projectId);
  }

  /** 预热 thread worker，不建立 attachment，仅为后续 attach 跳过冷启动。 */
  prewarm(projectId: string, threadId: string): Promise<void> {
    return this.workers.prewarm(projectId, threadId);
  }

  create(input: SessionCreateInput): Promise<SessionBootstrap> {
    return this.workers.create(input);
  }

  async attach(
    ownerId: number,
    projectId: string,
    threadId: string,
    send: (update: SessionPush) => void,
  ): Promise<SessionAttachment> {
    const requestId = Symbol("session-attachment");
    this.pendingAttachments.set(ownerId, { requestId, projectId, threadId });
    try {
      const bootstrap = await this.workers.attach(projectId, threadId);
      const attachmentId = randomUUID();
      if (this.pendingAttachments.get(ownerId)?.requestId === requestId) {
        this.pendingAttachments.delete(ownerId);
        const previous = this.subscriptions.get(ownerId);
        if (previous) {
          this.releaseOwnerAcks(ownerId);
          this.workers.detach(previous.projectId, previous.threadId);
        }
        this.subscriptions.set(ownerId, {
          attachmentId,
          projectId,
          threadId,
          send,
          pendingEvents: 0,
          pendingBytes: 0,
          resyncing: false,
        });
      } else {
        this.workers.detach(projectId, threadId);
      }
      return { protocolVersion: bootstrap.protocolVersion, attachmentId, bootstrap };
    } catch (error) {
      if (this.pendingAttachments.get(ownerId)?.requestId === requestId) this.pendingAttachments.delete(ownerId);
      throw error;
    }
  }

  prompt(input: SessionPromptInput): Promise<SessionCommandResult> {
    return this.workers.prompt(input);
  }

  edit(input: SessionEditInput): Promise<SessionCommandResult> {
    return this.workers.edit(input);
  }

  reload(input: SessionReloadInput): Promise<SessionCommandResult> {
    return this.workers.reload(input);
  }

  branch(input: SessionBranchInput): Promise<SessionBranchResult> {
    return this.workers.branch(input);
  }

  cancel(projectId: string, threadId: string): Promise<void> {
    return this.workers.cancel(projectId, threadId);
  }

  clearQueue(projectId: string, threadId: string): Promise<ClearedQueue> {
    return this.workers.clearQueue(projectId, threadId);
  }

  compact(projectId: string, threadId: string): Promise<void> {
    return this.workers.compact(projectId, threadId);
  }

  setModel(projectId: string, threadId: string, provider: string, modelId: string): Promise<void> {
    return this.workers.setModel(projectId, threadId, provider, modelId);
  }

  setThinking(projectId: string, threadId: string, level: SessionControlState["thinkingLevel"]): Promise<void> {
    return this.workers.setThinking(projectId, threadId, level);
  }

  setEditorText(projectId: string, threadId: string, text: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return this.workers.setEditorText(projectId, threadId, text);
  }

  rename(projectId: string, threadId: string, title: string): Promise<void> {
    return this.workers.rename(projectId, threadId, title);
  }

  async archive(projectId: string, threadId: string, archived: boolean): Promise<void> {
    await this.projects.setArchived(projectId, threadId, archived);
  }

  async remove(projectId: string, threadId: string): Promise<void> {
    this.clearPendingAttachments(projectId, threadId);
    this.clearSessionSubscriptions(projectId, threadId);
    await this.workers.remove(projectId, threadId);
    await this.projects.removeWorkbench(projectId, threadId);
  }

  async removeProject(projectId: string): Promise<void> {
    for (const [ownerId, subscription] of this.subscriptions) {
      if (subscription.projectId === projectId) {
        this.subscriptions.delete(ownerId);
        this.workers.detach(subscription.projectId, subscription.threadId);
        this.releaseOwnerAcks(ownerId);
      }
    }
    await this.workers.removeProject(projectId);
    for (const [ownerId, pending] of this.pendingAttachments) {
      if (pending.projectId === projectId) this.pendingAttachments.delete(ownerId);
    }
  }

  respond(projectId: string, threadId: string, response: HostResponse): Promise<void> {
    return this.workers.respond(projectId, threadId, response);
  }

  detach(ownerId: number, attachmentId?: string): void {
    const current = this.subscriptions.get(ownerId);
    if (attachmentId !== undefined && current?.attachmentId !== attachmentId) return;
    this.pendingAttachments.delete(ownerId);
    if (current) {
      this.subscriptions.delete(ownerId);
      this.workers.detach(current.projectId, current.threadId);
    }
    this.releaseOwnerAcks(ownerId);
  }

  acknowledge(ownerId: number, attachmentId: string, workerInstanceId: string, sidecarSequence: number): void {
    if (this.subscriptions.get(ownerId)?.attachmentId !== attachmentId) return;
    const key = deliveryKey(workerInstanceId, sidecarSequence);
    const pending = this.pendingDeliveryAcks.get(key);
    if (!pending) return;
    const subscription = this.subscriptions.get(ownerId);
    if (!pending.ownerIds.delete(ownerId)) return;
    if (subscription) {
      subscription.pendingEvents = Math.max(0, subscription.pendingEvents - 1);
      subscription.pendingBytes = Math.max(0, subscription.pendingBytes - (pending.ownerBytes.get(ownerId) ?? 0));
    }
    pending.ownerBytes.delete(ownerId);
    if (pending.ownerIds.size === 0) {
      clearTimeout(pending.timer);
      this.pendingDeliveryAcks.delete(key);
      this.workers.acknowledge(workerInstanceId, sidecarSequence);
    }
  }

  workerFailed(projectId: string, threadId: string, error: Error): void {
    this.publishRuntimeUnavailable(projectId, threadId, error.message, true);
  }

  resyncRequired(projectId: string, threadId: string, reason: string): void {
    this.publishRuntimeRecovering(projectId, threadId, reason);
  }

  receive(update: SessionPushPayload, workerInstanceId: string, sidecarSequence: number): void {
    const ownerIds = new Set<number>();
    const ownerBytes = new Map<number, number>();
    for (const [ownerId, subscription] of this.subscriptions) {
      const active = subscription.projectId === update.projectId && subscription.threadId === update.threadId;
      if (!active) continue;
      if (subscription.resyncing) continue;
      ownerIds.add(ownerId);
      const deliveredUpdate =
        update.type === "control"
          ? {
              ...update,
              control: {
                ...update.control,
                hostRequests: update.control.hostRequests.map((request) => ({ ...request, workerInstanceId })),
              },
            }
          : update;
      const delivered: SessionPush = {
        ...deliveredUpdate,
        attachmentId: subscription.attachmentId,
        workerInstanceId,
        sidecarSequence,
      };
      const bytes = estimateDeliveryBytes(delivered);
      if (
        subscription.pendingEvents >= MAX_ATTACHMENT_PENDING_EVENTS ||
        subscription.pendingBytes + bytes > MAX_ATTACHMENT_PENDING_BYTES
      ) {
        ownerIds.delete(ownerId);
        this.markAttachmentResync(ownerId, subscription, "renderer-delivery-queue-overflow");
        continue;
      }
      try {
        subscription.send(delivered);
      } catch {
        ownerIds.delete(ownerId);
        this.markAttachmentResync(ownerId, subscription, "renderer-delivery-failed");
        continue;
      }
      subscription.pendingEvents += 1;
      subscription.pendingBytes += bytes;
      ownerBytes.set(ownerId, bytes);
    }
    if (ownerIds.size === 0) {
      this.workers.acknowledge(workerInstanceId, sidecarSequence);
      return;
    }
    this.pendingDeliveryAcks.set(deliveryKey(workerInstanceId, sidecarSequence), {
      workerInstanceId,
      sidecarSequence,
      ownerIds,
      ownerBytes,
      timer: setTimeout(
        () => this.handleDeliveryAckTimeout(workerInstanceId, sidecarSequence),
        DELIVERY_ACK_TIMEOUT_MS,
      ),
    });
  }

  dispose(): Promise<void> {
    this.disposed = true;
    this.subscriptions.clear();
    this.pendingAttachments.clear();
    for (const pending of this.pendingDeliveryAcks.values()) {
      clearTimeout(pending.timer);
      this.workers.acknowledge(pending.workerInstanceId, pending.sidecarSequence);
    }
    this.pendingDeliveryAcks.clear();
    return this.workers.dispose();
  }

  private publishRuntimeUnavailable(projectId: string, threadId: string, error: string, unknownOutcome: boolean): void {
    this.runtimeStatusSequence += 1;
    for (const subscription of this.subscriptions.values()) {
      if (subscription.projectId !== projectId || subscription.threadId !== threadId || subscription.resyncing)
        continue;
      this.sendControl(subscription, {
        type: "runtime-availability",
        projectId,
        threadId,
        availability: { state: "unavailable", error, unknownOutcome },
      });
    }
  }

  private publishRuntimeRecovering(projectId: string, threadId: string, reason: string): void {
    this.runtimeStatusSequence += 1;
    for (const subscription of this.subscriptions.values()) {
      if (subscription.projectId !== projectId || subscription.threadId !== threadId || subscription.resyncing)
        continue;
      this.sendControl(subscription, {
        type: "runtime-availability",
        projectId,
        threadId,
        availability: { state: "recovering", reason, unknownOutcome: false },
      });
    }
  }

  private clearSessionSubscriptions(projectId: string, threadId: string): void {
    for (const [ownerId, subscription] of this.subscriptions) {
      if (subscription.projectId === projectId && subscription.threadId === threadId) {
        this.subscriptions.delete(ownerId);
        this.workers.detach(subscription.projectId, subscription.threadId);
        this.releaseOwnerAcks(ownerId);
      }
    }
  }

  private releaseOwnerAcks(ownerId: number): void {
    for (const [key, pending] of this.pendingDeliveryAcks) {
      const subscription = this.subscriptions.get(ownerId);
      if (!pending.ownerIds.delete(ownerId)) continue;
      if (subscription) {
        subscription.pendingEvents = Math.max(0, subscription.pendingEvents - 1);
        subscription.pendingBytes = Math.max(0, subscription.pendingBytes - (pending.ownerBytes.get(ownerId) ?? 0));
      }
      pending.ownerBytes.delete(ownerId);
      if (pending.ownerIds.size === 0) {
        clearTimeout(pending.timer);
        this.pendingDeliveryAcks.delete(key);
        this.workers.acknowledge(pending.workerInstanceId, pending.sidecarSequence);
      }
    }
  }

  private handleDeliveryAckTimeout(workerInstanceId: string, sidecarSequence: number): void {
    const key = deliveryKey(workerInstanceId, sidecarSequence);
    const pending = this.pendingDeliveryAcks.get(key);
    if (!pending) return;
    this.log?.(
      "renderer",
      `Delivery ACK timeout: worker=${workerInstanceId}, sequence=${sidecarSequence}, owners=${pending.ownerIds.size}`,
    );
    for (const ownerId of [...pending.ownerIds]) {
      const subscription = this.subscriptions.get(ownerId);
      if (subscription) this.markAttachmentResync(ownerId, subscription, "renderer-delivery-ack-timeout");
      else this.releaseOwnerAcks(ownerId);
    }
  }

  private markAttachmentResync(ownerId: number, subscription: RendererSubscription, reason: string): void {
    if (subscription.resyncing) return;
    this.log?.(
      "renderer",
      `Attachment recovery: attachment=${subscription.attachmentId}, project=${subscription.projectId}, thread=${subscription.threadId}, reason=${reason}, pendingEvents=${subscription.pendingEvents}, pendingBytes=${subscription.pendingBytes}`,
    );
    subscription.resyncing = true;
    this.releaseOwnerAcks(ownerId);
    this.runtimeStatusSequence += 1;
    this.sendControl(subscription, {
      type: "runtime-availability",
      projectId: subscription.projectId,
      threadId: subscription.threadId,
      availability: {
        state: "recovering",
        reason,
        unknownOutcome: false,
      },
    });
  }

  private sendControl(subscription: RendererSubscription, payload: SessionPushPayload): void {
    try {
      subscription.send({
        ...payload,
        attachmentId: subscription.attachmentId,
        workerInstanceId: "desktop-main",
        sidecarSequence: this.runtimeStatusSequence,
      });
    } catch {
      // The renderer is already unavailable; its attachment cleanup will release state.
    }
  }

  private clearPendingAttachments(projectId: string, threadId: string): void {
    for (const [ownerId, pending] of this.pendingAttachments) {
      if (pending.projectId === projectId && pending.threadId === threadId) this.pendingAttachments.delete(ownerId);
    }
  }
}

function deliveryKey(workerInstanceId: string, sidecarSequence: number): string {
  return `${workerInstanceId}\0${sidecarSequence}`;
}

function estimateDeliveryBytes(update: SessionPush | SessionPushPayload): number {
  return JSON.stringify(update).length * 2;
}
