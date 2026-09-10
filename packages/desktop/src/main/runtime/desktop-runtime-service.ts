import type { BrowserWindow } from "electron";
import { Check } from "typebox/value";
import type { BrowserSessionIdentity } from "../../shared/browser-contracts.ts";
import { desktopDevelopmentMethods } from "../../shared/desktop-development-contracts.ts";
import { type DesktopMethod, desktopMethods, isDesktopRoute } from "../../shared/desktop-runtime-contracts.ts";
import type { DesktopSettings } from "../../shared/settings-config-contracts.ts";
import { saveSettingsAndBroadcast } from "../settings/settings-config-broadcast.ts";
import type { SettingsConfigService } from "../settings/settings-config-service.ts";
import type { WindowDirtyGuard } from "../window-dirty-guard.ts";
import type { DesktopDevelopmentService } from "./desktop-development-service.ts";

const MAX_OUTPUT = 48 * 1024;
const MAX_IMAGE = 4 * 1024 * 1024;
interface CdpEvent {
  sequence: number;
  method: string;
  params: unknown;
}
interface DebuggerState {
  events: CdpEvent[];
  sequence: number;
  dropped: number;
  owned: boolean;
  listener: (event: Electron.Event, method: string, params: unknown) => void;
}

/** Main-owned runtime control; only explicitly registered application windows are eligible. */
export class DesktopRuntimeService {
  private readonly windows = new Map<number, BrowserWindow>();
  private readonly debuggers = new Map<number, DebuggerState>();
  private readonly shutdown = new AbortController();
  private readonly settings: SettingsConfigService;
  private readonly dirtyGuard: WindowDirtyGuard;
  private readonly version: string;
  private readonly development?: DesktopDevelopmentService;
  constructor(
    settings: SettingsConfigService,
    dirtyGuard: WindowDirtyGuard,
    version: string,
    development?: DesktopDevelopmentService,
  ) {
    this.development = development;
    this.settings = settings;
    this.dirtyGuard = dirtyGuard;
    this.version = version;
  }
  addWindow(window: BrowserWindow): void {
    this.windows.set(window.id, window);
    window.once("closed", () => {
      this.releaseDebugger(window);
      this.windows.delete(window.id);
    });
  }
  dispose(): void {
    this.shutdown.abort();
    for (const window of this.windows.values()) this.releaseDebugger(window);
    this.windows.clear();
  }
  async call(request: unknown, signal: AbortSignal, identity?: BrowserSessionIdentity): Promise<unknown> {
    if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Invalid Desktop request");
    const { method, params } = request as { method: unknown; params: unknown };
    if (typeof method !== "string" || !Object.hasOwn(desktopMethods, method)) throw new Error("Unknown Desktop method");
    if (!Check(desktopMethods[method as DesktopMethod].parameters, params))
      throw new Error("Invalid Desktop parameters");
    if (Buffer.byteLength(JSON.stringify(request)) > 64 * 1024) throw new Error("Desktop request exceeds 64 KiB");
    const active = AbortSignal.any([
      signal,
      this.shutdown.signal,
      AbortSignal.timeout(method === "load_local_plugin" ? 60_000 : 15_000),
    ]);
    active.throwIfAborted();
    const result = await this.bounded(
      this.dispatch(method as DesktopMethod, params as Record<string, unknown>, active, identity),
      active,
    );
    if (Buffer.byteLength(JSON.stringify(result)) > (method === "screenshot" ? MAX_IMAGE : MAX_OUTPUT))
      throw new Error("Desktop output exceeds limit; request a smaller result");
    return result;
  }
  private async dispatch(
    method: DesktopMethod,
    params: Record<string, unknown>,
    signal: AbortSignal,
    identity?: BrowserSessionIdentity,
  ): Promise<unknown> {
    if (Object.hasOwn(desktopDevelopmentMethods, method)) {
      if (!this.development || !identity) throw new Error("Desktop development services unavailable");
      return this.development.call(method, params, identity, signal);
    }
    if (method === "get_settings") return this.settings.getConfig();
    if (method === "update_settings") {
      const current = await this.settings.getConfig();
      signal.throwIfAborted();
      return saveSettingsAndBroadcast(this.settings, {
        expectedRevision: params.expectedRevision as string,
        settings: { ...current.settings, ...(params.patch as Partial<DesktopSettings>) },
      });
    }
    if (method === "inspect")
      return {
        version: this.version,
        platform: process.platform,
        versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
        windows: [...this.windows.values()].filter((w) => !w.isDestroyed()).map((w) => this.windowState(w)),
      };
    const window =
      params.windowId === undefined
        ? ([...this.windows.values()].find((w) => !w.isDestroyed() && w.isFocused()) ??
          [...this.windows.values()].find((w) => !w.isDestroyed()))
        : this.windows.get(params.windowId as number);
    if (!window || window.isDestroyed() || window.webContents.isDestroyed())
      throw new Error("Desktop window is unavailable");
    const destroyed = new AbortController();
    const onDestroyed = () => destroyed.abort(new Error("Desktop window destroyed"));
    window.webContents.once("destroyed", onDestroyed);
    const windowSignal = AbortSignal.any([signal, destroyed.signal]);
    try {
      return await this.bounded(this.windowCall(window, method, params, windowSignal), windowSignal);
    } finally {
      window.webContents.off("destroyed", onDestroyed);
    }
  }
  private async windowCall(
    window: BrowserWindow,
    method: DesktopMethod,
    params: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    if (method === "navigation_state" || method === "navigate") {
      if (method === "navigate") {
        if (!isDesktopRoute(params.path as string)) throw new Error("Unsupported Desktop route");
        if (this.dirtyGuard.isDirty(window.webContents.id))
          throw new Error("Save or discard the current settings editor before navigation");
      }
      return window.webContents.executeJavaScript(
        `window.__desktopRuntimeRouter.${method === "navigate" ? `navigate(${JSON.stringify(params.path)})` : "state()"}`,
      );
    }
    if (method === "window_action") {
      switch (params.action) {
        case "show":
          window.show();
          break;
        case "focus":
          window.show();
          window.focus();
          break;
        case "minimize":
          window.minimize();
          break;
        case "maximize":
          window.maximize();
          break;
        case "restore":
          window.restore();
          break;
        case "set_bounds":
          if (!params.bounds) throw new Error("set_bounds requires bounds");
          window.setBounds(params.bounds as Electron.Rectangle);
          break;
        default:
          throw new Error("Invalid window action");
      }
      return this.windowState(window);
    }
    const debuggerState = this.ensureDebugger(window);
    if (method === "cdp_events") {
      const after = (params.after as number | undefined) ?? 0;
      const events: CdpEvent[] = [];
      let bytes = 0;
      for (const event of debuggerState.events) {
        if (event.sequence <= after) continue;
        const size = Buffer.byteLength(JSON.stringify(event));
        if (events.length >= ((params.limit as number | undefined) ?? 100) || bytes + size > 40 * 1024) break;
        events.push(event);
        bytes += size;
      }
      return {
        events,
        latestSequence: debuggerState.sequence,
        dropped: debuggerState.dropped,
      };
    }
    if (method === "screenshot") {
      const result = await window.webContents.debugger.sendCommand("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      });
      return { dataUrl: `data:image/png;base64,${result.data}` };
    }
    if (method === "evaluate") {
      const result = await window.webContents.debugger.sendCommand("Runtime.evaluate", {
        expression: params.expression,
        awaitPromise: true,
        returnByValue: true,
        timeout: 10_000,
      });
      if (result.exceptionDetails)
        throw new Error(`Desktop evaluation failed: ${JSON.stringify(result.exceptionDetails).slice(0, 4096)}`);
      return result;
    }
    if (method === "cdp_send") {
      const command = params.method as string;
      // Keep commands on this renderer; target/session creation and navigation use dedicated APIs.
      if (
        !/^(Accessibility|DOM|DOMSnapshot|CSS|Runtime|Input|Network|Log|Page|Emulation|Performance)\./.test(command) ||
        /^(Page\.(navigate|navigateToHistoryEntry|reload|close|crash|setWebLifecycleState)|Runtime\.(runIfWaitingForDebugger|terminateExecution))$/.test(
          command,
        )
      )
        throw new Error("Unsupported Desktop CDP command");
      const commandParams: unknown = JSON.parse((params.paramsJson as string | undefined) ?? "{}");
      if (!commandParams || typeof commandParams !== "object" || Array.isArray(commandParams))
        throw new Error("CDP paramsJson must contain an object");
      return window.webContents.debugger.sendCommand(command, commandParams);
    }
    throw new Error("Unsupported Desktop operation");
  }
  private windowState(window: BrowserWindow) {
    return {
      windowId: window.id,
      webContentsId: window.webContents.id,
      title: window.getTitle(),
      bounds: window.getBounds(),
      visible: window.isVisible(),
      focused: window.isFocused(),
      minimized: window.isMinimized(),
      maximized: window.isMaximized(),
    };
  }
  private ensureDebugger(window: BrowserWindow): DebuggerState {
    const existing = this.debuggers.get(window.id);
    if (existing) {
      if (!window.webContents.debugger.isAttached()) {
        window.webContents.debugger.attach("1.3");
        existing.dropped += existing.events.length;
        existing.events = [];
      }
      return existing;
    }
    if (window.webContents.debugger.isAttached())
      throw new Error("Desktop debugger is already owned by another client");
    window.webContents.debugger.attach("1.3");
    const state: DebuggerState = {
      events: [],
      sequence: 0,
      dropped: 0,
      owned: true,
      listener: (_event, method, params) => {
        state.sequence++;
        if (Buffer.byteLength(JSON.stringify(params ?? null)) > 8192) {
          state.dropped++;
          return;
        }
        state.events.push({ sequence: state.sequence, method, params });
        if (state.events.length > 200) {
          state.events.shift();
          state.dropped++;
        }
      },
    };
    window.webContents.debugger.on("message", state.listener);
    this.debuggers.set(window.id, state);
    return state;
  }
  private releaseDebugger(window: BrowserWindow): void {
    const state = this.debuggers.get(window.id);
    if (!state) return;
    this.debuggers.delete(window.id);
    window.webContents.debugger.off("message", state.listener);
    if (!window.webContents.isDestroyed() && state.owned && window.webContents.debugger.isAttached())
      window.webContents.debugger.detach();
  }
  private bounded<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener("abort", abort);
        reject(signal.reason ?? new Error("Desktop operation cancelled"));
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }
}
