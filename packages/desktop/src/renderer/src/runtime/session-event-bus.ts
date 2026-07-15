import type {
  SessionBootstrap,
  SessionControlState,
  SessionEventBatch,
  SessionPushPayload,
} from "../../../shared/contracts.ts";
import { applyToolUpdate, clearToolUpdates } from "./tool-status-store.ts";

type EventListener = (batch: SessionEventBatch) => void;
type ControlListener = (control: SessionControlState) => void;
type ResyncListener = (bootstrap: SessionBootstrap) => void;

/** renderer 内单一 active session 的 Electron transport 分发器。 */
export class SessionEventBus {
  private activeKey = "";
  private eventListener?: EventListener;
  private readonly controlListeners = new Set<ControlListener>();
  private readonly resyncListeners = new Set<ResyncListener>();
  private pendingResync?: Promise<SessionBootstrap>;

  async attach(projectId: string, threadId: string): Promise<SessionBootstrap> {
    const key = sessionKey(projectId, threadId);
    clearToolUpdates();
    const bootstrap = await window.desktop.sessions.attach(projectId, threadId, (update) => this.receive(update));
    this.activeKey = key;
    for (const listener of this.controlListeners) listener(bootstrap.control);
    return bootstrap;
  }

  detach(): void {
    window.desktop.sessions.detach();
    this.activeKey = "";
    this.eventListener = undefined;
    this.pendingResync = undefined;
    clearToolUpdates();
  }

  onControl(listener: ControlListener): () => void {
    this.controlListeners.add(listener);
    return () => this.controlListeners.delete(listener);
  }

  onResync(listener: ResyncListener): () => void {
    this.resyncListeners.add(listener);
    return () => this.resyncListeners.delete(listener);
  }

  subscribeEvents(listener: EventListener): () => void {
    this.eventListener = listener;
    return () => {
      if (this.eventListener === listener) this.eventListener = undefined;
    };
  }

  resync(projectId: string, threadId: string): Promise<SessionBootstrap> {
    const key = sessionKey(projectId, threadId);
    if (this.pendingResync && this.activeKey === key) return this.pendingResync;
    const promise = this.attach(projectId, threadId).then((bootstrap) => {
      for (const listener of this.resyncListeners) listener(bootstrap);
      return bootstrap;
    });
    this.pendingResync = promise;
    void promise.then(
      () => {
        if (this.pendingResync === promise) this.pendingResync = undefined;
      },
      () => {
        if (this.pendingResync === promise) this.pendingResync = undefined;
      },
    );
    return promise;
  }

  private receive(update: SessionPushPayload): void {
    if (update.type === "control") {
      for (const listener of this.controlListeners) listener(update.control);
      return;
    }
    if (update.type === "tool") {
      applyToolUpdate(update.update);
      return;
    }
    if (sessionKey(update.projectId, update.threadId) !== this.activeKey) return;
    this.eventListener?.(update.batch);
  }
}

export const sessionEventBus = new SessionEventBus();

function sessionKey(projectId: string, threadId: string): string {
  return `${projectId}:${threadId}`;
}
