// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionSubagentStatus } from "../src/renderer/src/components/chat/session-subagent-status.tsx";
import type { DesktopSubagentWidgetContent } from "../src/shared/desktop-extension-contracts.ts";

let container: HTMLDivElement;
let root: Root;

function content(state: string, activity = "editing files"): DesktopSubagentWidgetContent {
  return {
    type: "subagents",
    version: 1,
    source: "fleet",
    generatedAt: 1_000,
    summary: { activeAgents: state === "running" ? 1 : 0, asyncRunsUsed: 1, asyncRunsLimit: 4, totalTokens: 1_200 },
    nodes: [
      {
        id: "run-node",
        runId: "run-1234567890",
        kind: "subagent",
        label: "Implementation worker with a long descriptive label",
        description: "workflow child: workflow-uuid (native-desktop-ui) · Implements the native Desktop view.",
        state,
        modelThinking: "gpt-5.6-sol / medium",
        activity,
        toolCount: 3,
        turnCount: 2,
        tokens: 1_200,
        startedAt: 1_000,
        children: [
          {
            id: "review-step",
            kind: "step",
            label: "Review implementation",
            description: "Check behavior and accessibility.",
            state: "complete",
            toolCount: 1,
          },
        ],
      },
    ],
    omittedNodeCount: 2,
  };
}

async function renderStatus(value: DesktopSubagentWidgetContent, sessionKey = "project-1:thread-1") {
  await act(async () => {
    root.render(<SessionSubagentStatus content={value} sessionKey={sessionKey} />);
  });
}

function click(element: Element) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("SessionSubagentStatus", () => {
  it("uses clickable disclosures for run and child details", async () => {
    await renderStatus(content("complete"));

    const run = container.querySelector(".session-subagent-run");
    const runTrigger = run?.querySelector(".session-subagent-disclosure");
    expect(runTrigger?.tagName).toBe("BUTTON");
    expect(runTrigger?.getAttribute("aria-expanded")).toBe("false");
    expect(runTrigger?.querySelector(".session-subagent-chevron")).not.toBeNull();
    expect(container.textContent).not.toContain("模型 / 思考");

    await act(async () => click(runTrigger as Element));
    expect(runTrigger?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("模型 / 思考");
    expect(container.textContent).toContain("Implements the native Desktop view.");
    expect(container.textContent).not.toContain("workflow-uuid");
    expect(container.textContent).not.toContain("run-1234567890");
    expect(container.textContent).not.toContain("子任务");
    expect(container.textContent).toContain("另有 2 项未包含在状态数据中");

    const childTrigger = container.querySelector(".session-subagent-child-trigger");
    expect(childTrigger?.getAttribute("aria-expanded")).toBe("false");
    expect(childTrigger?.querySelector(".session-subagent-chevron")).not.toBeNull();
    await act(async () => click(childTrigger as Element));
    expect(childTrigger?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("工具调用");
  });

  it("keeps sibling disclosures independent when they share a run ID", async () => {
    const value = content("complete");
    value.nodes[0]!.children = [
      { id: "step-0", runId: "parallel-run", kind: "step", label: "First", state: "complete", toolCount: 1 },
      { id: "step-1", runId: "parallel-run", kind: "step", label: "Second", state: "complete", toolCount: 2 },
    ];
    await renderStatus(value);

    await act(async () => click(container.querySelector(".session-subagent-disclosure")!));
    const triggers = [...container.querySelectorAll(".session-subagent-child-trigger")];
    expect(triggers).toHaveLength(2);
    const controls = triggers.map((trigger) => trigger.getAttribute("aria-controls"));
    expect(new Set(controls).size).toBe(2);

    await act(async () => click(triggers[0]!));
    expect(triggers[0]!.getAttribute("aria-expanded")).toBe("true");
    expect(triggers[1]!.getAttribute("aria-expanded")).toBe("false");
  });

  it("preserves disclosure choices across live updates and resets them for another session", async () => {
    await renderStatus(content("running"));

    let trigger = container.querySelector(".session-subagent-disclosure");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("模型 / 思考");
    expect(container.textContent).toContain("editing files");
    await act(async () => click(trigger as Element));
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");

    await renderStatus(content("running", "running tests"));
    trigger = container.querySelector(".session-subagent-disclosure");
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("running tests");

    await renderStatus(content("failed", "active_long_running"), "project-1:thread-2");
    trigger = container.querySelector(".session-subagent-disclosure");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('.session-subagent-status[aria-label="失败"]')).not.toBeNull();
    expect(container.textContent).not.toContain("模型 / 思考");
    expect(container.textContent).toContain("长时间运行中");
  });
});
