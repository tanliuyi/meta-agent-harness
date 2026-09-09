import { describe, expect, it } from "vitest";
import { mergeSessionControl } from "../src/renderer/src/shared/session-control-identity.ts";
import { PROTOCOL_VERSION, type SessionControlState } from "../src/shared/contracts.ts";

describe("mergeSessionControl", () => {
  it("revision 推进时复用 structured-clone 中语义未变化的嵌套引用", () => {
    const previous = control();
    const incoming = structuredClone({ ...previous, revision: 2 });

    const merged = mergeSessionControl(previous, incoming);

    expect(merged).not.toBe(previous);
    expect(merged.revision).toBe(2);
    expect(merged.queueModes).toBe(previous.queueModes);
    expect(merged.model).toBe(previous.model);
    expect(merged.models).toBe(previous.models);
    expect(merged.commands).toBe(previous.commands);
    expect(merged.thinkingLevels).toBe(previous.thinkingLevels);
    expect(merged.context).toBe(previous.context);
    expect(merged.readiness).toBe(previous.readiness);
    expect(merged.hostRequests).toBe(previous.hostRequests);
    expect(merged.extensionSet).toBe(previous.extensionSet);
    expect(merged.extensionHost).toBe(previous.extensionHost);
    expect(merged.goal).toBe(previous.goal);
  });

  it("只替换变化的 extension widget，同时保留其他 extension 引用", () => {
    const previous = control();
    const incoming = structuredClone({ ...previous, revision: 2 });
    incoming.extensionHost.widgets[0] = { ...incoming.extensionHost.widgets[0]!, lines: ["changed"] };

    const merged = mergeSessionControl(previous, incoming);

    expect(merged.extensionHost).not.toBe(previous.extensionHost);
    expect(merged.extensionHost.widgets).not.toBe(previous.extensionHost.widgets);
    expect(merged.extensionHost.statuses).toBe(previous.extensionHost.statuses);
    expect(merged.models).toBe(previous.models);
  });

  it("widget 原生内容变化时不复用旧快照", () => {
    const previous = control();
    const incoming = structuredClone({ ...previous, revision: 2 });
    incoming.extensionHost.widgets[0] = {
      ...incoming.extensionHost.widgets[0]!,
      nativeContent: {
        ...incoming.extensionHost.widgets[0]!.nativeContent!,
        summary: { total: 2, completed: 1, pending: 1, inProgress: 0 },
      },
    };

    const merged = mergeSessionControl(previous, incoming);

    expect(merged.extensionHost.widgets).not.toBe(previous.extensionHost.widgets);
    expect(merged.extensionHost.widgets[0]?.nativeContent?.summary.completed).toBe(1);
  });
  it("subagent 原生节点变化时替换快照，等值快照复用引用", () => {
    const previous = control();
    previous.extensionHost.widgets[0]!.nativeContent = {
      type: "subagents",
      version: 1,
      source: "fleet",
      generatedAt: 1_000,
      summary: { activeAgents: 1, asyncRunsUsed: 1, asyncRunsLimit: 4, totalTokens: 2_000_000 },
      nodes: [
        {
          id: "worker",
          runId: "run-1",
          kind: "subagent",
          label: "worker",
          state: "running",
          toolCount: 1,
        },
      ],
      omittedNodeCount: 0,
    };
    const equalIncoming = structuredClone({ ...previous, revision: 2 });
    expect(mergeSessionControl(previous, equalIncoming).extensionHost.widgets).toBe(previous.extensionHost.widgets);

    const changedIncoming = structuredClone({ ...previous, revision: 3 });
    const nativeContent = changedIncoming.extensionHost.widgets[0]!.nativeContent;
    if (nativeContent?.type !== "subagents") throw new Error("Expected subagent widget");
    nativeContent.nodes[0]!.toolCount = 2;
    const merged = mergeSessionControl(previous, changedIncoming);
    expect(merged.extensionHost.widgets).not.toBe(previous.extensionHost.widgets);
    expect(merged.extensionHost.widgets[0]?.nativeContent?.type).toBe("subagents");
  });

  it("Goal 设置变化时替换 Goal 快照", () => {
    const previous = control();
    const incoming = structuredClone({ ...previous, revision: 2 });
    incoming.goal!.settings.automaticTurnLimit = null;

    const merged = mergeSessionControl(previous, incoming);

    expect(merged.goal).not.toBe(previous.goal);
    expect(merged.goal?.settings.automaticTurnLimit).toBeNull();
  });

  it("Goal 状态变化时只替换 Goal 快照", () => {
    const previous = control();
    const incoming = structuredClone({ ...previous, revision: 2 });
    incoming.goal!.goal = { ...incoming.goal!.goal!, tokensUsed: 2400 };

    const merged = mergeSessionControl(previous, incoming);

    expect(merged.goal).not.toBe(previous.goal);
    expect(merged.goal?.goal?.tokensUsed).toBe(2400);
    expect(merged.extensionHost).toBe(previous.extensionHost);
  });
});

function control(): SessionControlState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    revision: 1,
    projectId: "project",
    threadId: "thread",
    title: "会话",
    updatedAt: 1,
    cwd: "/workspace",
    running: false,
    queueModes: { steering: "all", followUp: "all" },
    model: { provider: "provider", id: "model", name: "Model" },
    models: [{ provider: "provider", id: "model", name: "Model", contextWindow: 128_000, thinking: true }],
    commands: [{ name: "help", description: "帮助", source: "builtin" }],
    thinkingLevel: "medium",
    thinkingLevels: ["off", "medium"],
    context: { tokens: 10, contextWindow: 128_000, percent: 0.1 },
    readiness: { state: "ready" },
    hostRequests: [
      {
        id: "request",
        type: "select",
        title: "选择",
        options: ["A", "B"],
        createdAt: 1,
      },
    ],
    extensionSet: { generation: "extensions-generation", diagnostics: [], reloadRequired: false },
    goal: {
      settings: { rpcEnabled: false, automaticTurnLimit: 25, noProgressTurnLimit: 3 },
      goal: {
        id: "goal-1",
        objective: "完成 Desktop Goal 集成",
        status: "active",
        startedAt: 1,
        updatedAt: 2,
        iteration: 1,
        tokensUsed: 1200,
        timeUsedSeconds: 10,
        automaticModelTurns: 1,
        automaticTurnLimit: 25,
        noProgressTurns: 0,
        noProgressTurnLimit: 3,
      },
    },
    extensionHost: {
      statuses: { extension: "ready" },
      composerCommand: { hostId: "host", revision: 1, mode: "replace", text: "draft" },
      widgets: [
        {
          key: "widget",
          lines: ["line"],
          placement: "aboveEditor",
          nativeContent: {
            type: "todo",
            version: 1,
            summary: { total: 2, completed: 0, pending: 1, inProgress: 1 },
            labels: {
              heading: "Todos",
              more: "more",
              statuses: { pending: "Pending", inProgress: "In progress", completed: "Completed" },
            },
            tasks: [
              { id: 1, subject: "A", status: "in_progress" },
              { id: 2, subject: "B", status: "pending" },
            ],
            hiddenTaskCount: 0,
          },
        },
      ],
    },
  };
}
