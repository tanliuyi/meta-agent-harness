import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { SessionStatus } from "../src/renderer/src/components/chat/session-status.tsx";
import { piSessionBus } from "../src/renderer/src/runtime/pi-session-bus.ts";
import type { SessionControlState } from "../src/shared/contracts.ts";
import { PROTOCOL_VERSION } from "../src/shared/contracts.ts";

describe("SessionStatus", () => {
  beforeEach(() => {
    piSessionBus.store.replace({
      protocolVersion: PROTOCOL_VERSION,
      projectId: "project",
      threadId: "thread",
      cursor: 0,
      headId: null,
      nodes: [],
      queue: [],
      phase: "idle",
    });
  });

  it("显示运行中的权威活动状态", () => {
    piSessionBus.store.replace({ ...piSessionBus.store.getSnapshot(), phase: "running" });
    const markup = renderToStaticMarkup(
      <SessionStatus snapshot={control({ running: true, workingVisible: true, workingMessage: "正在分析" })} />,
    );

    expect(markup).toContain("正在分析");
    expect(markup).toContain("session-status-row");
  });

  it("空闲且无错误时不渲染占位容器", () => {
    expect(renderToStaticMarkup(<SessionStatus snapshot={control()} />)).toBe("");
  });
});

function control(
  overrides: { running?: boolean; workingVisible?: boolean; workingMessage?: string } = {},
): SessionControlState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    revision: 1,
    projectId: "project",
    threadId: "thread",
    title: "thread",
    updatedAt: 1,
    cwd: "/workspace",
    running: overrides.running ?? false,
    queueModes: { steering: "one-at-a-time", followUp: "one-at-a-time" },
    models: [],
    commands: [],
    thinkingLevel: "off",
    thinkingLevels: ["off"],
    readiness: { state: "ready" },
    hostRequests: [],
    extensionUi: {
      statuses: {},
      workingVisible: overrides.workingVisible ?? false,
      workingMessage: overrides.workingMessage,
      editorRevision: 0,
      toolsExpanded: false,
      widgets: [],
    },
  };
}
