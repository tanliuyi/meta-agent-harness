import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applyDesktopConfig,
  getExplicitConfigPath,
  getMcpConfigPath,
  type DesktopMcpAdapterConfig,
} from "../src/configuration.ts";

function withTmpAgentDir(run: (agentDir: string) => void): void {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-mcp-adapter-desktop-config-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    run(agentDir);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(agentDir, { recursive: true, force: true });
  }
}

test("settings are written into the Pi-owned mcp.json without touching servers", () => {
  withTmpAgentDir((agentDir) => {
    mkdirSync(agentDir, { recursive: true });
    const filePath = getMcpConfigPath();
    assert.equal(filePath, join(agentDir, "mcp.json"));
    writeFileSync(filePath, JSON.stringify({ mcpServers: { demo: { command: "demo-mcp" } } }, null, 2));

    const config: DesktopMcpAdapterConfig = {
      directTools: "enabled",
      toolPrefix: "server",
      idleTimeoutMinutes: 25,
      mcpFooterStatus: "compact",
      hostConfigDiscovery: "off",
    };
    applyDesktopConfig(config);

    const written = JSON.parse(readFileSync(filePath, "utf8")) as {
      mcpServers: Record<string, unknown>;
      settings?: Record<string, unknown>;
    };
    assert.deepEqual(written.mcpServers, { demo: { command: "demo-mcp" } });
    assert.deepEqual(written.settings, {
      directTools: true,
      toolPrefix: "server",
      idleTimeout: 25,
      mcpFooterStatus: "compact",
      hostConfigDiscovery: "off",
    });
  });
});

test("keep selections and empty config do not modify the settings section", () => {
  withTmpAgentDir((agentDir) => {
    mkdirSync(agentDir, { recursive: true });
    const filePath = getMcpConfigPath();
    writeFileSync(filePath, JSON.stringify({ settings: { scriptMode: false } }, null, 2));

    applyDesktopConfig({ directTools: "keep", toolPrefix: "keep" });

    const written = JSON.parse(readFileSync(filePath, "utf8")) as { settings?: Record<string, unknown> };
    assert.deepEqual(written.settings, { scriptMode: false });
  });
});

test("approveTools, result rendering, and collapsed lines map to settings values", () => {
  withTmpAgentDir((agentDir) => {
    mkdirSync(agentDir, { recursive: true });
    const filePath = getMcpConfigPath();
    applyDesktopConfig({
      approveTools: "all",
      toolResultRendering: "boxed",
      collapsedResultLines: "2",
      requestTimeoutMs: 60_000,
    });

    const written = JSON.parse(readFileSync(filePath, "utf8")) as { settings?: Record<string, unknown> };
    assert.deepEqual(written.settings, {
      approveTools: true,
      toolResultRendering: "boxed",
      collapsedResultLines: 2,
      requestTimeoutMs: 60_000,
    });
  });
});

test("getExplicitConfigPath resolves only a non-empty configPath", () => {
  assert.equal(getExplicitConfigPath({}), undefined);
  assert.equal(getExplicitConfigPath({ configPath: "  " }), undefined);
  const resolved = getExplicitConfigPath({ configPath: "./custom-mcp.json" });
  assert.equal(resolved, join(process.cwd(), "custom-mcp.json"));
});