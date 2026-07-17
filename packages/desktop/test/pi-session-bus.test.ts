import { beforeEach, describe, expect, it, vi } from "vitest";
import { PiSessionBus } from "../src/renderer/src/runtime/pi-session-bus.ts";
import type { SessionBootstrap, SessionPushPayload } from "../src/shared/contracts.ts";
import { PROTOCOL_VERSION } from "../src/shared/contracts.ts";

describe("PiSessionBus", () => {
  let push: ((update: SessionPushPayload) => void) | undefined;

  beforeEach(() => {
    push = undefined;
    vi.stubGlobal("window", {
      desktop: {
        sessions: {
          attach: vi.fn(
            async (_projectId: string, _threadId: string, listener: (update: SessionPushPayload) => void) => {
              push = listener;
              return bootstrap();
            },
          ),
          detach: vi.fn(),
        },
      },
    });
  });

  it("转发所有 keyed control 供 catalog 更新，不把它写入 active timeline", async () => {
    const bus = new PiSessionBus();
    const listener = vi.fn();
    bus.onControl(listener);
    const attached = await bus.attach("project", "thread");
    expect(listener).not.toHaveBeenCalled();
    expect(bus.store.getSnapshot().threadId).toBe("");
    bus.commit(attached);
    expect(bus.store.getSnapshot().threadId).toBe("thread");
    listener.mockClear();

    push?.({
      type: "control",
      projectId: "other-project",
      threadId: "other-thread",
      control: { ...bootstrap().control, projectId: "other-project", threadId: "other-thread" },
    });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "other-project", threadId: "other-thread" }),
    );

    listener.mockClear();
    push?.({ type: "control", projectId: "project", threadId: "thread", control: bootstrap().control });
    expect(listener).toHaveBeenCalledOnce();
  });
});

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
      title: "Thread",
      updatedAt: 0,
      cwd: "C:/workspace",
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
