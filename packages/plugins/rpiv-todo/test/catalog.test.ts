import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

interface PluginCatalog {
  schemaVersion: number;
  pluginId: string;
  methods: Array<{
    name: string;
    parameters: {
      properties: { action?: { anyOf?: Array<{ const: string }> } };
      required?: string[];
      additionalProperties?: boolean;
    };
    concurrency: string;
  }>;
}

interface MarketManifest {
  plugin: { id: string };
  pi: {
    skills: string[];
    runCode: { skill: string; catalog: string };
  };
  capabilities: string[];
  files: Record<string, { mode: string }>;
}

const packageRoot = new URL("../", import.meta.url);

test("declares todo as a generation-scoped run_code method", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("market-manifest.json", packageRoot), "utf8"),
  ) as MarketManifest;
  const catalog = JSON.parse(await readFile(new URL("plugin-api.json", packageRoot), "utf8")) as PluginCatalog;

  assert.equal(manifest.plugin.id, "rpiv.todo");
  assert.deepEqual(manifest.pi.runCode, { skill: "rpiv-todo", catalog: "plugin-api.json" });
  assert.deepEqual(manifest.pi.skills, ["skills/rpiv-todo/SKILL.md"]);
  assert.ok(manifest.capabilities.includes("plugin-methods.provide"));
  assert.ok(!manifest.capabilities.includes("tools.register"));
  assert.equal(manifest.files["plugin-api.json"]?.mode, "0644");
  assert.equal(manifest.files["skills/rpiv-todo/SKILL.md"]?.mode, "0644");
  assert.equal(manifest.files["skills/rpiv-todo/references/api.md"]?.mode, "0644");

  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.pluginId, manifest.plugin.id);
  assert.equal(catalog.methods.length, 1);
  const method = catalog.methods[0];
  assert.equal(method?.name, "todo");
  assert.deepEqual(method?.parameters.required, ["action"]);
  assert.equal(method?.parameters.additionalProperties, false);
  assert.deepEqual(method?.parameters.properties.action?.anyOf?.map((option) => option.const), [
    "create",
    "update",
    "list",
    "get",
    "delete",
    "clear",
  ]);
  assert.equal(method?.concurrency, "serial");
});
