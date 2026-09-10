import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { projectAsyncWorkflowRows } from "../src/main/pi/extensions/pi-subagents/src/runs/shared/async-status-projection.ts";
import { buildFleetDesktopStatus } from "../src/main/pi/extensions/pi-subagents/src/tui/fleet-status.ts";
import type { SessionControlState } from "../src/shared/contracts.ts";

const state = vi.hoisted(() => ({ control: null as SessionControlState | null, selectorCalls: 0 }));
vi.mock("../src/renderer/src/components/session-context.tsx", () => ({
  useSessionIdentity: () => ({ projectId: "project-1", threadId: "thread-1" }),
  useSessionControlSelector: (selector: (control: SessionControlState | null) => unknown) => {
    state.selectorCalls++;
    return selector(state.control);
  },
}));

import { mergeSubagentContent, SessionInfo } from "../src/renderer/src/components/chat/session-info.tsx";
import { TooltipProvider } from "../src/renderer/src/shared/ui/tooltip-provider.tsx";

function renderSessionInfo(open: boolean): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <SessionInfo open={open} />
    </TooltipProvider>,
  );
}

const css = readFileSync(
  fileURLToPath(new URL("../src/renderer/src/styles/session-info.css", import.meta.url)),
  "utf8",
);
const sessionInfoSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/src/components/chat/session-info.tsx", import.meta.url)),
  "utf8",
);
const messagesSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/src/components/chat/messages.tsx", import.meta.url)),
  "utf8",
);
const threadSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/src/components/chat/session-chat-thread.tsx", import.meta.url)),
  "utf8",
);

describe("SessionInfo", () => {
  beforeEach(() => {
    state.control = null;
    state.selectorCalls = 0;
  });

  it("renders only the session ID and its copy action without todo state", () => {
    const markup = renderSessionInfo(true);

    expect(markup).toContain('id="session-info-panel"');
    expect(markup).toContain('data-open="true"');
    expect(markup).toContain("thread-1");
    expect(markup).toContain("复制会话 ID");
    expect(markup).not.toContain("工作区");
    expect(markup).not.toContain("目录");
    expect(markup).not.toContain("G:/workspace/meta-agent-v2");
    expect(markup).not.toMatch(/<h[1-6]/);

    for (const hiddenText of [
      "SESSION",
      "已连接",
      "运行中",
      "模型",
      "思考级别",
      "上下文",
      "消息",
      "创建时间",
      "更新时间",
      "项目 ID",
      "project-1",
      "GPT 5.6 Solo",
      "117.8k / 272k (43%)",
      "2 条",
    ]) {
      expect(markup).not.toContain(hiddenText);
    }
  });

  it("does not render main-agent information", () => {
    state.control = {
      mainAgent: {
        version: 1,
        profileId: "reviewer",
        profileRevision: 7,
        profileName: "代码审查",
        createdAt: 1,
        configuration: {
          prompt: {
            mode: "replace",
            text: "Review only",
            includeGlobalRules: false,
            includeProjectRules: true,
            includeSkills: false,
          },
          tools: ["read", "grep"],
          builtinPluginIds: ["pi-subagents"],
        },
      },
      extensionHost: { widgets: [] },
    } as unknown as SessionControlState;

    const markup = renderSessionInfo(true);

    expect(markup).not.toContain("主智能体");
    expect(markup).not.toContain("代码审查");
    expect(markup).not.toContain("reviewer");
    expect(markup).not.toContain("Review only");
    expect(markup).not.toContain("pi-subagents");
  });

  it("renders native todo details from the session extension host", () => {
    state.control = {
      extensionHost: {
        widgets: [
          {
            key: "rpiv-todos",
            placement: "aboveEditor",
            lines: ["任务清单 (1/3)"],
            nativeContent: {
              type: "todo",
              version: 1,
              summary: { total: 3, completed: 1, pending: 1, inProgress: 1 },
              labels: {
                heading: "任务清单",
                more: "更多",
                statuses: { pending: "待处理", inProgress: "进行中", completed: "已完成" },
              },
              tasks: [
                { id: 1, subject: "完成协议", status: "completed" },
                { id: 2, subject: "迁移面板", status: "in_progress", activeForm: "正在迁移" },
                { id: 3, subject: "验证", status: "pending", blockedBy: [2] },
              ],
              hiddenTaskCount: 0,
            },
          },
        ],
      },
    } as unknown as SessionControlState;

    const markup = renderSessionInfo(true);
    expect(markup).toContain('data-slot="session-todo-list"');
    expect(markup).toContain("任务清单");
    expect(markup).toContain("1/3");
    expect(markup).toContain("完成协议");
    expect(markup).toContain("迁移面板");
    expect(markup).toContain("正在迁移");
    expect(markup).toContain("#2");
    expect(markup).not.toContain("desktop-todo-list-trigger");
    expect(markup).not.toContain("desktop-todo-list-popover");
  });

  it("renders every native todo widget", () => {
    const nativeContent = {
      type: "todo" as const,
      version: 1 as const,
      summary: { total: 1, completed: 0, pending: 1, inProgress: 0 },
      labels: {
        heading: "任务清单",
        more: "更多",
        statuses: { pending: "待处理", inProgress: "进行中", completed: "已完成" },
      },
      tasks: [{ id: 1, subject: "任务", status: "pending" as const }],
      hiddenTaskCount: 0,
    };
    state.control = {
      extensionHost: {
        widgets: [
          { key: "first", placement: "aboveEditor", lines: ["first"], nativeContent },
          { key: "second", placement: "aboveEditor", lines: ["second"], nativeContent },
        ],
      },
    } as unknown as SessionControlState;

    const markup = renderSessionInfo(true);
    expect(markup.match(/data-slot="session-todo-list"/g)).toHaveLength(2);
  });

  it("keeps active workflow details collapsed while showing progress", () => {
    const fleetContent = buildFleetDesktopStatus(
      [
        {
          key: "async:workflow",
          runId: "workflow",
          workflowWrapper: true,
          agent: "active workflow",
          startedAt: 500,
          tokens: 0,
          state: "running",
          workflowRows: projectAsyncWorkflowRows([
            {
              agent: "finished workflow step",
              status: "complete",
              startedAt: 2_000,
              endedAt: 5_000,
            },
          ]),
          nestedChildren: [
            {
              id: "finished-nested",
              parentRunId: "workflow",
              depth: 0,
              path: [],
              state: "complete",
              agent: "finished nested run",
              startedAt: 1_000,
              endedAt: 3_000,
              lastUpdate: 9_000,
            },
          ],
        },
      ],
      { used: 1, limit: 4 },
      10_000,
    );
    state.control = {
      extensionHost: {
        widgets: [{ key: "fleet", placement: "belowEditor", lines: ["fleet"], nativeContent: fleetContent }],
      },
    } as unknown as SessionControlState;
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);

    const markup = renderSessionInfo(true);

    now.mockRestore();
    expect(markup).toContain("active workflow");
    expect(markup).not.toContain("finished workflow step");
    expect(markup).not.toContain("finished nested run");
    expect(markup).toContain("2/2 完成");
    expect(markup).toContain('class="session-subagent-disclosure" aria-expanded="false"');
    expect(markup).not.toContain("3秒");
    expect(markup).not.toContain("2秒");
    expect(markup).not.toContain("1分 38秒");
    expect(markup).not.toContain("1分 39秒");
  });

  it("deduplicates active fleet runs while retaining async-only terminal details", () => {
    const asyncContent = {
      type: "subagents" as const,
      version: 1 as const,
      source: "async" as const,
      generatedAt: 1_000,
      summary: { activeAgents: 1, asyncRunsUsed: 1, asyncRunsLimit: 0, totalTokens: 1700 },
      nodes: [
        { id: "active-1", runId: "active-1", kind: "subagent" as const, label: "active fallback", state: "running" },
        {
          id: "finished-1",
          runId: "finished-1",
          kind: "host-step" as const,
          label: "completed review",
          state: "done",
          verdict: "fail" as const,
          startedAt: 1_000,
          endedAt: 3_000,
          tokens: 500,
        },
      ],
      omittedNodeCount: 0,
    };
    const fleetContent = {
      ...asyncContent,
      source: "fleet" as const,
      summary: { activeAgents: 2, asyncRunsUsed: 1, asyncRunsLimit: 4, totalTokens: 1200 },
      nodes: [
        {
          id: "workflow",
          kind: "workflow" as const,
          label: "Implementation",
          state: "running",
          children: [
            {
              id: "worker",
              runId: "active-1",
              kind: "subagent" as const,
              label: "worker",
              state: "running",
              modelThinking: "GPT 5.6 Sol · medium",
              activity: "tool edit",
              toolCount: 3,
              tokens: 1200,
              startedAt: Date.now() - 2_000,
            },
          ],
        },
      ],
    };
    state.control = {
      extensionHost: {
        widgets: [
          { key: "async", placement: "aboveEditor", lines: ["async"], nativeContent: asyncContent },
          { key: "fleet", placement: "belowEditor", lines: ["fleet"], nativeContent: fleetContent },
        ],
      },
    } as unknown as SessionControlState;

    const markup = renderSessionInfo(true);
    expect(markup.match(/data-slot="session-subagent-status"/g)).toHaveLength(1);
    expect(markup).toContain("<dt>活动</dt><dd>2</dd>");
    expect(markup).toContain("<dt>异步运行</dt><dd>1/4</dd>");
    expect(markup).toContain("Implementation");
    expect(markup).toContain("0/1 完成");
    expect(markup).not.toContain("GPT 5.6 Sol · medium");
    expect(markup).not.toContain("<dt>工具调用</dt>");
    expect(markup).toContain("completed review");
    expect(markup).toContain("失败");
    expect(markup).toContain('class="session-subagent-elapsed" title="耗时">2秒</span>');
    expect(markup).not.toContain("active-1");
    expect(markup).not.toContain("finished-1");
    expect(markup).not.toContain("active fallback");
  });

  it("retains terminal siblings from async status when Fleet only contains the active step", () => {
    const asyncContent = {
      type: "subagents" as const,
      version: 1 as const,
      source: "async" as const,
      generatedAt: 1_000,
      summary: { activeAgents: 1, asyncRunsUsed: 1, asyncRunsLimit: 0, totalTokens: 900 },
      nodes: [
        {
          id: "parallel-run",
          runId: "parallel-run",
          kind: "subagent" as const,
          label: "parallel fallback",
          state: "running",
          children: [
            { id: "step:0", kind: "step" as const, label: "failed sibling", state: "failed", verdict: "fail" as const },
            { id: "step:1", kind: "step" as const, label: "active fallback", state: "running" },
          ],
        },
      ],
      omittedNodeCount: 0,
    };
    const fleetContent = {
      ...asyncContent,
      source: "fleet" as const,
      nodes: [
        {
          id: "async:parallel-run:1",
          runId: "parallel-run",
          kind: "subagent" as const,
          label: "active worker",
          state: "running",
          activity: "tool edit",
        },
      ],
    };
    state.control = {
      extensionHost: {
        widgets: [
          { key: "async", placement: "aboveEditor", lines: ["async"], nativeContent: asyncContent },
          { key: "fleet", placement: "belowEditor", lines: ["fleet"], nativeContent: fleetContent },
        ],
      },
    } as unknown as SessionControlState;

    const merged = mergeSubagentContent(fleetContent, asyncContent);
    expect(merged.nodes).toHaveLength(1);
    expect(merged.nodes[0]).toMatchObject({
      label: "active worker",
      children: [{ id: "step:0", label: "failed sibling", state: "failed" }],
    });
    expect(JSON.stringify(merged)).not.toContain("active fallback");
    expect(JSON.stringify(merged)).not.toContain("parallel fallback");

    const markup = renderSessionInfo(true);
    expect(markup).toContain("active worker");
    expect(markup).not.toContain("active fallback");
  });

  it("keeps the collapsed panel mounted but hidden from the accessibility tree", () => {
    const markup = renderSessionInfo(false);

    expect(markup).toContain('data-open="false"');
    expect(markup).toContain('aria-hidden="true"');
    expect(state.selectorCalls).toBe(0);
  });
});

describe("session info layout", () => {
  it("reduces only the right content inset by the panel's measured scrollbar reserve", () => {
    const panelRule = css.match(/^\s*\.session-info-panel\s*\{([^}]*)\}/m)?.[1] ?? "";
    const listRule = css.match(/\.session-info-list\s*\{([^}]*)\}/s)?.[1] ?? "";
    const sectionRule = css.match(/\.session-subagents\s*\{([^}]*)\}/s)?.[1] ?? "";

    expect(panelRule).toMatch(/overflow:\s*hidden auto/);
    expect(panelRule).toMatch(/scrollbar-gutter:\s*stable/);
    expect(panelRule).not.toMatch(/scrollbar-gutter:\s*stable both-edges/);
    expect(listRule).toMatch(/padding:\s*8px 0 8px 18px/);
    expect(sectionRule).toMatch(
      /padding:\s*12px max\(0px, calc\(12px - var\(--session-info-scrollbar-width, 0px\)\)\) 12px 12px/,
    );
    expect(sessionInfoSource).toMatch(/panel\.offsetWidth - panel\.clientWidth - borderWidth/);
    expect(sessionInfoSource).toMatch(/--session-info-scrollbar-width/);
  });

  it("uses inset disclosure targets and flat Desktop list styling", () => {
    const sectionRule = css.match(/\.session-subagents\s*\{([^}]*)\}/s)?.[1] ?? "";
    const summaryRule = css.match(/\.session-subagents-summary\s*\{([^}]*)\}/s)?.[1] ?? "";
    const summaryItemRule = css.match(/\.session-subagents-summary > div\s*\{([^}]*)\}/s)?.[1] ?? "";
    const runRule = css.match(/\.session-subagent-run\s*\{([^}]*)\}/s)?.[1] ?? "";
    const disclosureRule = css.match(/\.session-subagent-disclosure\s*\{([^}]*)\}/s)?.[1] ?? "";
    const childTriggerRule =
      Array.from(css.matchAll(/^\s*\.session-subagent-child-trigger\s*\{([^}]*)\}/gm)).at(-1)?.[1] ?? "";
    const detailsRule = css.match(/\.session-subagent-details\s*\{([^}]*)\}/s)?.[1] ?? "";
    const detailContentRule =
      css.match(
        /\.session-subagent-details > \.session-subagent-description,\s*\.session-subagent-details > \.session-subagent-metrics\s*\{([^}]*)\}/s,
      )?.[1] ?? "";
    const childDetailsRule = css.match(/\.session-subagent-child-details\s*\{([^}]*)\}/s)?.[1] ?? "";
    const labelRule =
      css.match(/\.session-subagent-run-labels strong,\s*\.session-subagent-child-label strong\s*\{([^}]*)\}/s)?.[1] ??
      "";

    expect(summaryRule).toMatch(/padding:\s*0/);
    expect(summaryItemRule).not.toMatch(/border|background/);
    expect(runRule).not.toMatch(/border|background|border-radius/);
    expect(disclosureRule).toMatch(/padding:\s*4px 0/);
    expect(childTriggerRule).toMatch(/padding:\s*5px 8px/);
    expect(detailsRule).toMatch(/padding:\s*0 0 8px/);
    expect(detailContentRule).toMatch(/margin-left:\s*26px/);
    expect(childDetailsRule).toMatch(/padding:\s*0 0 8px 8px/);
    expect(css).toContain('[aria-expanded="true"] > .session-subagent-chevron');
    expect(labelRule).toMatch(/overflow-wrap:\s*anywhere/);
    expect(labelRule).not.toMatch(/white-space:\s*nowrap/);
  });

  it("keeps the session ID on one truncated line and overlays the copy action on hover", () => {
    const valueRule = css.match(/\.session-info-id-value\s*\{([^}]*)\}/s)?.[1] ?? "";
    const copyRule = css.match(/\.session-info-copy\s*\{([^}]*)\}/s)?.[1] ?? "";
    const hoverRule =
      css.match(
        /\.session-info-id-row:hover \.session-info-copy,\s*\.session-info-copy:focus-visible\s*\{([^}]*)\}/s,
      )?.[1] ?? "";

    expect(valueRule).toMatch(/overflow:\s*hidden/);
    expect(valueRule).toMatch(/text-overflow:\s*ellipsis/);
    expect(valueRule).toMatch(/white-space:\s*nowrap/);
    expect(copyRule).toMatch(/position:\s*absolute/);
    expect(copyRule).toMatch(/opacity:\s*0/);
    expect(copyRule).toMatch(/pointer-events:\s*none/);
    expect(hoverRule).toMatch(/opacity:\s*1/);
    expect(hoverRule).toMatch(/pointer-events:\s*auto/);
    expect(sessionInfoSource).toMatch(/navigator\.clipboard\.writeText\(identity\.threadId\)/);
    expect(sessionInfoSource).toMatch(/setCopied\(true\)/);
    expect(sessionInfoSource).toMatch(/setTimeout\(\(\) => setCopied\(false\), 2_000\)/);
  });

  it("keeps messages, the composer, and the scroll control centered in the reserved region", () => {
    const openLayoutRule =
      css.match(
        /\.chat-workspace\[data-session-info-open\] \[data-slot="session-message-layout"\],\s*\.chat-workspace\[data-session-info-open\] \[data-slot="session-composer-footer"\],\s*\.chat-workspace\[data-session-info-open\] \[data-slot="session-scroll-to-bottom-layout"\]\s*\{([^}]*)\}/s,
      )?.[1] ?? "";

    expect(openLayoutRule).toMatch(/margin-right:\s*calc\(var\(--session-info-panel-width\) \+ 24px\)/);
    expect(openLayoutRule).not.toMatch(/\bwidth\s*:/);
    expect(messagesSource).toMatch(
      /data-slot="session-message-layout">\s*<div\s+ref=\{contentRef\}\s+data-slot="session-message-content"\s+className="mx-auto w-full max-w-\(--layout-thread-max-width\)"/s,
    );
    expect(messagesSource).toMatch(
      /data-slot="session-scroll-to-bottom-layout"\s+className="[^"]*self-stretch[^"]*"[\s\S]*className="aui-thread-scroll-to-bottom[^"]*right-1\/2[^"]*translate-x-1\/2/,
    );
    expect(threadSource).toMatch(
      /data-slot="session-composer-footer"\s+className="shrink-0 [^"]+"[\s\S]*data-slot="session-composer-content" className="mx-auto w-full max-w-\(--layout-thread-max-width\)/,
    );
    expect(css).not.toMatch(/data-session-info-open[^}]*\.thread-root[^}]*margin-right/s);
    expect(css).not.toMatch(/data-session-info-open[^}]*aui_thread-viewport[^}]*margin-right/s);
  });

  it("uses overlay mode when the session workspace cannot fit the panel beside the thread", () => {
    const workspaceRule = css.match(/^\s*\.chat-workspace\s*\{([^}]*)\}/m)?.[1] ?? "";
    const narrowLayoutRule =
      css.match(
        /@container session-workspace \(max-width: 1153px\)\s*\{\s*\.chat-workspace\[data-session-info-open\] \[data-slot="session-message-layout"\],\s*\.chat-workspace\[data-session-info-open\] \[data-slot="session-composer-footer"\],\s*\.chat-workspace\[data-session-info-open\] \[data-slot="session-scroll-to-bottom-layout"\]\s*\{([^}]*)\}/s,
      )?.[1] ?? "";

    expect(workspaceRule).toMatch(/container-name:\s*session-workspace/);
    expect(workspaceRule).toMatch(/container-type:\s*inline-size/);
    expect(narrowLayoutRule).toMatch(/margin-right:\s*0/);
  });

  it("anchors an animated, content-height panel at the session top-right", () => {
    const panelRule = css.match(/^\s*\.session-info-panel\s*\{([^}]*)\}/m)?.[1] ?? "";

    expect(panelRule).toMatch(/position:\s*absolute/);
    expect(panelRule).toMatch(/top:\s*12px/);
    expect(panelRule).toMatch(/right:\s*12px/);
    expect(panelRule).toMatch(/max-height:\s*calc\(100% - 24px\)/);
    expect(panelRule).toMatch(/overflow:\s*hidden auto/);
    expect(panelRule).toMatch(/transform-origin:\s*calc\(100% - 10px\) -34px/);
    expect(panelRule).not.toMatch(/(?:^|\n)\s*height\s*:/);
    expect(css).toMatch(/\.session-info-panel\[data-open="true"\]\s*\{[^}]*transform:\s*scale\(1\)/s);
  });
});
