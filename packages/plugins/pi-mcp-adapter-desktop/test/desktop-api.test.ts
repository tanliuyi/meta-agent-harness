import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { defineTool, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createDesktopApi, resolveOpenBrowser } from "../desktop-api.ts";

function fakePi(overrides: Partial<ExtensionAPI> = {}): ExtensionAPI {
  return {
    getConfig() {
      return {};
    },
    registerTool() {},
    registerCommand() {},
    registerShortcut() {},
    exec() {
      return { stdout: "", stderr: "", code: 0, killed: false };
    },
    on() {},
    events: { on() {}, emit() {} },
    ...overrides,
  } as unknown as ExtensionAPI;
}

test("registerTool strips TUI render callbacks before registration", () => {
  const registered: ToolDefinition<any, any, any>[] = [];
  const pi = fakePi({
    registerTool(tool) {
      registered.push(tool);
    },
  });
  const desktop = createDesktopApi(pi);
  const tool = defineTool({
    name: "demo",
    label: "Demo",
    description: "demo tool",
    parameters: {},
    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
    renderCall: (() => undefined) as unknown as ToolDefinition["renderCall"],
    renderResult: (() => undefined) as unknown as ToolDefinition["renderResult"],
  });
  desktop.registerTool(tool as never);

  assert.equal(registered.length, 1);
  assert.equal(registered[0]!.renderCall, undefined);
  assert.equal(registered[0]!.renderResult, undefined);
});

test("registerShortcut becomes a no-op", () => {
  let shortcutRegistrations = 0;
  const pi = fakePi({
    registerShortcut() {
      shortcutRegistrations += 1;
    },
  });
  const desktop = createDesktopApi(pi);
  desktop.registerShortcut("ctrl+x" as never, {
    description: "demo shortcut",
    handler: async () => undefined,
  });
  assert.equal(shortcutRegistrations, 0);
});

test("exec routes system browser launches to the embedded browser when enabled", async () => {
  const execCalls: Array<{ command: string; args: string[] }> = [];
  const openCalls: string[] = [];
  const pi = fakePi({
    exec(command, args) {
      execCalls.push({ command, args });
      return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false });
    },
  });
  const desktop = createDesktopApi(pi, {
    openBrowser: async (url) => {
      openCalls.push(url);
      return { stdout: "", stderr: "", code: 0, killed: false };
    },
  });

  const isWindows = process.platform === "win32";
  const browserCommand = isWindows ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const browserArgs = isWindows ? ["/c", "start", "", "https://example.com/auth"] : ["https://example.com/auth"];

  await desktop.exec(browserCommand, browserArgs);
  assert.deepEqual(openCalls, ["https://example.com/auth"]);
  assert.equal(execCalls.length, 0);

  // 非浏览器命令走原始 exec。
  await desktop.exec("node", ["--version"]);
  assert.equal(execCalls.length, 1);
  assert.equal(execCalls[0]!.command, "node");

  // 非 http(s) URL 不拦截。
  await desktop.exec(browserCommand, isWindows ? ["/c", "start", "", "/local/path"] : ["/local/path"]);
  assert.equal(execCalls.length, 2);
});

test("browser interception is disabled without an openBrowser handler", async () => {
  const execCalls: string[] = [];
  const pi = fakePi({
    exec(command) {
      execCalls.push(command);
      return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false });
    },
  });
  const desktop = createDesktopApi(pi);
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  await desktop.exec(command, ["https://example.com/x"]);
  assert.deepEqual(execCalls, [command]);
});

test("resolveOpenBrowser honors the browser.openTarget configuration", () => {
  assert.equal(resolveOpenBrowser(undefined), undefined);
  assert.equal(resolveOpenBrowser("system"), undefined);
  assert.ok(typeof resolveOpenBrowser("builtin") === "function");
});