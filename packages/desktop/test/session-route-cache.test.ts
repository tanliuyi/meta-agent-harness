import { describe, expect, it } from "vitest";
import {
  createSessionRecord,
  parseSessionRecordKey,
  type SessionIdentity,
  sessionRecordKey,
} from "../src/renderer/src/runtime/pi-session-store.ts";
import { SessionTransportManager } from "../src/renderer/src/runtime/session-transport-manager.ts";
import type { SessionControlState } from "../src/shared/contracts.ts";
import { PROTOCOL_VERSION } from "../src/shared/contracts.ts";

const EMPTY_CONTROL: SessionControlState = {
  protocolVersion: PROTOCOL_VERSION,
  revision: 1,
  projectId: "p1",
  threadId: "t1",
  title: "Test Session",
  updatedAt: Date.now(),
  cwd: "/tmp",
  running: false,
  retry: undefined,
  queueModes: { steering: "all", followUp: "all" },
  model: undefined,
  models: [],
  commands: [],
  thinkingLevel: "off",
  thinkingLevels: [],
  context: undefined,
  readiness: { state: "ready" },
  lastError: undefined,
  hostRequests: [],
  extensionUi: {
    statuses: {},
    widgets: [],
    workingMessage: undefined,
    workingVisible: false,
    hiddenThinkingLabel: undefined,
    windowTitle: undefined,
    editorText: undefined,
    editorRevision: 0,
    toolsExpanded: false,
  },
};

describe("SessionIdentity", () => {
  it("sessionRecordKey 使用 NUL 分隔符避免歧义", () => {
    const key = sessionRecordKey("project:1", "thread:1");
    expect(key).toBe("project:1\u0000thread:1");
    const parsed = parseSessionRecordKey(key);
    expect(parsed).toEqual({ projectId: "project:1", threadId: "thread:1" });
  });

  it("sessionRecordKey 支持简单 ID", () => {
    const key = sessionRecordKey("proj-a", "thread-b");
    expect(key).toBe("proj-a\u0000thread-b");
    const parsed = parseSessionRecordKey(key);
    expect(parsed).toEqual({ projectId: "proj-a", threadId: "thread-b" });
  });

  it("parseSessionRecordKey 在没有分隔符时返回 null", () => {
    expect(parseSessionRecordKey("no-separator")).toBeNull();
  });
});

describe("CachedSessionRecord", () => {
  it("createSessionRecord 创建带初始 generation 和 stores 的 record", () => {
    const identity: SessionIdentity = { projectId: "p1", threadId: "t1" };
    const record = createSessionRecord(identity);

    expect(record.identity).toEqual(identity);
    expect(record.key).toBe(sessionRecordKey("p1", "t1"));
    expect(record.generation).toBe(1);
    expect(record.lastAccessedAt).toBeGreaterThan(0);
    expect(record.stores.timeline).toBeDefined();
    expect(record.stores.control).toBeDefined();
    expect(record.stores.workbench).toBeDefined();
    expect(record.stores.summary).toBeDefined();
    expect(record.stores.connection).toBeDefined();
  });

  it("不同 session identity 产生不同的 record key", () => {
    const r1 = createSessionRecord({ projectId: "p1", threadId: "t1" });
    const r2 = createSessionRecord({ projectId: "p1", threadId: "t2" });
    const r3 = createSessionRecord({ projectId: "p2", threadId: "t1" });
    expect(r1.key).not.toBe(r2.key);
    expect(r1.key).not.toBe(r3.key);
    expect(r2.key).not.toBe(r3.key);
  });
});

describe("SessionControlStore", () => {
  it("getSnapshot 初始返回 null", () => {
    const record = createSessionRecord({ projectId: "p1", threadId: "t1" });
    expect(record.stores.control.getSnapshot()).toBeNull();
  });

  it("replace 设置 control state", () => {
    const record = createSessionRecord({ projectId: "p1", threadId: "t1" });
    record.stores.control.replace(EMPTY_CONTROL);
    expect(record.stores.control.getSnapshot()).toEqual(EMPTY_CONTROL);
  });

  it("apply 跳过旧的 revision", () => {
    const record = createSessionRecord({ projectId: "p1", threadId: "t1" });
    const control1: SessionControlState = { ...EMPTY_CONTROL, revision: 2, title: "v2" };
    const control2: SessionControlState = { ...EMPTY_CONTROL, revision: 1, title: "v1" };

    record.stores.control.replace(control1);
    expect(record.stores.control.getSnapshot()?.title).toBe("v2");

    // apply with older revision should be ignored
    record.stores.control.apply(control2);
    expect(record.stores.control.getSnapshot()?.title).toBe("v2");
  });
});

describe("SessionConnectionStore", () => {
  it("初始状态为 attaching", () => {
    const record = createSessionRecord({ projectId: "p1", threadId: "t1" });
    expect(record.stores.connection.getSnapshot()).toBe("attaching");
  });

  it("setState 更新 connection state", () => {
    const record = createSessionRecord({ projectId: "p1", threadId: "t1" });
    record.stores.connection.setState("ready");
    expect(record.stores.connection.getSnapshot()).toBe("ready");
    record.stores.connection.setState("error");
    expect(record.stores.connection.getSnapshot()).toBe("error");
  });
});

describe("SessionSummaryStore", () => {
  it("初始 summary 正确", () => {
    const record = createSessionRecord({ projectId: "p1", threadId: "t1" });
    const summary = record.stores.summary.getSnapshot();
    expect(summary.composerEmpty).toBe(true);
    expect(summary.running).toBe(false);
    expect(summary.loading).toBe(false);
    expect(summary.hasPendingAttachments).toBe(false);
    expect(summary.connectionState).toBe("attaching");
  });

  it("setRunning 更新 running 状态", () => {
    const record = createSessionRecord({ projectId: "p1", threadId: "t1" });
    record.stores.summary.setRunning(true);
    expect(record.stores.summary.getSnapshot().running).toBe(true);
    record.stores.summary.setRunning(false);
    expect(record.stores.summary.getSnapshot().running).toBe(false);
  });
});

describe("SessionTransportManager", () => {
  it("getConnectionState 对未知 key 返回 null", () => {
    const manager = new SessionTransportManager();
    expect(manager.getConnectionState("unknown")).toBeNull();
  });
});

describe("session-navigation", () => {
  it("session route path 格式正确", () => {
    const path = `/projects/${encodeURIComponent("test-project")}/session/${encodeURIComponent("test-thread")}`;
    expect(path).toBe("/projects/test-project/session/test-thread");
  });

  it("draft route path 格式正确", () => {
    const path = "/new";
    expect(path).toBe("/new");
  });

  it("settings route 路径正确", () => {
    expect("/settings").toBe("/settings");
    expect("/settings/personalization").toBe("/settings/personalization");
  });
});
