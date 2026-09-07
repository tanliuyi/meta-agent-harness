import { basename } from "node:path";
import type { ExecOptions, ExecResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BrowserOpenTarget } from "./src/configuration.ts";
import { openDesktopBrowser as openEmbeddedBrowser } from "./desktop-browser.ts";

const ignoreDesktopShortcut: ExtensionAPI["registerShortcut"] = () => {};

export interface DesktopApiOptions {
  openBrowser?: (url: string, options?: ExecOptions) => Promise<ExecResult>;
}

/**
 * Wraps the pi-mcp-adapter's ExtensionAPI so its surface stays inside the
 * Desktop Host Profile:
 *
 * - `registerShortcut` is a no-op (Desktop does not support extension
 *   shortcuts).
 * - `registerTool` strips the TUI-only `renderCall` / `renderResult` callbacks;
 *   MCP tool results still render through the standard details payload.
 * - `exec` intercepts system-browser launches (`open`, `cmd /c start`,
 *   `xdg-open`) and, when `openBrowser` is provided, routes http(s) targets
 *   into the Desktop embedded browser, mirroring the upstream adapter's own
 *   `openUrl` behavior.
 */
export function createDesktopApi(pi: ExtensionAPI, options: DesktopApiOptions = {}): ExtensionAPI {
  const openBrowser = options.openBrowser;
  return new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "registerShortcut") return ignoreDesktopShortcut;
      if (property === "registerTool") return registerDesktopTool(pi);
      if (property === "exec") {
        const exec = Reflect.get(target, property, receiver) as ExtensionAPI["exec"];
        if (typeof exec !== "function") return exec;
        return (command: string, args: string[], execOptions?: ExecOptions) => {
          const url = browserOpenUrl(command, args);
          if (url && openBrowser) return openBrowser(url, execOptions);
          return exec.call(target, command, args, execOptions);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

export function resolveOpenBrowser(openTarget: BrowserOpenTarget | undefined): DesktopApiOptions["openBrowser"] {
  return openTarget === "builtin" ? openEmbeddedBrowser : undefined;
}

function registerDesktopTool(pi: ExtensionAPI): ExtensionAPI["registerTool"] {
  return (tool) => {
    const desktopTool = { ...tool };
    delete desktopTool.renderCall;
    delete desktopTool.renderResult;
    pi.registerTool(desktopTool);
  };
}

function browserOpenUrl(command: string, args: string[]): string | undefined {
  const executable = basename(command).toLowerCase();
  const matchesCommand =
    (process.platform === "darwin" && executable === "open") ||
    (process.platform === "win32" && executable === "cmd" && args[0]?.toLowerCase() === "/c") ||
    (process.platform !== "darwin" && process.platform !== "win32" && executable === "xdg-open");
  if (!matchesCommand) return undefined;
  const url = args.at(-1);
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}