import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Context, InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  DefaultResourceLoader,
  type InlineExtension,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopBuiltinProviderRegistry } from "../src/main/pi/desktop-builtin-provider.ts";
import { controlledResourceLoaderOptions } from "../src/main/pi/desktop-extension-runtime-policy.ts";
import { resolveMainAgentConfiguration } from "../src/main/pi/main-agent-resolver.ts";
import type { ResolvedExtensionSet } from "../src/shared/desktop-extension-contracts.ts";
import type { MainAgentSessionSnapshot } from "../src/shared/main-agent-contracts.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("main agent real runtime contract", () => {
  it("applies prompt, tools, skills, and disabled built-ins through real Pi resources", async () => {
    const root = join(tmpdir(), `desktop-main-agent-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    roots.push(root);
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    const projectConfig = join(cwd, ".pi");
    const skillDir = join(agentDir, "skills", "visible-skill");
    await Promise.all([mkdir(projectConfig, { recursive: true }), mkdir(skillDir, { recursive: true })]);
    const literalPromptPath = join(root, "literal-prompt.txt");
    await Promise.all([
      writeFile(literalPromptPath, "FILE CONTENT MUST NOT REPLACE THE PATH\n"),
      writeFile(join(agentDir, "SYSTEM.md"), "DISCOVERED SYSTEM MUST BE REMOVED\n"),
      writeFile(join(agentDir, "APPEND_SYSTEM.md"), "DISCOVERED APPEND MUST BE REMOVED\n"),
      writeFile(join(agentDir, "AGENTS.md"), "GLOBAL RULE VISIBLE WHEN ENABLED\n"),
      writeFile(join(cwd, "AGENTS.md"), "PROJECT RULE VISIBLE WHEN ENABLED\n"),
      writeFile(
        join(skillDir, "SKILL.md"),
        "---\nname: visible-skill\ndescription: Visible runtime skill\n---\nUse this skill.\n",
      ),
    ]);

    const candidateSet = extensionSet();
    const disabled = resolveMainAgentConfiguration(snapshot(literalPromptPath, false), candidateSet, agentDir);
    const disabledBuiltinIds = new Set(
      disabled.extensionSet.entries.filter(({ source }) => source === "builtin").map(({ id }) => id),
    );
    const disabledFactories = DesktopBuiltinProviderRegistry.getExtensionFactories({
      enabledExtensionIds: disabledBuiltinIds,
      allowChildMemory: false,
    });
    const disabledFactoryNames = disabledFactories.map((factory) =>
      typeof factory === "function" ? "" : factory.name,
    );
    expect(disabledFactoryNames).not.toContain("desktop:pi-hermes-memory");
    expect(disabledFactoryNames).not.toContain("desktop:pi-browser");

    const faux = registerFauxProvider({ tokensPerSecond: 100_000 });
    try {
      const credentials = new InMemoryCredentialStore();
      await credentials.modify(faux.getModel().provider, async () => ({ type: "api_key", key: "faux-key" }));
      const modelRuntime = await ModelRuntime.create({
        credentials,
        modelsPath: null,
        modelsStore: new InMemoryModelsStore(),
        allowModelNetwork: false,
      });
      modelRuntime.registerProvider(faux.getModel().provider, {
        baseUrl: faux.getModel().baseUrl,
        apiKey: "faux-key",
        api: faux.api,
        models: faux.models,
      });
      await modelRuntime.refresh({ allowNetwork: false });
      const settingsManager = SettingsManager.inMemory();
      const hookPrompts: string[] = [];
      const providerFactory: InlineExtension = {
        name: "desktop:faux-runtime-contract",
        factory: (api) => {
          api.on("before_agent_start", (event) => {
            hookPrompts.push(event.systemPrompt);
          });
          api.registerProvider(faux.getModel().provider, {
            baseUrl: faux.getModel().baseUrl,
            apiKey: "faux-key",
            api: faux.api,
            models: faux.models,
          });
        },
      };
      const controlledOptions = controlledResourceLoaderOptions(disabled.extensionSet, disabledFactories, {
        allowRunCode: false,
        cwd,
        agentDir,
      });
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager,
        ...controlledOptions,
        extensionFactories: [...controlledOptions.extensionFactories, providerFactory],
        ...disabled.resourceLoaderOptions,
        noPromptTemplates: true,
        noThemes: true,
      });
      await loader.reload();
      const { session } = await createAgentSession({
        cwd,
        agentDir,
        modelRuntime,
        model: faux.getModel(),
        resourceLoader: loader,
        settingsManager,
        sessionManager: SessionManager.inMemory(cwd),
        tools: disabled.tools,
      });
      await session.bindExtensions({});
      let providerContext: Context | undefined;
      faux.setResponses([
        (context) => {
          providerContext = context;
          return fauxAssistantMessage("done");
        },
      ]);
      await session.prompt("verify runtime");

      expect(session.agent.state.tools).toEqual([]);
      expect(providerContext?.systemPrompt).toContain(literalPromptPath);
      expect(providerContext?.systemPrompt).not.toContain("FILE CONTENT MUST NOT REPLACE THE PATH");
      expect(providerContext?.systemPrompt).not.toContain("DISCOVERED SYSTEM MUST BE REMOVED");
      expect(providerContext?.systemPrompt).not.toContain("DISCOVERED APPEND MUST BE REMOVED");
      expect(providerContext?.systemPrompt).not.toContain("GLOBAL RULE VISIBLE WHEN ENABLED");
      expect(providerContext?.systemPrompt).not.toContain("PROJECT RULE VISIBLE WHEN ENABLED");
      expect(providerContext?.systemPrompt).not.toContain("visible-skill");
      expect(providerContext?.systemPrompt).not.toContain("run_code");
      const loadedExtensionPaths = loader.getExtensions().extensions.map(({ path }) => path);
      expect(loadedExtensionPaths.some((path) => path.includes("pi-hermes-memory"))).toBe(false);
      expect(loadedExtensionPaths.some((path) => path.includes("pi-browser"))).toBe(false);

      await session.reload();
      faux.setResponses([fauxAssistantMessage("disabled reloaded")]);
      await session.prompt("verify disabled reload");
      const reloadedDisabledPrompt = hookPrompts.at(-1);
      expect(session.agent.state.tools).toEqual([]);
      expect(reloadedDisabledPrompt).toContain(literalPromptPath);
      expect(reloadedDisabledPrompt).not.toContain("DISCOVERED SYSTEM MUST BE REMOVED");
      expect(reloadedDisabledPrompt).not.toContain("DISCOVERED APPEND MUST BE REMOVED");
      expect(reloadedDisabledPrompt).not.toContain("GLOBAL RULE VISIBLE WHEN ENABLED");
      expect(reloadedDisabledPrompt).not.toContain("PROJECT RULE VISIBLE WHEN ENABLED");
      expect(reloadedDisabledPrompt).not.toContain("visible-skill");
      expect(reloadedDisabledPrompt).not.toContain("run_code");
      session.dispose();

      const enabled = resolveMainAgentConfiguration(snapshot("Configured base", true), candidateSet, agentDir);
      const enabledLoader = new DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager,
        noExtensions: true,
        ...enabled.resourceLoaderOptions,
        noPromptTemplates: true,
        noThemes: true,
      });
      await enabledLoader.reload();
      const { session: enabledSession } = await createAgentSession({
        cwd,
        agentDir,
        modelRuntime,
        model: faux.getModel(),
        resourceLoader: enabledLoader,
        settingsManager,
        sessionManager: SessionManager.inMemory(cwd),
        tools: enabled.tools,
      });
      await enabledSession.bindExtensions({});
      await enabledSession.reload();
      expect(enabledSession.systemPrompt).toContain("GLOBAL RULE VISIBLE WHEN ENABLED");
      expect(enabledSession.systemPrompt).toContain("PROJECT RULE VISIBLE WHEN ENABLED");
      expect(enabledSession.systemPrompt).toContain("visible-skill");
      enabledSession.dispose();
    } finally {
      faux.unregister();
    }
  }, 30_000);
});

function snapshot(prompt: string, includeContext: boolean): MainAgentSessionSnapshot {
  return {
    version: 1,
    profileId: "runtime-contract",
    profileRevision: 1,
    profileName: "Runtime contract",
    createdAt: 1,
    configuration: {
      prompt: {
        mode: "replace",
        text: prompt,
        includeGlobalRules: includeContext,
        includeProjectRules: includeContext,
        includeSkills: includeContext,
      },
      tools: includeContext ? ["read"] : [],
      builtinPluginIds: [],
    },
  };
}

function extensionSet(): ResolvedExtensionSet {
  const entries = DesktopBuiltinProviderRegistry.getExtensionDefinitions().filter(({ id }) =>
    ["pi-hermes-memory", "pi-browser"].includes(id),
  );
  return {
    generation: "runtime-contract",
    projectId: "project",
    entries,
    diagnostics: [],
    resolvedAt: 0,
  };
}
