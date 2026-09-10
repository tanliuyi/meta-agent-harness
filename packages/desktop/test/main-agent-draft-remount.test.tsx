// @vitest-environment jsdom
import type * as AssistantUi from "@assistant-ui/react";
import React, { act, type ReactNode, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { NewSessionSurface } from "../src/renderer/src/components/new-session-surface.tsx";
import { NewSessionDraft } from "../src/renderer/src/components/panel/session/new-session-draft.tsx";
import { DraftSessionProvider, useDraftSession } from "../src/renderer/src/state/draft-session-context.tsx";
import type * as SessionDraftModule from "../src/renderer/src/state/session-draft-context.tsx";
import { SessionDraft } from "../src/renderer/src/state/session-draft-context.tsx";
import type { DraftSessionConfig } from "../src/shared/contracts.ts";
import type { MainAgentSelection } from "../src/shared/main-agent-contracts.ts";

const state = vi.hoisted(() => ({
  draft: null as SessionDraft | null,
  props: null as Record<string, unknown> | null,
  store: null as unknown,
  cache: { setActiveKey: vi.fn(), setDraftMaterializing: vi.fn() },
  composer: { getState: () => ({ text: "retained prompt", attachments: [], isEmpty: false }), reset: vi.fn() },
  navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => state.navigate }));
vi.mock("@assistant-ui/react", async (original) => ({
  ...(await original<typeof AssistantUi>()),
  useExternalStoreRuntime: () => ({ thread: { composer: state.composer } }),
  AssistantRuntimeProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../src/renderer/src/state/desktop-store-context.tsx", () => ({ useDesktopStore: () => state.store }));
vi.mock("../src/renderer/src/state/desktop-context.tsx", () => ({
  useDesktopActions: () => ({ refreshProjectThreads: vi.fn() }),
}));
vi.mock("../src/renderer/src/state/session-cache-context.tsx", () => ({ useSessionCache: () => state.cache }));
vi.mock("../src/renderer/src/state/session-navigation.ts", () => ({
  useDraftSearchParams: () => ({ projectId: "p" }),
  resolveDraftProjectId: () => "p",
}));
vi.mock("../src/renderer/src/components/session-context.tsx", () => ({
  useSessionScope: () => ({ record: { key: "p\0parent" } }),
  useSessionControlSelector: () => "/project",
  useSessionWorkbenchTabs: () => ({}),
}));
vi.mock("../src/renderer/src/state/session-draft-context.tsx", async (original) => {
  const actual = await original<typeof SessionDraftModule>();
  return {
    ...actual,
    useSessionDraft: () => {
      const draft = state.draft!;
      useSyncExternalStore(draft.subscribe, draft.getVersion);
      return { draft, runtime: { thread: { composer: state.composer } } };
    },
  };
});
vi.mock("../src/renderer/src/components/new-session-shell.tsx", () => ({
  NewSessionShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../src/renderer/src/components/chat/draft-composer-thread.tsx", () => ({
  DraftComposerThread: (props: Record<string, unknown>) => {
    state.props = props;
    return <div data-draft />;
  },
}));
let owner: ReturnType<typeof useDraftSession>;
function Probe() {
  owner = useDraftSession();
  return null;
}
const create = vi.fn();
const getDraftConfig = vi.fn();
let root: Root;
let container: HTMLDivElement;
function config(id = "default", revision = 1): DraftSessionConfig {
  return {
    model: { provider: "test", id: "model", name: "Model" },
    models: [
      {
        provider: "test",
        id: "model",
        name: "Model",
        contextWindow: 1000,
        thinking: true,
        thinkingLevels: ["off", "high"],
      },
    ],
    thinkingLevel: "off",
    thinkingLevels: ["off", "high"],
    readiness: { state: "ready" },
    commands: [],
    extensions: { extensionSetGeneration: "generation", enabledPluginIds: null, plugins: [], diagnostics: [] },
    mainAgent: {
      selection: { id, revision },
      profiles: [],
      tools: [],
      builtinPlugins: [],
      promptSources: [],
      snapshot: {
        version: 1,
        profileId: id,
        profileRevision: revision,
        profileName: id,
        createdAt: 1,
        configuration: {
          prompt: {
            mode: "default",
            text: "",
            includeGlobalRules: true,
            includeProjectRules: true,
            includeSkills: true,
          },
          tools: null,
          builtinPluginIds: null,
        },
      },
    },
  };
}
async function renderRoute(show: boolean) {
  await act(async () =>
    root.render(
      <DraftSessionProvider>
        <Probe />
        {show ? <NewSessionSurface /> : <div>settings</div>}
      </DraftSessionProvider>,
    ),
  );
}
async function selectProfile() {
  await act(async () =>
    (state.props!.onMainAgentChange as (selection: MainAgentSelection) => void)({ id: "reviewer", revision: 2 }),
  );
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  state.store = createStore(() => ({
    loading: false,
    projects: [{ id: "p", name: "Project", cwd: "/project", available: true }],
  }));
  state.draft = new SessionDraft("p\0parent", { projectId: "p", threadId: "parent" });
  state.props = null;
  create.mockReset();
  getDraftConfig
    .mockReset()
    .mockImplementation(async (_project, _cwd, selection) =>
      config(selection && "id" in selection ? selection.id : "default", selection?.revision ?? 1),
    );
  Object.defineProperty(window, "desktop", {
    configurable: true,
    value: {
      sessions: { getDraftConfig, create },
      projects: { listWorktrees: async () => [{ path: "/project", current: true }] },
      preferences: { getInitial: () => ({ values: {} }), save: async () => ({}) },
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});
describe("main agent draft remounts", () => {
  it("retains the explicit routed choice through /new -> settings -> /new", async () => {
    await renderRoute(true);
    await selectProfile();
    expect(owner.config?.mainAgent?.selection.id).toBe("reviewer");
    await act(async () =>
      owner.setConfig({
        ...owner.config!,
        thinkingLevel: "high",
        extensions: { ...owner.config!.extensions, enabledPluginIds: ["chosen-plugin"] },
      }),
    );
    await renderRoute(false);
    await renderRoute(true);
    expect(getDraftConfig).toHaveBeenLastCalledWith("p", "/project", { id: "reviewer", revision: 2 });
    expect(owner.config?.mainAgent?.selection.id).toBe("reviewer");
    expect(owner.config?.thinkingLevel).toBe("high");
    expect(owner.config?.extensions.enabledPluginIds).toEqual(["chosen-plugin"]);
    expect(state.composer.reset).not.toHaveBeenCalled();
  });
  it("retains a pending routed choice and ignores the old mount's response", async () => {
    await renderRoute(true);
    let resolve!: (value: DraftSessionConfig) => void;
    getDraftConfig.mockImplementationOnce(
      () =>
        new Promise<DraftSessionConfig>((done) => {
          resolve = done;
        }),
    );
    await selectProfile();
    await renderRoute(false);
    await renderRoute(true);
    await act(async () => resolve(config("obsolete")));
    expect(owner.config?.mainAgent?.selection.id).toBe("reviewer");
  });
  it("retains explicit child selection, inheritance snapshot and model through panel remount", async () => {
    await act(async () => root.render(<NewSessionDraft />));
    await selectProfile();
    const draft = state.draft!;
    await act(async () => draft.setConfig({ ...draft.config!, thinkingLevel: "high" }));
    const inherited = draft.inheritedMainAgent;
    await act(async () => root.render(null));
    await act(async () => root.render(<NewSessionDraft />));
    expect(getDraftConfig).toHaveBeenLastCalledWith("p", undefined, { id: "reviewer", revision: 2 });
    expect(draft.config?.mainAgent?.selection.id).toBe("reviewer");
    expect(draft.config?.thinkingLevel).toBe("high");
    expect(draft.inheritedMainAgent).toEqual(inherited);
    expect(draft.mainAgentSource).toBe("profile");
    expect(state.composer.reset).not.toHaveBeenCalled();
  });
  it.each(["route", "panel"] as const)("does not reload or change a submitting %s draft on remount", async (kind) => {
    const render =
      kind === "route"
        ? renderRoute
        : async (show: boolean) => {
            await act(async () => root.render(show ? <NewSessionDraft /> : null));
          };
    await render(true);
    await selectProfile();
    let reject!: (error: Error) => void;
    create.mockImplementationOnce(
      () =>
        new Promise((_done, fail) => {
          reject = fail;
        }),
    );
    let submission!: Promise<unknown>;
    await act(async () => {
      submission = (state.props!.onSubmit as () => Promise<void>)().catch((error: unknown) => error);
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ mainAgent: { id: "reviewer", revision: 2 } }));
    const calls = getDraftConfig.mock.calls.length;
    await render(false);
    await render(true);
    expect(getDraftConfig).toHaveBeenCalledTimes(calls);
    await act(async () => {
      reject(new Error("creation failed"));
      await submission;
    });
    const current = kind === "route" ? owner.config : state.draft!.config;
    expect(current?.mainAgent?.selection.id).toBe("reviewer");
    expect(state.composer.reset).not.toHaveBeenCalled();
  });

  it("retains a pending child choice while ignoring a response from its unmounted panel", async () => {
    await act(async () => root.render(<NewSessionDraft />));
    let resolve!: (value: DraftSessionConfig) => void;
    getDraftConfig.mockImplementationOnce(
      () =>
        new Promise<DraftSessionConfig>((done) => {
          resolve = done;
        }),
    );
    await selectProfile();
    await act(async () => root.render(null));
    await act(async () => root.render(<NewSessionDraft />));
    await act(async () => resolve(config("obsolete")));
    expect(state.draft!.config?.mainAgent?.selection.id).toBe("reviewer");
    expect(state.draft!.mainAgentSource).toBe("profile");
  });

  it("keeps inheritance reselectable across child panel remounts", async () => {
    await act(async () => root.render(<NewSessionDraft />));
    await selectProfile();
    await act(async () => (state.props!.onInheritMainAgent as () => void)());
    await act(async () => root.render(null));
    await act(async () => root.render(<NewSessionDraft />));
    expect(getDraftConfig).toHaveBeenLastCalledWith("p", undefined, {
      kind: "inherit-parent",
      parentThreadId: "parent",
    });
    expect(state.draft!.mainAgentSource).toBe("inherit-parent");
  });
});
