import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionControlState } from "../src/shared/contracts.ts";

const state = vi.hoisted(() => ({ control: null as SessionControlState | null, selectorCalls: 0 }));
vi.mock("../src/renderer/src/components/session-context.tsx", () => ({
  useSessionIdentity: () => ({ projectId: "project-1", threadId: "thread-1" }),
  useSessionControlSelector: (selector: (control: SessionControlState | null) => unknown) => {
    state.selectorCalls++;
    return selector(state.control);
  },
}));

import { SessionInfo } from "../src/renderer/src/components/chat/session-info.tsx";
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

  it("keeps the collapsed panel mounted but hidden from the accessibility tree", () => {
    const markup = renderSessionInfo(false);

    expect(markup).toContain('data-open="false"');
    expect(markup).toContain('aria-hidden="true"');
    expect(state.selectorCalls).toBe(0);
  });
});

describe("session info layout", () => {
  it("balances the list inset against the reserved scrollbar gutter", () => {
    const listRule = css.match(/\.session-info-list\s*\{([^}]*)\}/s)?.[1] ?? "";

    expect(listRule).toMatch(/padding:\s*8px 0 8px 18px/);
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
