import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  getAuthEntry,
  removeAuthEntry,
  resetAuthEntryCache,
  resetTestAuthSecretStore,
  saveAuthEntry,
} from "../vendor/pi-mcp-adapter/mcp-auth.ts";

/**
 * Desktop marketplace artifacts cannot ship the @napi-rs/keyring native
 * addon, so the vendored adapter falls back to a 0600 JSON file under the Pi
 * agent directory when PI_MCP_ADAPTER_AUTH_STORE=file is set (or when the OS
 * credential store is unavailable).
 */
test("OAuth credentials persist to the Desktop file store when configured", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-mcp-adapter-desktop-oauth-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  const previousStore = process.env.PI_MCP_ADAPTER_AUTH_STORE;
  const previousCache = process.env.PI_MCP_ADAPTER_DISABLE_AUTH_CACHE;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_MCP_ADAPTER_AUTH_STORE = "file";
  process.env.PI_MCP_ADAPTER_DISABLE_AUTH_CACHE = "1";
  try {
    resetTestAuthSecretStore();
    resetAuthEntryCache();

    saveAuthEntry("starship", { tokens: { accessToken: "tok-123" } }, "https://mcp.example.com");
    assert.equal(getAuthEntry("starship")?.tokens?.accessToken, "tok-123");

    const storeFile = join(agentDir, "mcp-oauth-credentials.json");
    assert.ok(existsSync(storeFile), "file credential store should exist under the agent dir");
    const parsed = JSON.parse(readFileSync(storeFile, "utf8")) as Record<string, string>;
    const account = `sha256-${createHash("sha256").update("starship").digest("hex")}`;
    const stored = JSON.parse(parsed[account]!) as { serverUrl?: string };
    assert.equal(stored.serverUrl, "https://mcp.example.com");

    // Remove clears the persisted entry.
    removeAuthEntry("starship");
    assert.equal(getAuthEntry("starship"), undefined);
    assert.equal(existsSync(storeFile), false);
  } finally {
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    if (previousStore === undefined) delete process.env.PI_MCP_ADAPTER_AUTH_STORE;
    else process.env.PI_MCP_ADAPTER_AUTH_STORE = previousStore;
    if (previousCache === undefined) delete process.env.PI_MCP_ADAPTER_DISABLE_AUTH_CACHE;
    else process.env.PI_MCP_ADAPTER_DISABLE_AUTH_CACHE = previousCache;
    rmSync(agentDir, { recursive: true, force: true });
  }
});