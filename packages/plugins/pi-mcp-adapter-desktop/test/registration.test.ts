import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import piMcpAdapterDesktop from "../index.ts";

function withCleanAgentDir(run: () => void): void {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-mcp-adapter-desktop-test-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(agentDir, { recursive: true, force: true });
  }
}

test("registers Desktop-compatible MCP tools, commands, flags, and lifecycle handlers", () => {
  withCleanAgentDir(() => {
    const tools: ToolDefinition[] = [];
    const commands: string[] = [];
    const flags: string[] = [];
    const events: string[] = [];
    let shortcutRegistrations = 0;
    const pi = {
      getConfig() {
        return {};
      },
      getFlag() {
        return undefined;
      },
      registerTool(tool: ToolDefinition) {
        tools.push(tool);
      },
      registerCommand(name: string) {
        commands.push(name);
      },
      registerFlag(name: string) {
        flags.push(name);
      },
      registerShortcut() {
        shortcutRegistrations += 1;
      },
      on(event: string) {
        events.push(event);
      },
      events: {
        on() {},
        emit() {},
      },
      getAllTools() {
        return [];
      },
      getActiveTools() {
        return undefined;
      },
      setActiveTools() {},
      unregisterTool() {
        return false;
      },
      sendMessage() {},
    } as unknown as ExtensionAPI;

    piMcpAdapterDesktop(pi);

    const commandNames = [...commands].sort();
    assert.deepEqual(commandNames, ["mcp", "mcp-auth", "pi-mcp"]);
    assert.deepEqual(flags, ["mcp-config"]);
    assert.ok(events.includes("session_start"));
    assert.ok(events.includes("session_shutdown"));
    assert.ok(events.includes("tool_result"));
    assert.equal(shortcutRegistrations, 0);

    // 无 MCP 服务器配置时注册 mcp 代理工具与 mcpScript 工具,且不携带 TUI 渲染回调。
    const proxyTool = tools.find((tool) => tool.name === "mcp");
    assert.ok(proxyTool, "expected the mcp proxy tool to be registered");
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      ["mcp", "mcpScript"],
    );
    assert.equal(proxyTool.renderCall, undefined);
    assert.equal(proxyTool.renderResult, undefined);
  });
});