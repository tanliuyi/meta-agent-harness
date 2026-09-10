import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type BrowserHostServer, createBrowserHostServer } from "../src/main/browser/browser-host-server.ts";
import type { BrowserManager } from "../src/main/browser/browser-manager.ts";
import { DesktopExtensionSettingsService } from "../src/main/extensions/desktop-extension-settings-service.ts";
import type { DesktopExtensionSourcePolicy } from "../src/main/extensions/desktop-extension-source-policy.ts";
import { DesktopBuiltinProviderRegistry } from "../src/main/pi/desktop-builtin-provider.ts";
import {
  controlledResourceLoaderOptions,
  validatePluginSkills,
} from "../src/main/pi/desktop-extension-runtime-policy.ts";
import { BrowserClient } from "../src/main/pi/extensions/pi-browser/lib/browser-client.ts";
import { resolveMainAgentConfiguration, snapshotMainAgent } from "../src/main/pi/main-agent-resolver.ts";
import { PluginMethodDispatcher } from "../src/main/pi/run-code/plugin-method-dispatcher.ts";
import { DesktopPluginRegistryBuilder } from "../src/main/pi/run-code/plugin-method-registry.ts";
import { executePluginProgram } from "../src/main/pi/run-code/run-code-runtime.ts";
import { RunCodeRegistryHolder } from "../src/main/pi/run-code/run-code-tool.ts";
import { MarketplacePluginRegistry } from "../src/main/plugins/marketplace-plugin-registry.ts";
import { PluginConfigurationService } from "../src/main/plugins/plugin-configuration-service.ts";
import { DesktopDevelopmentService } from "../src/main/runtime/desktop-development-service.ts";
import { DesktopRuntimeService } from "../src/main/runtime/desktop-runtime-service.ts";
import { MainAgentConfigService } from "../src/main/settings/main-agent-config-service.ts";
import { SettingsConfigService } from "../src/main/settings/settings-config-service.ts";
import type { ThreadWorkerRegistry } from "../src/main/sidecar/thread-worker-registry.ts";
import type { WindowDirtyGuard } from "../src/main/window-dirty-guard.ts";
import { createDesktopRuntimeRouter } from "../src/renderer/src/app/desktop-runtime-router.ts";
import { CHANNELS } from "../src/shared/channels.ts";
import { desktopMethods } from "../src/shared/desktop-runtime-contracts.ts";

const electron = vi.hoisted(() => ({ windows: [] as unknown[], select: vi.fn() }));
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => electron.windows, getFocusedWindow: () => electron.windows[0] },
  dialog: { showOpenDialog: electron.select },
}));

function fakeWindow() {
  const debuggerEmitter = new EventEmitter();
  let attached = false;
  const debuggerApi = Object.assign(debuggerEmitter, {
    isAttached: () => attached,
    attach: vi.fn(() => {
      attached = true;
    }),
    detach: vi.fn(() => {
      attached = false;
    }),
    sendCommand: vi.fn(async (method: string) =>
      method === "Page.captureScreenshot" ? { data: "aW1hZ2U=" } : { result: { value: "Desktop" } },
    ),
  });
  const state = { location: { pathname: "/", href: "/" }, status: "idle", isLoading: false };
  const router = createDesktopRuntimeRouter({
    state,
    navigate: async ({ to }) => {
      state.location = { pathname: to, href: to };
    },
  });
  const contents = Object.assign(new EventEmitter(), {
    id: 10,
    isDestroyed: vi.fn(() => false),
    debugger: debuggerApi,
    send: vi.fn(),
    executeJavaScript: vi.fn(async (code: string) =>
      code.includes("navigate(")
        ? router.navigate(JSON.parse(code.slice(code.indexOf("navigate(") + 9, -1)))
        : router.state(),
    ),
  });
  return Object.assign(new EventEmitter(), {
    id: 1,
    webContents: contents,
    isDestroyed: vi.fn(() => false),
    isFocused: () => true,
    isVisible: () => true,
    isMinimized: () => false,
    isMaximized: () => false,
    getTitle: () => "Desktop",
    getBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 }),
    show: vi.fn(),
    focus: vi.fn(),
    minimize: vi.fn(),
    maximize: vi.fn(),
    restore: vi.fn(),
    setBounds: vi.fn(),
  });
}
const identity = { projectId: "project", threadId: "thread" };

describe("Desktop runtime authenticated bridge", () => {
  let directory: string;
  let server: BrowserHostServer;
  let runtime: DesktopRuntimeService;
  let window: ReturnType<typeof fakeWindow>;
  let client: BrowserClient;
  let revoked: boolean;
  let dirty: boolean;
  let mainAgents: MainAgentConfigService;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "desktop-runtime-"));
    revoked = false;
    dirty = false;
    window = fakeWindow();
    electron.windows = [window];
    mainAgents = new MainAgentConfigService(directory);
    const extensionSettings = new DesktopExtensionSettingsService(directory);
    const configurations = new PluginConfigurationService(directory, new MarketplacePluginRegistry(directory), {
      isAvailable: () => false,
      encrypt: () => {
        throw new Error("unavailable");
      },
      decrypt: () => {
        throw new Error("unavailable");
      },
    });
    const development = new DesktopDevelopmentService(
      mainAgents,
      {
        extensionSettings,
        pluginConfigurations: configurations,
        extensionSourcePolicy: { invalidate: vi.fn() } as unknown as DesktopExtensionSourcePolicy,
      },
      {
        extensionSettingsChanged: async () => {},
        getExtensionState: async () => ({ appliedGeneration: "old", desiredGeneration: "new", reloadRequired: true }),
      } as unknown as ThreadWorkerRegistry,
    );
    runtime = new DesktopRuntimeService(
      new SettingsConfigService(directory),
      { isDirty: () => dirty } as unknown as WindowDirtyGuard,
      "test-version",
      development,
    );
    runtime.addWindow(window as unknown as BrowserWindow);
    server = await createBrowserHostServer(
      {
        resolveSessionCapability: (token: string) => (!revoked && token === "capability" ? identity : null),
        isKnownSession: () => true,
      } as unknown as BrowserManager,
      { desktopRuntime: (request, signal, session) => runtime.call(request, signal, session) },
    );
    const endpoint = server.getEndpoint()!;
    client = new BrowserClient({
      ...endpoint,
      sessionToken: "capability",
      sessionProjectId: identity.projectId,
      sessionThreadId: identity.threadId,
    });
    vi.stubEnv("PI_BROWSER_HOST_PORT", String(endpoint.port));
    vi.stubEnv("PI_BROWSER_TOKEN", endpoint.token);
    vi.stubEnv("PI_BROWSER_SESSION_TOKEN", "capability");
    vi.stubEnv("PI_BROWSER_SESSION_PROJECT_ID", identity.projectId);
    vi.stubEnv("PI_BROWSER_SESSION_THREAD_ID", identity.threadId);
  });
  afterEach(async () => {
    runtime.dispose();
    await server.dispose();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    await rm(directory, { recursive: true, force: true });
  });
  const call = (method: string, params = {}) => client.desktopRuntime(method, params);

  test("admits desktop alone through real builtin capture and executes run_code over authenticated settings bridge", async () => {
    const definition = DesktopBuiltinProviderRegistry.getExtensionDefinitions().find(
      (entry) => entry.id === "desktop",
    )!;
    const set = {
      generation: "test",
      projectId: identity.projectId,
      entries: [definition],
      diagnostics: [],
      resolvedAt: 0,
    };
    const factories = DesktopBuiltinProviderRegistry.getExtensionFactories({
      enabledExtensionIds: new Set(["desktop"]),
    });
    const builder = new DesktopPluginRegistryBuilder();
    const holder = new RunCodeRegistryHolder("test");
    const options = controlledResourceLoaderOptions(set, factories, {
      pluginRegistry: holder,
      pluginRegistryBuilder: builder,
      cwd: directory,
    });
    const native = vi.fn();
    const factory = options.extensionFactories.find(
      (entry) => typeof entry !== "function" && entry.name === "desktop:desktop",
    )!;
    if (typeof factory === "function") throw new Error("Expected named builtin");
    await factory.factory({ registerTool: native } as unknown as ExtensionAPI);
    expect(native).not.toHaveBeenCalled();
    const registry = builder.finalize();
    expect([...registry.keys()]).toEqual(["desktop"]);
    expect([...registry.get("desktop")!.keys()].sort()).toEqual(Object.keys(desktopMethods).sort());
    const skills = options.skillsOverride({ skills: [], diagnostics: [] });
    expect(validatePluginSkills(set, skills)).toEqual([]);
    const result = await executePluginProgram(
      'const s = JSON.parse((await plugin["desktop"].get_settings({})).text); return JSON.parse((await plugin["desktop"].update_settings({expectedRevision:s.revision,patch:{showThinking:false}})).text);',
      new PluginMethodDispatcher(registry, directory),
      "settings",
      undefined,
      directory,
      undefined,
      { calls: [], logs: [], toolContext: { cwd: directory } },
    );
    expect(result).toMatchObject({ status: "saved", snapshot: { settings: { showThinking: false } } });
    expect(window.webContents.send).toHaveBeenCalledWith(CHANNELS.settingsChanged);
    expect(JSON.parse(await readFile(join(directory, "settings.json"), "utf8"))).toMatchObject({ showThinking: false });
    const navigated = await executePluginProgram(
      'return plugin["desktop"].navigate({path:"/settings/models"});',
      new PluginMethodDispatcher(registry, directory),
      "navigate",
      undefined,
      directory,
      undefined,
      { calls: [], logs: [], toolContext: { cwd: directory } },
    );
    expect(navigated).toMatchObject({ text: expect.stringContaining('"reached":true') });
    await holder.dispose();
  });

  test("validates settings independently, preserves revision conflicts and rejects revoked or mismatched worker capabilities", async () => {
    const current = (await call("get_settings")) as { revision: string };
    await expect(
      call("update_settings", { expectedRevision: current.revision, patch: { showThinking: "false" } }),
    ).rejects.toThrow("Invalid Desktop parameters");
    await call("update_settings", { expectedRevision: current.revision, patch: { userName: "Designer" } });
    expect(
      await call("update_settings", { expectedRevision: current.revision, patch: { userName: "Stale" } }),
    ).toMatchObject({ status: "conflict" });
    const endpoint = server.getEndpoint()!;
    const mismatched = new BrowserClient({
      ...endpoint,
      sessionToken: "capability",
      sessionProjectId: "another",
      sessionThreadId: "thread",
    });
    await expect(mismatched.desktopRuntime("inspect", {})).rejects.toThrow("capability");
    revoked = true;
    await expect(call("inspect")).rejects.toThrow("capability");
  });

  test("navigates the SPA and inspects observed state; rejects guest IDs, unsafe routes and dirty editors", async () => {
    expect(await call("inspect")).toMatchObject({ version: "test-version", windows: [{ windowId: 1 }] });
    expect(await call("navigate", { path: "/settings/models" })).toMatchObject({
      reached: true,
      path: "/settings/models",
    });
    expect(await call("navigation_state")).toMatchObject({ path: "/settings/models" });
    await expect(call("navigate", { path: "https://evil.test" })).rejects.toThrow("Unsupported Desktop route");
    await expect(call("screenshot", { windowId: 999 })).rejects.toThrow("unavailable");
    dirty = true;
    await expect(call("navigate", { path: "/new" })).rejects.toThrow("Save or discard");
    for (const action of ["show", "focus", "minimize", "maximize", "restore"]) await call("window_action", { action });
    await call("window_action", { action: "set_bounds", bounds: { width: 900, height: 700 } });
    expect(window.setBounds).toHaveBeenCalledWith({ width: 900, height: 700 });
  });

  test("debugs renderer CDP and bounds events/output, handles abort and window destruction", async () => {
    expect(await call("evaluate", { expression: "document.title" })).toMatchObject({ result: { value: "Desktop" } });
    await call("cdp_send", { method: "DOM.getDocument", paramsJson: "{}" });
    expect(window.webContents.debugger.sendCommand).toHaveBeenCalledWith("DOM.getDocument", {});
    expect(await call("screenshot")).toEqual({ dataUrl: "data:image/png;base64,aW1hZ2U=" });
    await expect(call("cdp_send", { method: "Target.attachToTarget" })).rejects.toThrow("Unsupported");
    await expect(call("cdp_send", { method: "Page.navigate", paramsJson: "{}" })).rejects.toThrow("Unsupported");
    await expect(call("cdp_send", { method: "DOM.getDocument", paramsJson: "[]" })).rejects.toThrow("object");
    for (let i = 0; i < 205; i++) window.webContents.debugger.emit("message", {}, "Runtime.consoleAPICalled", { i });
    const events = (await call("cdp_events", { limit: 2 })) as { events: unknown[]; dropped: number };
    expect(events.events).toHaveLength(2);
    expect(events.dropped).toBe(5);
    window.webContents.debugger.emit("message", {}, "Runtime.exceptionThrown", { text: "x".repeat(9000) });
    expect(await call("cdp_events", { after: 205 })).toMatchObject({ events: [], dropped: 6 });
    window.webContents.executeJavaScript.mockImplementationOnce(() => new Promise(() => {}));
    const pending = runtime.call({ method: "navigation_state", params: {} }, new AbortController().signal);
    window.webContents.emit("destroyed");
    await expect(pending).rejects.toThrow("destroyed");
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(runtime.call({ method: "inspect", params: {} }, cancelled.signal)).rejects.toThrow();
    runtime.dispose();
    runtime.dispose();
    expect(window.webContents.debugger.detach).toHaveBeenCalledTimes(1);
  });

  test("keeps long profile saves, revision reads, conflicts and updates within response limits", async () => {
    const configuration = {
      prompt: {
        mode: "append" as const,
        text: "x".repeat(25000),
        includeGlobalRules: true,
        includeProjectRules: true,
        includeSkills: true,
      },
      tools: null,
      builtinPluginIds: null,
    };
    let listing = (await call("main_agents")) as {
      snapshot: { revision: string; profiles: Array<{ id: string }> };
      nextOffset: number | null;
    };
    let revision = listing.snapshot.revision;
    let id = "";
    for (const name of ["Long A", "Long B"]) {
      const result = (await call("save_main_agent", {
        mutation: {
          action: "create",
          expectedRevision: revision,
          profile: { name, description: "Long prompt", configuration },
        },
      })) as { status: string; revision: string; profile: { id: string } };
      expect(result.status).toBe("saved");
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(1024);
      revision = result.revision;
      id = result.profile.id;
    }
    listing = (await call("main_agents", { limit: 1 })) as typeof listing;
    expect(listing.snapshot.revision).toBe(revision);
    expect(listing.snapshot.profiles).toHaveLength(1);
    expect(listing.nextOffset).toBe(1);
    const read = (await call("get_main_agent", { id, expectedRevision: revision })) as {
      profile: Record<string, unknown>;
    };
    expect(read.profile.configuration).toEqual(configuration);
    const updated = (await call("save_main_agent", {
      mutation: { action: "update", expectedRevision: revision, profile: { ...read.profile, description: "Updated" } },
    })) as { status: string; revision: string };
    expect(updated.status).toBe("saved");
    expect(
      await call("save_main_agent", {
        mutation: { action: "update", expectedRevision: revision, profile: read.profile },
      }),
    ).toEqual({ status: "conflict", revision: updated.revision });
    expect(await call("get_main_agent", { id, expectedRevision: revision })).toEqual({
      status: "conflict",
      revision: updated.revision,
    });
  });

  test("reassembles byte-bounded profile JSON chunks with Chinese, escapes and surrogate pairs", async () => {
    const current = await mainAgents.getSnapshot();
    const prompt = '设计\\"\n😀'.repeat(6000);
    const saved = await mainAgents.mutate({
      action: "create",
      expectedRevision: current.revision,
      profile: {
        name: "Unicode",
        description: "Escaped JSON",
        configuration: {
          prompt: {
            mode: "append",
            text: prompt,
            includeGlobalRules: true,
            includeProjectRules: true,
            includeSkills: true,
          },
          tools: null,
          builtinPluginIds: null,
        },
      },
    });
    if (saved.status !== "saved") throw new Error("Expected save");
    const profile = saved.snapshot.profiles.at(-1)!;
    let offset: number | undefined;
    let source = "";
    do {
      const result = (await call("get_main_agent", {
        id: profile.id,
        expectedRevision: saved.snapshot.revision,
        ...(offset === undefined ? {} : { offset }),
      })) as { chunk: string; nextOffset: number | null };
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(48 * 1024);
      source += result.chunk;
      offset = result.nextOffset ?? undefined;
    } while (offset !== undefined);
    expect(JSON.parse(source)).toEqual(profile);
    expect(await call("main_agents")).toMatchObject({ snapshot: { revision: saved.snapshot.revision } });
  });

  test("retains CDP cursor monotonicity after debugger detach and reattach", async () => {
    await call("cdp_send", { method: "Runtime.enable" });
    for (let i = 0; i < 100; i++) window.webContents.debugger.emit("message", {}, "Runtime.consoleAPICalled", { i });
    const first = (await call("cdp_events")) as { events: Array<{ sequence: number }> };
    const cursor = first.events.at(-1)!.sequence;
    expect(cursor).toBe(100);
    window.webContents.debugger.detach();
    await call("cdp_send", { method: "Runtime.enable" });
    window.webContents.debugger.emit("message", {}, "Runtime.consoleAPICalled", { text: "after reattach" });
    expect(await call("cdp_events", { after: cursor })).toMatchObject({
      events: [{ sequence: 101, params: { text: "after reattach" } }],
      latestSequence: 101,
      dropped: 100,
    });
    expect(window.webContents.debugger.listenerCount("message")).toBe(1);
  });

  test("creates a graphic-design main agent, validates its policy, resolves it for new sessions and updates its profile", async () => {
    const initial = (await call("main_agents")) as { snapshot: { revision: string } };
    const profile = {
      name: "Graphic Designer",
      description: "Layout, typography and print design",
      configuration: {
        prompt: {
          mode: "append",
          text: "You specialize in graphic design. Validate dimensions and typography.",
          includeGlobalRules: true,
          includeProjectRules: true,
          includeSkills: true,
        },
        tools: ["read", "write", "run_code"],
        builtinPluginIds: ["desktop"],
      },
    };
    expect(await call("validate_main_agent", { profile })).toMatchObject({ valid: true });
    expect(
      await call("save_main_agent", {
        mutation: { action: "create", expectedRevision: initial.snapshot.revision, profile },
      }),
    ).toMatchObject({ status: "saved" });
    const saved = await mainAgents.getSnapshot();
    const designer = saved.profiles.find((p) => p.name === "Graphic Designer")!;
    const resolved = resolveMainAgentConfiguration(
      snapshotMainAgent(saved, { id: designer.id, revision: designer.revision }),
      { generation: "g", projectId: "project", entries: [], diagnostics: [], resolvedAt: 0 },
      directory,
    );
    expect(resolved.tools).toEqual(["read", "write", "run_code"]);
    expect(resolved.resourceLoaderOptions.appendSystemPromptOverride?.([])).toEqual([
      profile.configuration.prompt.text,
    ]);
    expect(
      await call("save_main_agent", {
        mutation: {
          action: "update",
          expectedRevision: saved.revision,
          profile: { ...designer, description: "Updated design specialist" },
        },
      }),
    ).toMatchObject({ status: "saved" });
    await expect(
      call("validate_main_agent", {
        profile: { ...profile, configuration: { ...profile.configuration, builtinPluginIds: ["unknown"] } },
      }),
    ).rejects.toThrow("Unknown configurable");
  });

  test("approves a developed plugin with the existing native dialog and validates/saves its configuration without claiming it loaded", async () => {
    const pluginPath = join(directory, "design-plugin");
    await mkdir(pluginPath);
    await writeFile(join(pluginPath, "index.ts"), "export default function(pi) {}\n");
    await writeFile(
      join(pluginPath, "market-manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        plugin: { id: "design.tools", name: "Design tools" },
        pi: { entry: "index.ts" },
        desktop: { hostProfileVersion: 1 },
        capabilities: ["plugin-methods.provide", "configuration.read"],
        configuration: {
          version: 1,
          fields: [{ key: "dpi", label: "DPI", type: "number", minimum: 72, maximum: 1200, defaultValue: 300 }],
        },
      }),
    );
    const initial = (await call("plugins")) as { persisted: { revision: string } };
    const enabled = (await call("set_developer_mode", {
      requestId: "enable",
      expectedRevision: initial.persisted.revision,
      enabled: true,
    })) as { snapshot: { revision: string } };
    electron.select.mockResolvedValueOnce({ canceled: false, filePaths: [pluginPath] });
    const approved = (await call("load_local_plugin", {
      requestId: "approve",
      expectedRevision: enabled.snapshot.revision,
      path: pluginPath,
    })) as { status: string; snapshot: { entries: { id: string }[] } };
    expect(approved.status).toBe("saved");
    expect(electron.select).toHaveBeenCalled();
    const id = approved.snapshot.entries[0].id;
    const config = (await call("plugin_configuration", { pluginId: id })) as { revision: string };
    expect(
      await call("save_plugin_configuration", {
        requestId: "bad",
        expectedRevision: config.revision,
        pluginId: id,
        valuesJson: '{"dpi":1}',
      }),
    ).toMatchObject({ status: "invalid" });
    expect(
      await call("save_plugin_configuration", {
        requestId: "save",
        expectedRevision: config.revision,
        pluginId: id,
        valuesJson: '{"dpi":600}',
      }),
    ).toMatchObject({ status: "saved", snapshot: { values: { dpi: 600 } } });
    expect(await call("plugins")).toMatchObject({
      runtime: { appliedGeneration: "old", desiredGeneration: "new", reloadRequired: true },
    });
  });
});
