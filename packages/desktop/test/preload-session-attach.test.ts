import { describe, expect, it, vi } from "vitest";
import { CHANNELS } from "../src/shared/channels.ts";
import type { SessionAttachment, SessionBootstrap, SessionPush, SessionPushPayload } from "../src/shared/contracts.ts";
import { PROTOCOL_VERSION } from "../src/shared/contracts.ts";
import type { DesktopApi } from "../src/shared/desktop-api.ts";
import "../src/preload/index.ts";

const electron = vi.hoisted(() => ({
  exposed: undefined as DesktopApi | undefined,
  listeners: new Map<string, (event: unknown, update: SessionPush) => void>(),
  invoke: vi.fn(),
  send: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: DesktopApi) => {
      electron.exposed = api;
    },
  },
  ipcRenderer: {
    invoke: electron.invoke,
    send: electron.send,
    on: (channel: string, listener: (event: unknown, update: SessionPush) => void) => {
      electron.listeners.set(channel, listener);
    },
    removeListener: vi.fn(),
  },
}));

describe("preload session atomic attach", () => {
  it("hydrate 前按 attachment token 缓存 push，并保护新 attachment 不被 stale detach 清理", async () => {
    const api = electron.exposed;
    if (!api) throw new Error("DesktopApi 未暴露");
    electron.invoke.mockReset();
    electron.send.mockReset();
    const first = deferred<SessionAttachment>();
    electron.invoke.mockReturnValueOnce(first.promise);
    const received: SessionPushPayload[] = [];
    const attaching = api.sessions.attach("project", "thread", (update) => received.push(update));

    push(controlPush("attachment-1", 1));
    first.resolve(attachment("attachment-1", 1));
    await attaching;
    push(controlPush("attachment-1", 2));
    expect(received).toEqual([]);

    api.sessions.flush();
    expect(received.map((update) => (update.type === "control" ? update.control.revision : -1))).toEqual([1, 2]);

    const stale = deferred<SessionAttachment>();
    const current = deferred<SessionAttachment>();
    electron.invoke.mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise);
    const staleAttach = api.sessions.attach("project", "stale", () => {});
    const currentReceived: SessionPushPayload[] = [];
    const currentAttach = api.sessions.attach("project", "current", (update) => currentReceived.push(update));
    current.resolve(attachment("attachment-current", 3, "current"));
    await currentAttach;
    stale.resolve(attachment("attachment-stale", 2, "stale"));
    await expect(staleAttach).rejects.toMatchObject({ name: "AbortError" });

    push(controlPush("attachment-current", 4, "current"));
    api.sessions.flush();
    expect(currentReceived).toHaveLength(1);
    expect(electron.send).toHaveBeenCalledWith(CHANNELS.sessionsDetach, "attachment-stale");

    const superseded = deferred<SessionAttachment>();
    const failed = deferred<SessionAttachment>();
    electron.invoke.mockReturnValueOnce(superseded.promise).mockReturnValueOnce(failed.promise);
    const supersededAttach = api.sessions.attach("project", "superseded", () => {});
    const failedAttach = api.sessions.attach("project", "failed", () => {});
    failed.reject(new Error("attach failed"));
    await expect(failedAttach).rejects.toThrow("attach failed");
    push(controlPush("attachment-current", 5, "current"));
    expect(currentReceived.at(-1)).toMatchObject({ type: "control", control: { revision: 5 } });

    superseded.resolve(attachment("attachment-superseded", 5, "superseded"));
    await expect(supersededAttach).rejects.toMatchObject({ name: "AbortError" });
    push(controlPush("attachment-current", 6, "current"));
    expect(currentReceived.at(-1)).toMatchObject({ type: "control", control: { revision: 6 } });

    api.sessions.detach();
    expect(electron.send).toHaveBeenCalledWith(CHANNELS.sessionsDetach, "attachment-current");
  });
});

function push(update: SessionPush): void {
  electron.listeners.get(CHANNELS.sessionsPush)?.({}, update);
}

function attachment(attachmentId: string, cursor: number, threadId = "thread"): SessionAttachment {
  return { protocolVersion: PROTOCOL_VERSION, attachmentId, bootstrap: bootstrap(cursor, threadId) };
}

function controlPush(attachmentId: string, revision: number, threadId = "thread"): SessionPush {
  return {
    attachmentId,
    type: "control",
    projectId: "project",
    threadId,
    control: { ...bootstrap(0, threadId).control, revision },
  };
}

function bootstrap(cursor: number, threadId: string): SessionBootstrap {
  return {
    protocolVersion: PROTOCOL_VERSION,
    projectId: "project",
    threadId,
    cursor,
    messages: [],
    state: {},
    control: {
      protocolVersion: PROTOCOL_VERSION,
      revision: 0,
      projectId: "project",
      threadId,
      title: threadId,
      cwd: "/workspace",
      running: false,
      compacting: false,
      queue: { steering: [], followUp: [] },
      models: [],
      commands: [],
      thinkingLevel: "off",
      thinkingLevels: ["off"],
      readiness: { state: "ready" },
      hostRequests: [],
      extensionUi: { statuses: {}, workingVisible: true, toolsExpanded: false, widgets: [] },
    },
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
    reject(error) {
      rejectPromise?.(error);
    },
  };
}
