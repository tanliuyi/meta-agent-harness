import { resolve } from "node:path";
import { createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { resolveDevelopmentEntry } from "../src/main/extensions/desktop-extension-directory.ts";
import { controlledResourceLoaderOptions } from "../src/main/pi/desktop-extension-runtime-policy.ts";
import { DesktopPluginRegistryBuilder } from "../src/main/pi/run-code/plugin-method-registry.ts";
import { RunCodeRegistryHolder } from "../src/main/pi/run-code/run-code-tool.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const PLUGIN_ROOT = resolve(REPO_ROOT, "packages/plugins/rpiv-todo");

describe("rpiv todo Desktop plugin", () => {
  it("captures todo as a run_code method without exposing a direct Pi tool", async () => {
    const resolved = await resolveDevelopmentEntry(PLUGIN_ROOT);
    const entry = {
      id: "development:rpiv.todo",
      displayName: resolved.displayName,
      displayPath: resolved.displayPath,
      source: "development" as const,
      hostProfileVersion: 1 as const,
      configuration: {},
      ...resolved,
    };
    const set = {
      generation: "rpiv-todo-test",
      projectId: "project",
      entries: [entry],
      diagnostics: [],
      resolvedAt: Date.now(),
    };
    const builder = new DesktopPluginRegistryBuilder();
    const holder = new RunCodeRegistryHolder(set.generation);
    try {
      const services = await createAgentSessionServices({
        cwd: REPO_ROOT,
        resourceLoaderOptions: controlledResourceLoaderOptions(set, [], {
          includeBuiltinSkills: false,
          pluginRegistry: holder,
          pluginRegistryBuilder: builder,
          cwd: REPO_ROOT,
        }),
      });
      const extensions = services.resourceLoader.getExtensions();
      expect(extensions.errors).toEqual([]);
      const toolNames = extensions.extensions.flatMap((extension) => [...extension.tools.keys()]);
      expect(toolNames).toContain("run_code");
      expect(toolNames).not.toContain("todo");
      expect(services.resourceLoader.getSkills().skills.map((skill) => skill.name)).toContain("rpiv-todo");

      expect(builder.finalize().get("rpiv.todo")?.has("todo")).toBe(true);
    } finally {
      await holder.dispose();
    }
  });
});
