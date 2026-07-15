import { describe, expect, it } from "vitest";
import { desktopReducer, INITIAL_STATE } from "../src/renderer/src/state/desktop-model.ts";
import type {
  Project,
  SessionBootstrap,
  SessionControlState,
  Thread,
  WorkbenchState,
} from "../src/shared/contracts.ts";
import { PROTOCOL_VERSION } from "../src/shared/contracts.ts";

const project: Project = {
  id: "project",
  name: "workspace",
  cwd: "C:/workspace",
  lastOpenedAt: 1,
  available: true,
};

const thread: Thread = {
  id: "thread",
  projectId: project.id,
  title: "新会话",
  createdAt: 1,
  updatedAt: 1,
  messageCount: 0,
  preview: "",
  archived: false,
  running: false,
};

describe("desktop reducer", () => {
  it("只接受 revision 更新的 control state，不复制消息历史", () => {
    const workbench = createWorkbench();
    let state = desktopReducer(INITIAL_STATE, { type: "project-loaded", project, threads: [thread] });
    state = desktopReducer(state, { type: "thread-loaded", bootstrap: createBootstrap(1, "第一版"), workbench });
    state = desktopReducer(state, { type: "control", control: createControl(3, "第三版") });
    state = desktopReducer(state, { type: "control", control: createControl(2, "过期版本") });

    expect(state.controls["project:thread"]?.title).toBe("第三版");
    expect(state.bootstraps["project:thread"]?.messages).toEqual([]);
    expect(state.threads[0]?.title).toBe("第三版");
  });

  it("归档状态与当前 session 选择相互独立", () => {
    let state = desktopReducer(INITIAL_STATE, { type: "project-loaded", project, threads: [thread] });
    state = desktopReducer(state, {
      type: "thread-loaded",
      bootstrap: createBootstrap(1, "会话"),
      workbench: createWorkbench(),
    });
    state = desktopReducer(state, { type: "thread-archived", threadId: thread.id, archived: true });

    expect(state.threadId).toBe(thread.id);
    expect(state.threads[0]?.archived).toBe(true);
    expect(desktopReducer(state, { type: "thread-cleared" }).threadId).toBeNull();
  });
});

function createWorkbench(): WorkbenchState {
  return {
    projectId: project.id,
    threadId: thread.id,
    panel: "files",
    panelOpen: true,
    panelWidth: 360,
    terminalOpen: false,
    terminalHeight: 280,
    openFiles: [],
    expandedPaths: [],
  };
}

function createBootstrap(revision: number, title: string, cursor = 0): SessionBootstrap {
  return {
    protocolVersion: PROTOCOL_VERSION,
    projectId: project.id,
    threadId: thread.id,
    cursor,
    control: createControl(revision, title),
    messages: [],
    state: {},
  };
}

function createControl(revision: number, title: string): SessionControlState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    revision,
    projectId: project.id,
    threadId: thread.id,
    title,
    cwd: project.cwd,
    running: false,
    compacting: false,
    queue: { steering: [], followUp: [] },
    models: [],
    commands: [],
    thinkingLevel: "off",
    thinkingLevels: ["off"],
    readiness: { state: "missing-model" },
    hostRequests: [],
    extensionUi: { statuses: {}, workingVisible: true, toolsExpanded: false, widgets: [] },
  };
}
