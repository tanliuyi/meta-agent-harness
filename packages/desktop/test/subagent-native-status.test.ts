import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { DesktopExtensionHost } from "../src/main/pi/desktop-extension-host.ts";
import { projectAsyncWorkflowRows } from "../src/main/pi/extensions/pi-subagents/src/runs/shared/async-status-projection.ts";
import type { AsyncJobState } from "../src/main/pi/extensions/pi-subagents/src/shared/types.ts";
import { buildAsyncDesktopStatus } from "../src/main/pi/extensions/pi-subagents/src/tui/desktop-native-status.ts";
import {
  buildFleetDesktopStatus,
  type FleetStatusEntry,
} from "../src/main/pi/extensions/pi-subagents/src/tui/fleet-status.ts";
import { renderWidget } from "../src/main/pi/extensions/pi-subagents/src/tui/render.ts";

function asyncJob(): AsyncJobState {
  return {
    asyncId: "async-1",
    asyncDir: "C:/tmp/async-1",
    mode: "single",
    status: "running",
    agents: ["worker"],
    startedAt: 1_000,
    updatedAt: 3_000,
    totalTokens: { total: 1_200, input: 700, output: 500, window: 2_000 },
    steps: [
      {
        index: 0,
        agent: "worker",
        status: "running",
        model: "gpt-5.6-sol",
        thinking: "medium",
        currentTool: "edit",
        toolCount: 3,
        turnCount: 2,
        tokens: { total: 1_200, input: 700, output: 500, window: 2_000 },
      },
    ],
  } as unknown as AsyncJobState;
}

function countNodes(nodes: Array<{ children?: Array<{ children?: unknown[] }> }>): number {
  return nodes.reduce(
    (count, node) =>
      count + 1 + countNodes((node.children ?? []) as Array<{ children?: Array<{ children?: unknown[] }> }>),
    0,
  );
}

function maxDepth(nodes: Array<{ children?: Array<{ children?: unknown[] }> }>, depth = 0): number {
  return nodes.reduce((maximum, node) => {
    const childDepth = node.children?.length
      ? maxDepth(node.children as Array<{ children?: Array<{ children?: unknown[] }> }>, depth + 1)
      : depth;
    return Math.max(maximum, depth, childDepth);
  }, depth);
}

describe("native subagent status projection", () => {
  it("projects bounded async hierarchy with model, activity and usage", () => {
    const content = buildAsyncDesktopStatus([asyncJob()], 4_000);

    expect(content).toMatchObject({
      type: "subagents",
      version: 1,
      source: "async",
      generatedAt: 4_000,
      summary: { activeAgents: 1, asyncRunsUsed: 1, totalTokens: 1_200 },
      nodes: [
        {
          id: "async-1",
          kind: "subagent",
          state: "running",
          tokens: 1_200,
          children: [
            {
              kind: "step",
              modelThinking: "gpt-5.6-sol · thinking medium",
              activity: "tool edit",
              toolCount: 3,
              turnCount: 2,
              tokens: 1_200,
            },
          ],
        },
      ],
    });
  });

  it("keeps materialized workflow children nested and does not double-count wrapper usage", () => {
    const entries: FleetStatusEntry[] = [
      {
        key: "async:workflow",
        workflowWrapper: true,
        agent: "workflow",
        startedAt: 1_000,
        tokens: 1_000,
        state: "running",
      },
      {
        key: "async:workflow:0",
        parentKey: "async:workflow",
        agent: "worker",
        modelThinking: "gpt-5.6-sol · medium",
        activity: "tool edit",
        startedAt: 1_100,
        tokens: 1_000,
        toolCount: 3,
        state: "running",
      },
      {
        key: "foreground:reviewer",
        agent: "reviewer",
        startedAt: 1_200,
        tokens: 500,
        state: "running",
      },
    ];

    const content = buildFleetDesktopStatus(entries, { used: 1, limit: 4 }, 4_000);

    expect(content.summary).toEqual({ activeAgents: 2, asyncRunsUsed: 1, asyncRunsLimit: 4, totalTokens: 1_500 });
    expect(content.nodes[0]).toMatchObject({
      kind: "workflow",
      children: [{ kind: "subagent", label: "worker", tokens: 1_000, toolCount: 3 }],
    });
    expect(content.nodes[1]).toMatchObject({ kind: "subagent", label: "reviewer", tokens: 500 });
  });

  it("keeps active workflow rows visible when completed rows exceed the child limit", () => {
    const content = buildFleetDesktopStatus(
      [
        {
          key: "workflow",
          workflowWrapper: true,
          agent: "workflow",
          startedAt: 1_000,
          tokens: 0,
          state: "running",
          workflowRows: [
            ...Array.from({ length: 8 }, (_, index) => ({ name: `complete-${index}`, state: "complete" as const })),
            { name: "active-step", state: "running" as const, activity: "tool edit" },
          ],
        },
      ],
      { used: 1, limit: 4 },
      4_000,
    );

    expect(content.nodes[0]?.children).toHaveLength(8);
    expect(content.nodes[0]?.children?.map((node) => node.label)).toContain("active-step");
    expect(content.omittedNodeCount).toBe(1);
  });

  it("does not emit workflow rows after attached children exhaust the child budget", () => {
    const content = buildFleetDesktopStatus(
      [
        {
          key: "workflow",
          workflowWrapper: true,
          agent: "workflow",
          startedAt: 1_000,
          tokens: 0,
          state: "running",
          workflowRows: [{ name: "active-step", state: "running", activity: "tool edit" }],
        },
        ...Array.from(
          { length: 8 },
          (_, index): FleetStatusEntry => ({
            key: `attached-${index}`,
            parentKey: "workflow",
            agent: `attached-${index}`,
            startedAt: 1_100 + index,
            tokens: 0,
            state: "running",
          }),
        ),
      ],
      { used: 1, limit: 4 },
      4_000,
    );

    expect(content.nodes[0]?.children).toHaveLength(8);
    expect(content.nodes[0]?.children?.map((node) => node.label)).not.toContain("active-step");
    expect(countNodes(content.nodes)).toBe(9);
    expect(content.omittedNodeCount).toBe(1);
  });

  it("preserves terminal Fleet times and bounds nested model details through the Desktop host", () => {
    const longModel = `model-${"x".repeat(240)}`;
    const workflowRows = projectAsyncWorkflowRows([
      {
        agent: "workflow-worker",
        status: "complete",
        startedAt: 2_000,
        endedAt: 5_000,
      },
    ]);
    const content = buildFleetDesktopStatus(
      [
        {
          key: "async:workflow",
          runId: "workflow",
          workflowWrapper: true,
          agent: "workflow",
          startedAt: 500,
          tokens: 0,
          state: "running",
          workflowRows,
          nestedChildren: [
            {
              id: "nested-run",
              parentRunId: "workflow",
              depth: 0,
              path: [],
              state: "complete",
              agent: "nested-worker",
              model: longModel,
              thinking: "medium",
              startedAt: 1_000,
              endedAt: 3_000,
              lastUpdate: 9_000,
              steps: [
                {
                  agent: "nested-step",
                  status: "failed",
                  model: longModel,
                  thinking: "high",
                  startedAt: 2_000,
                  endedAt: 4_000,
                  lastActivityAt: 8_000,
                },
              ],
            },
          ],
        },
      ],
      { used: 1, limit: 4 },
      10_000,
    );

    const workflowRow = content.nodes[0]?.children?.find((node) => node.label.includes("workflow-worker"));
    const nestedRun = content.nodes[0]?.children?.find((node) => node.id === "nested-run");
    const nestedStep = nestedRun?.children?.[0];
    expect(workflowRow).toMatchObject({ state: "complete", startedAt: 2_000, endedAt: 5_000 });
    expect(nestedRun).toMatchObject({ state: "complete", startedAt: 1_000, updatedAt: 9_000, endedAt: 3_000 });
    expect(nestedStep).toMatchObject({ state: "failed", startedAt: 2_000, updatedAt: 4_000, endedAt: 4_000 });
    expect(nestedRun?.modelThinking?.length).toBeLessThanOrEqual(160);
    expect(nestedStep?.modelThinking?.length).toBeLessThanOrEqual(160);

    const host = new DesktopExtensionHost(
      () => undefined,
      () => [],
    );
    host.createContext().setWidget("fleet", ["fallback"], { nativeContent: content } as never);
    expect(host.hostState.widgets[0]?.nativeContent).toEqual(content);
  });

  it("keeps generated payloads within host depth, width, text and global limits", () => {
    const jobs = Array.from({ length: 20 }, (_, jobIndex) => ({
      ...asyncJob(),
      asyncId: `async-${jobIndex}`,
      steps: Array.from({ length: 8 }, (_, stepIndex) => ({
        index: stepIndex,
        agent: `worker-${stepIndex}`,
        status: "running",
        currentTool: "x".repeat(160),
      })),
    })) as AsyncJobState[];
    const asyncContent = buildAsyncDesktopStatus(jobs, 4_000);
    expect(countNodes(asyncContent.nodes)).toBeLessThanOrEqual(80);
    expect(asyncContent.omittedNodeCount).toBeGreaterThan(0);
    expect(asyncContent.nodes[0]?.children?.[0]?.activity?.length).toBeLessThanOrEqual(160);

    const fleetEntries: FleetStatusEntry[] = Array.from({ length: 20 }, (_, rootIndex) => ({
      key: `root-${rootIndex}`,
      workflowWrapper: true,
      runId: `run-${rootIndex}`,
      agent: "workflow",
      startedAt: 1_000,
      tokens: 2_000_000,
      state: "running",
      workflowRows: Array.from({ length: 10 }, (_, childIndex) => ({
        name: `child-${childIndex}`,
        state: "running" as const,
      })),
    }));
    const fleetContent = buildFleetDesktopStatus(fleetEntries, { used: 20, limit: 24 }, 4_000);
    expect(countNodes(fleetContent.nodes)).toBeLessThanOrEqual(80);
    expect(fleetContent.nodes[0]?.children).toHaveLength(8);
    expect(fleetContent.omittedNodeCount).toBeGreaterThan(0);
    expect(fleetContent.summary.totalTokens).toBe(40_000_000);

    const deepNested = (depth: number): NonNullable<FleetStatusEntry["nestedChildren"]>[number] => ({
      id: `nested-${depth}`,
      parentRunId: "root",
      depth,
      path: [],
      state: "running",
      mode: "single",
      agent: `nested-${depth}`,
      children: depth < 5 ? [deepNested(depth + 1)] : undefined,
    });
    const deepContent = buildFleetDesktopStatus(
      [
        {
          key: "deep",
          agent: "worker",
          startedAt: 1_000,
          tokens: 0,
          state: "running",
          nestedChildren: [deepNested(0)],
        },
      ],
      { used: 0, limit: 4 },
      4_000,
    );
    expect(maxDepth(deepContent.nodes)).toBeLessThanOrEqual(3);
    expect(deepContent.omittedNodeCount).toBeGreaterThan(0);

    const host = new DesktopExtensionHost(
      () => undefined,
      () => [],
    );
    const ui = host.createContext();
    ui.setWidget("async", ["fallback"], { nativeContent: asyncContent } as never);
    ui.setWidget("fleet", ["fallback"], { nativeContent: fleetContent } as never);
    ui.setWidget("deep", ["fallback"], { nativeContent: deepContent } as never);
    expect(host.hostState.widgets.map((widget) => widget.nativeContent?.type)).toEqual([
      "subagents",
      "subagents",
      "subagents",
    ]);
  });

  it("counts workflow aggregate usage once when materialized children are also present", () => {
    const parent = {
      ...asyncJob(),
      asyncId: "parent",
      mode: "workflow",
      totalTokens: { total: 5_000_000 },
    } as AsyncJobState;
    const child = {
      ...asyncJob(),
      asyncId: "child",
      parentWorkflowRunId: "parent",
      totalTokens: { total: 2_000_000 },
    } as AsyncJobState;
    expect(buildAsyncDesktopStatus([parent, child], 4_000).summary.totalTokens).toBe(5_000_000);
  });

  it("uses native payloads only for Desktop and clears them with the existing lifecycle", () => {
    const desktopSetWidget = vi.fn();
    const desktopContext = {
      hasUI: true,
      mode: "rpc",
      ui: {
        widgetCapabilities: { components: true, input: false, nativeContent: true },
        setWidget: desktopSetWidget,
      },
    } as unknown as ExtensionContext;

    renderWidget(desktopContext, [asyncJob()]);
    expect(desktopSetWidget).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ nativeContent: expect.objectContaining({ type: "subagents", source: "async" }) }),
    );
    renderWidget(desktopContext, []);
    expect(desktopSetWidget).toHaveBeenLastCalledWith(expect.any(String), undefined);

    const terminalSetWidget = vi.fn();
    const terminalContext = {
      hasUI: true,
      mode: "interactive",
      ui: { setWidget: terminalSetWidget, getToolsExpanded: () => false },
    } as unknown as ExtensionContext;
    renderWidget(terminalContext, [asyncJob()]);
    expect(terminalSetWidget.mock.calls[0]?.[1]).toEqual(expect.any(Function));
  });
});
