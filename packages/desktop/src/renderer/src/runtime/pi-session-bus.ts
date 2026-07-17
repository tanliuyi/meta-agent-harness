import type { SessionBootstrap, SessionControlState, SessionPushPayload } from "../../../shared/contracts.ts";
import { detachedSnapshot, PiThreadStore } from "./pi-thread-store.ts";

type ControlListener = (control: SessionControlState) => void;
type ResyncListener = (bootstrap: SessionBootstrap) => void;

/** renderer 内单一 active attachment 的 Pi timeline 分发器。 */
export class PiSessionBus {
  readonly store = new PiThreadStore();
  private activeKey = "";
  private readonly controlListeners = new Set<ControlListener>();
  private readonly resyncListeners = new Set<ResyncListener>();
  private pendingResync?: Promise<SessionBootstrap>;

  async attach(projectId: string, threadId: string): Promise<SessionBootstrap> {
    return window.desktop.sessions.attach(projectId, threadId, (update) => this.receive(update));
  }

  commit(bootstrap: SessionBootstrap): void {
    this.activeKey = sessionKey(bootstrap.projectId, bootstrap.threadId);
    this.store.replace(bootstrap.timeline);
    for (const listener of this.controlListeners) listener(bootstrap.control);
  }

  detach(): void {
    window.desktop.sessions.detach();
    this.activeKey = "";
    this.pendingResync = undefined;
    this.store.replace(detachedSnapshot());
  }

  onControl(listener: ControlListener): () => void {
    this.controlListeners.add(listener);
    return () => this.controlListeners.delete(listener);
  }

  onResync(listener: ResyncListener): () => void {
    this.resyncListeners.add(listener);
    return () => this.resyncListeners.delete(listener);
  }

  resync(projectId: string, threadId: string): Promise<SessionBootstrap> {
    const key = sessionKey(projectId, threadId);
    if (this.pendingResync && this.activeKey === key) return this.pendingResync;
    const promise = this.attach(projectId, threadId).then((bootstrap) => {
      this.commit(bootstrap);
      for (const listener of this.resyncListeners) listener(bootstrap);
      return bootstrap;
    });
    this.pendingResync = promise;
    const clearPending = () => {
      if (this.pendingResync === promise) this.pendingResync = undefined;
    };
    void promise.then(clearPending, clearPending);
    return promise;
  }

  private receive(update: SessionPushPayload): void {
    if (update.type === "control") {
      for (const listener of this.controlListeners) listener(update.control);
      return;
    }
    if (sessionKey(update.projectId, update.threadId) !== this.activeKey) return;
    try {
      this.store.apply(update.batch);
    } catch (error) {
      const [projectId, threadId] = splitSessionKey(this.activeKey);
      if (!projectId || !threadId) throw error;
      void this.resync(projectId, threadId).catch((resyncError: unknown) =>
        console.error("Pi timeline resync 失败", resyncError),
      );
    }
  }
}

export const piSessionBus = new PiSessionBus();

function sessionKey(projectId: string, threadId: string): string {
  return `${projectId}\u0000${threadId}`;
}

function splitSessionKey(key: string): [string, string] {
  const separator = key.indexOf("\u0000");
  return separator === -1 ? ["", ""] : [key.slice(0, separator), key.slice(separator + 1)];
}
