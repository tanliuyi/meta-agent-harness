import { describe, expect, it } from "vitest";
import { DesktopBuiltinProviderRegistry } from "../src/main/pi/desktop-builtin-provider.ts";
import { validatePluginSkills } from "../src/main/pi/desktop-extension-runtime-policy.ts";
import {
  mainAgentDraftContext,
  resolveMainAgentConfiguration,
  snapshotMainAgent,
} from "../src/main/pi/main-agent-resolver.ts";
import type { ResolvedExtensionSet } from "../src/shared/desktop-extension-contracts.ts";
import type { MainAgentSessionSnapshot, MainAgentStoreSnapshot } from "../src/shared/main-agent-contracts.ts";

const set: ResolvedExtensionSet = {
  generation: "generation",
  projectId: "project",
  entries: [
    {
      id: "pi-hermes-memory",
      displayName: "Memory",
      source: "builtin",
      hostProfileVersion: 1,
      capabilities: ["events.subscribe"],
    },
    {
      id: "pi-browser",
      displayName: "Browser",
      source: "builtin",
      hostProfileVersion: 1,
      capabilities: ["plugin-methods.provide"],
      runCodeSkill: "browser",
      skillPaths: ["/browser"],
    },
    {
      id: "pi-rewind",
      displayName: "Rewind",
      source: "builtin",
      hostProfileVersion: 1,
      capabilities: ["events.subscribe"],
    },
    {
      id: "third-party",
      displayName: "Third party",
      source: "marketplace",
      hostProfileVersion: 1,
      capabilities: ["tools.register"],
      entryPath: "/plugin.js",
    },
  ],
  diagnostics: [],
  resolvedAt: 0,
};

function snapshot(overrides: Partial<MainAgentSessionSnapshot["configuration"]> = {}): MainAgentSessionSnapshot {
  return {
    version: 1,
    profileId: "profile",
    profileRevision: 3,
    profileName: "Profile",
    createdAt: 1,
    configuration: {
      prompt: {
        mode: "replace",
        text: "/literal/existing/path",
        includeGlobalRules: false,
        includeProjectRules: true,
        includeSkills: false,
      },
      tools: [],
      builtinPluginIds: [],
      ...overrides,
    },
  };
}

describe("main agent resolver", () => {
  it("fully replaces discovered SYSTEM and APPEND while retaining literal user text", () => {
    const resolved = resolveMainAgentConfiguration(snapshot(), set, "/agent");
    expect(resolved.resourceLoaderOptions.systemPromptOverride?.("discovered system contents")).toBe(
      "/literal/existing/path",
    );
    expect(resolved.resourceLoaderOptions.appendSystemPromptOverride?.(["discovered append contents"])).toEqual([]);
    expect(resolved.tools).toEqual([]);
    expect(resolved.resourceLoaderOptions.skillsOverride?.({ skills: [{} as never], diagnostics: [] })).toEqual({
      skills: [],
      diagnostics: [],
    });
  });

  it("filters configurable built-ins but preserves rewind and third-party plugin policy", () => {
    const resolved = resolveMainAgentConfiguration(snapshot(), set, "/agent");
    expect(resolved.extensionSet.entries.map(({ id }) => id)).toEqual(["pi-rewind", "third-party"]);
  });

  it("allows global and project rules independently", () => {
    const resolved = resolveMainAgentConfiguration(snapshot(), set, "/agent");
    const filtered = resolved.resourceLoaderOptions.agentsFilesOverride?.({
      agentsFiles: [
        { path: "/agent/AGENTS.md", content: "global" },
        { path: "/project/AGENTS.md", content: "project" },
      ],
    });
    expect(filtered?.agentsFiles).toEqual([{ path: "/project/AGENTS.md", content: "project" }]);
  });

  it("validates an enabled browser skill even when the model-visible skill list is empty", () => {
    const browser = DesktopBuiltinProviderRegistry.getExtensionDefinitions().find(({ id }) => id === "pi-browser");
    if (!browser) throw new Error("browser definition missing");
    expect(validatePluginSkills({ ...set, entries: [browser] }, { skills: [], diagnostics: [] })).toEqual([]);
  });

  it("keeps disabled built-ins available when they exist in the raw candidate catalog", () => {
    const store: MainAgentStoreSnapshot = {
      version: 1,
      revision: "store",
      defaultAgentId: "profile",
      profiles: [
        {
          id: "profile",
          revision: 3,
          name: "Profile",
          description: "",
          builtin: false,
          configuration: snapshot().configuration,
        },
      ],
    };
    const effective = resolveMainAgentConfiguration(snapshot(), set, "/agent").extensionSet;
    const context = mainAgentDraftContext(store, snapshot(), effective, set);

    expect(context.builtinPlugins.find(({ id }) => id === "pi-browser")).toMatchObject({
      enabled: false,
      available: true,
      name: "Browser",
    });
    expect(context.builtinPlugins.find(({ id }) => id === "pi-auto-title")).toMatchObject({
      enabled: false,
      available: false,
    });
  });

  it("rejects a changed draft revision instead of switching profiles", () => {
    const store: MainAgentStoreSnapshot = {
      version: 1,
      revision: "store",
      defaultAgentId: "profile",
      profiles: [
        {
          id: "profile",
          revision: 4,
          name: "Profile",
          description: "",
          builtin: false,
          configuration: snapshot().configuration,
        },
      ],
    };
    expect(() => snapshotMainAgent(store, { id: "profile", revision: 3 })).toThrow("profile changed");
  });
});
