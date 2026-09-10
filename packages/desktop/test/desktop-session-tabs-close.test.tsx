// @vitest-environment jsdom

import React, { act, type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CachedSessionRecord } from "../src/renderer/src/runtime/pi-session-store.ts";
import type { DesktopState } from "../src/renderer/src/state/desktop-model.ts";

const testState = vi.hoisted(() => ({
  records: [] as CachedSessionRecord[],
  activeKey: null as string | null,
  routeSession: null as { projectId: string; threadId: string } | null,
  desktop: {
    projects: [],
    activeProjectId: null,
    threadCatalogs: {},
    loading: false,
    error: null,
  } as DesktopState,
  openDraft: vi.fn(),
  openSession: vi.fn(),
  retire: vi.fn(),
  close: vi.fn(),
}));

vi.mock("../src/renderer/src/state/session-cache-context.tsx", () => ({
  useSessionCache: () => ({ retire: testState.retire }),
  useSessionCacheRecords: () => testState.records,
  useSessionCacheActiveKey: () => testState.activeKey,
}));

vi.mock("../src/renderer/src/state/desktop-context.tsx", () => ({
  useDesktopSelector: (selector: (state: DesktopState) => unknown) => selector(testState.desktop),
}));

vi.mock("../src/renderer/src/state/session-navigation.ts", () => ({
  useSessionNavigation: () => ({ openDraft: testState.openDraft, openSession: testState.openSession }),
  useSessionRouteParams: () => testState.routeSession,
}));

vi.mock("../src/renderer/src/state/keyboard-shortcut-provider.tsx", () => ({
  useKeyboardShortcuts: () => ({
    getBindings: () => [],
    primaryModifierPressed: false,
    registerCommandHandler: () => () => undefined,
  }),
}));

vi.mock("../src/renderer/src/components/assistant-ui/tooltip-icon-button.tsx", () => ({
  TooltipIconButton: forwardRef<
    HTMLButtonElement,
    ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode; side?: string; tooltip?: string }
  >(function MockTooltipIconButton({ children, side: _side, tooltip: _tooltip, ...props }, ref) {
    return (
      <button ref={ref} type="button" {...props}>
        {children}
      </button>
    );
  }),
}));

import { DesktopSessionTabs } from "../src/renderer/src/components/layout/desktop-session-tabs.tsx";
import { createSessionRecord } from "../src/renderer/src/runtime/pi-session-store.ts";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  testState.openDraft.mockReset();
  testState.openSession.mockReset();
  testState.retire.mockReset();
  testState.close.mockReset();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(window, "desktop", {
    configurable: true,
    value: { platform: "win32", sessions: { close: testState.close } },
  });

  const first = createSessionRecord({ projectId: "project-a", threadId: "thread-a" });
  const second = createSessionRecord({ projectId: "project-b", threadId: "thread-b" });
  testState.records = [first, second];
  testState.activeKey = first.key;
  testState.routeSession = { projectId: "project-a", threadId: "thread-a" };
  testState.desktop = {
    projects: [],
    activeProjectId: "project-a",
    threadCatalogs: {
      "project-a": [
        {
          id: "thread-a",
          projectId: "project-a",
          title: "Active session",
          createdAt: 1,
          updatedAt: 2,
          messageCount: 1,
          preview: "",
          archived: false,
          running: false,
        },
      ],
      "project-b": [
        {
          id: "thread-b",
          projectId: "project-b",
          title: "Second session",
          createdAt: 1,
          updatedAt: 2,
          messageCount: 1,
          preview: "",
          archived: false,
          running: false,
        },
      ],
    },
    loading: false,
    error: null,
  };

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<DesktopSessionTabs />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("DesktopSessionTabs interactions", () => {
  it("opens the cached active session when the current route is the plugin marketplace", async () => {
    testState.routeSession = null;
    await act(async () => root.render(<DesktopSessionTabs />));

    const activeSessionTab = container.querySelector<HTMLButtonElement>('button[title="Active session"]');
    expect(activeSessionTab).not.toBeNull();
    expect(activeSessionTab?.getAttribute("aria-selected")).toBe("false");

    act(() => activeSessionTab?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(testState.openSession).toHaveBeenCalledWith("project-a", "thread-a");
  });

  it("removes the tab immediately while active-session navigation is pending", async () => {
    let finishNavigation: (() => void) | undefined;
    testState.openSession.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishNavigation = resolve;
        }),
    );

    const closeButton = container.querySelector<HTMLButtonElement>('[aria-label="关闭 Active session"]');
    expect(closeButton).not.toBeNull();

    act(() => closeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.querySelector('[aria-label="关闭 Active session"]')).toBeNull();
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(testState.openSession).toHaveBeenCalledWith("project-b", "thread-b");
    expect(testState.retire).not.toHaveBeenCalled();

    await act(async () => finishNavigation?.());

    expect(testState.retire).toHaveBeenCalledWith(testState.records[0]!.key);
    expect(testState.close).toHaveBeenCalledWith("project-a", "thread-a");
  });
});
