import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionFactory,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { controlledResourceLoaderOptions } from "../src/main/pi/desktop-extension-runtime-policy.ts";
import { resolveMainAgentConfiguration } from "../src/main/pi/main-agent-resolver.ts";
import type { ResolvedExtensionSet } from "../src/shared/desktop-extension-contracts.ts";

const roots: string[] = [];
const extensionTools = ["compress", "decompress", "search_context", "acp_status", "run_code"];

const factory: ExtensionFactory = (pi) => {
  pi.on("session_before_compact", () => ({ cancel: true }));
  pi.on("before_agent_start", (event) => ({ systemPrompt: `${event.systemPrompt}\nUse compress` }));
  for (const name of extensionTools) {
    pi.registerTool({
      name,
      label: name,
      description: name,
      parameters: Type.Object({}),
      async execute() {
        return { content: [{ type: "text", text: "ok" }] };
      },
    });
  }
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("main agent native extension tool admission", () => {
  it.each(["builtin", "development"] as const)(
    "keeps %s plugin tools available with any basic tool selection, including after reload",
    async (source) => {
      const root = await mkdtemp(join(tmpdir(), "desktop-extension-admission-"));
      roots.push(root);
      const entryPath = join(root, "extension.mjs");
      await writeFile(
        entryPath,
        `export default function(pi) {
          pi.on("session_before_compact", () => ({ cancel: true }));
          pi.on("before_agent_start", event => ({ systemPrompt: event.systemPrompt + " Use compress" }));
          for (const name of ${JSON.stringify(extensionTools)}) pi.registerTool({
            name, label: name, description: name, parameters: { type: "object", properties: {} },
            async execute() { return { content: [{ type: "text", text: "ok" }] }; }
          });
        }`,
      );
      const set: ResolvedExtensionSet = {
        projectId: "test",
        generation: "test",
        entries: [
          {
            id: "test-acp",
            displayName: "Test ACP",
            source,
            hostProfileVersion: 1,
            capabilities: ["tools.register", "events.subscribe"],
            ...(source === "development" ? { entryPath } : {}),
          },
        ],
        diagnostics: [],
      };
      for (const allowedToolNames of [[], ["read", "grep"], ["read", "run_code"], undefined]) {
        const resolved = resolveMainAgentConfiguration(
          {
            version: 1,
            profileId: "test",
            profileRevision: 1,
            profileName: "Test",
            createdAt: 1,
            configuration: {
              prompt: {
                mode: "default",
                text: "",
                includeGlobalRules: true,
                includeProjectRules: true,
                includeSkills: true,
              },
              tools: allowedToolNames ?? null,
              builtinPluginIds: null,
            },
          },
          set,
          root,
        );
        const settingsManager = SettingsManager.inMemory();
        const loader = new DefaultResourceLoader({
          cwd: root,
          agentDir: root,
          settingsManager,
          ...controlledResourceLoaderOptions(set, source === "builtin" ? [{ name: "desktop:test-acp", factory }] : [], {
            includeBuiltinSkills: false,
          }),
        });
        await loader.reload();
        if (resolved.tools !== undefined) settingsManager.applyOverrides({ defaultTools: resolved.tools });
        const { session } = await createAgentSession({
          cwd: root,
          agentDir: root,
          resourceLoader: loader,
          settingsManager,
          sessionManager: SessionManager.inMemory(root),
          excludeTools: resolved.excludedTools,
        });
        await session.bindExtensions({});

        for (let attempt = 0; attempt < 2; attempt++) {
          const loaded = loader.getExtensions();
          expect(loaded.errors).toEqual([]);
          expect(loaded.extensions).toHaveLength(1);
          expect([...loaded.extensions[0].tools.keys()]).toEqual(extensionTools);
          expect(loaded.extensions[0].handlers.has("session_before_compact")).toBe(true);
          expect(loaded.extensions[0].handlers.has("before_agent_start")).toBe(true);

          const expectedTools = extensionTools;
          expect(
            session
              .getAllTools()
              .map(({ name }) => name)
              .filter((name) => extensionTools.includes(name)),
          ).toEqual(expectedTools);
          expect(session.getActiveToolNames()).toEqual(expect.arrayContaining(extensionTools));
          if (allowedToolNames !== undefined) {
            expect(
              session
                .getActiveToolNames()
                .filter((name) => !extensionTools.includes(name))
                .sort(),
            ).toEqual((resolved.tools ?? []).slice().sort());
          }
          if (attempt === 0) await session.reload();
        }
        session.dispose();
      }
    },
  );
});
