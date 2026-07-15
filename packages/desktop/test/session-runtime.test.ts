import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionRuntime } from "../src/main/pi/session-runtime.ts";

const mocks = vi.hoisted(() => ({
  createAgentSession: vi.fn(),
  listener: undefined as ((event: AgentSessionEvent) => void) | undefined,
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  AuthStorage: { create: () => ({}) },
  ModelRegistry: { create: () => ({}) },
  SettingsManager: { create: () => ({}) },
  createAgentSession: mocks.createAgentSession,
  getAgentDir: () => "/agent",
}));

vi.mock("../src/main/pi/host-ui.ts", () => ({
  HostUi: class {
    readonly requests = [];
    readonly uiState = { statuses: {}, workingVisible: true, toolsExpanded: false, widgets: [] };

    createContext() {
      return {};
    }

    respond() {}

    dispose() {}
  },
}));

vi.mock("../src/main/pi/pi-ag-ui-adapter.ts", () => ({
  PiAgUiAdapter: class {
    readonly currentSequence = 0;
    readonly activeRunBootstrap = undefined;

    handle() {}

    dispose() {}
  },
}));

describe("SessionRuntime summary", () => {
  beforeEach(() => {
    mocks.listener = undefined;
    mocks.createAgentSession.mockReset();
  });

  it("首条用户消息替换新会话占位标题", async () => {
    const session = createSession();
    mocks.createAgentSession.mockResolvedValue({ session });
    const runtime = await SessionRuntime.create({
      projectId: "project",
      cwd: "/workspace",
      push: () => {},
      onSummaryChanged: () => {},
    });
    const message: AgentSession["messages"][number] = {
      role: "user",
      content: "第一条问题",
      timestamp: 1,
    };
    session.messages.push(message);

    mocks.listener?.({ type: "message_end", message });

    expect(runtime.threadSummary(false).title).toBe("第一条问题");
    await runtime.dispose();
  });
});

function createSession(): AgentSession {
  const session = {
    sessionId: "thread",
    sessionFile: undefined,
    sessionName: undefined,
    messages: [],
    state: { pendingToolCalls: new Map(), errorMessage: undefined },
    isStreaming: false,
    async bindExtensions() {},
    subscribe(listener: (event: AgentSessionEvent) => void) {
      mocks.listener = listener;
      return () => {};
    },
    dispose() {},
  };
  return session as unknown as AgentSession;
}
