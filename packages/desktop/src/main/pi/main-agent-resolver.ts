import { isAbsolute, relative, resolve } from "node:path";
import type { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import type { ResolvedExtensionSet } from "../../shared/desktop-extension-contracts.ts";
import type {
  MainAgentDraftContext,
  MainAgentSelection,
  MainAgentSessionSnapshot,
  MainAgentStoreSnapshot,
} from "../../shared/main-agent-contracts.ts";
import { assertMainAgentSessionSnapshot } from "../../shared/main-agent-contracts.ts";
import { CONFIGURABLE_BUILTIN_PLUGIN_IDS } from "../settings/main-agent-config-service.ts";

export const MAIN_AGENT_TOOL_CATALOG = ["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"] as const;

export interface ResolvedMainAgentConfiguration {
  snapshot: MainAgentSessionSnapshot;
  extensionSet: ResolvedExtensionSet;
  tools: string[] | undefined;
  excludedTools: string[] | undefined;
  resourceLoaderOptions: Pick<
    ConstructorParameters<typeof DefaultResourceLoader>[0],
    "systemPromptOverride" | "appendSystemPromptOverride" | "agentsFilesOverride" | "skillsOverride"
  >;
}

export function snapshotMainAgent(
  store: MainAgentStoreSnapshot,
  selection?: MainAgentSelection,
  now = Date.now(),
): MainAgentSessionSnapshot {
  const id = selection?.id ?? store.defaultAgentId;
  const profile = store.profiles.find((candidate) => candidate.id === id);
  if (!profile) throw stale(`Main agent profile was deleted: ${id}`);
  if (selection && profile.revision !== selection.revision) throw stale(`Main agent profile changed: ${id}`);
  return {
    version: 1,
    profileId: profile.id,
    profileRevision: profile.revision,
    profileName: profile.name,
    configuration: structuredClone(profile.configuration),
    createdAt: now,
  };
}

export function resolveMainAgentConfiguration(
  snapshot: MainAgentSessionSnapshot,
  set: ResolvedExtensionSet,
  agentDir: string,
): ResolvedMainAgentConfiguration {
  assertMainAgentSessionSnapshot(snapshot);
  const resolvedExtensionSet = filterMainAgentExtensionSet(snapshot, set);
  const prompt = snapshot.configuration.prompt;
  const resourceLoaderOptions: ResolvedMainAgentConfiguration["resourceLoaderOptions"] = {
    agentsFilesOverride: ({ agentsFiles }) => ({
      agentsFiles: agentsFiles.filter(({ path }) =>
        isWithin(path, agentDir) ? prompt.includeGlobalRules : prompt.includeProjectRules,
      ),
    }),
    ...(prompt.includeSkills ? {} : { skillsOverride: () => ({ skills: [], diagnostics: [] }) }),
  };
  if (prompt.mode === "append") resourceLoaderOptions.appendSystemPromptOverride = (base) => [...base, prompt.text];
  if (prompt.mode === "replace") {
    resourceLoaderOptions.systemPromptOverride = () => prompt.text;
    resourceLoaderOptions.appendSystemPromptOverride = () => [];
  }
  return {
    snapshot: structuredClone(snapshot),
    extensionSet: resolvedExtensionSet,
    tools:
      snapshot.configuration.tools === null
        ? undefined
        : MAIN_AGENT_TOOL_CATALOG.filter((name) => snapshot.configuration.tools?.includes(name)),
    excludedTools:
      snapshot.configuration.tools === null
        ? undefined
        : MAIN_AGENT_TOOL_CATALOG.filter((name) => !snapshot.configuration.tools?.includes(name)),
    resourceLoaderOptions,
  };
}

export function mainAgentDraftContext(
  store: MainAgentStoreSnapshot,
  snapshot: MainAgentSessionSnapshot,
  set: ResolvedExtensionSet,
  candidateSet: ResolvedExtensionSet = set,
  extensionToolIds: readonly string[] = [],
): MainAgentDraftContext {
  const configured = snapshot.configuration.builtinPluginIds;
  const availableToolIds = new Set<string>([
    ...MAIN_AGENT_TOOL_CATALOG,
    ...extensionToolIds,
    ...(set.entries.some((entry) => entry.capabilities.includes("plugin-methods.provide")) ? ["run_code"] : []),
  ]);
  const configuredToolIds = snapshot.configuration.tools ?? [];
  const toolIds = [...new Set([...availableToolIds, ...configuredToolIds])];
  return {
    selection: { id: snapshot.profileId, revision: snapshot.profileRevision },
    profiles: store.profiles.map(({ id, revision, name, description, builtin }) => ({
      id,
      revision,
      name,
      description,
      builtin,
    })),
    snapshot,
    tools: toolIds.map((id) => ({
      id,
      source: MAIN_AGENT_TOOL_CATALOG.includes(id as (typeof MAIN_AGENT_TOOL_CATALOG)[number])
        ? "builtin"
        : "extension",
      available: availableToolIds.has(id),
      ...(availableToolIds.has(id) ? {} : { reason: "Not registered by the current extension set" }),
    })),
    builtinPlugins: CONFIGURABLE_BUILTIN_PLUGIN_IDS.map((id) => ({
      id,
      name: candidateSet.entries.find((entry) => entry.id === id)?.displayName ?? id,
      enabled: configured === null || configured.includes(id),
      available: candidateSet.entries.some((entry) => entry.id === id),
      ...(candidateSet.entries.some((entry) => entry.id === id)
        ? {}
        : { reason: "Not available in the installed extension catalog" }),
    })),
    promptSources: [
      { kind: promptKind(snapshot), state: "included" },
      { kind: "append", state: snapshot.configuration.prompt.mode === "replace" ? "excluded" : "included" },
      { kind: "global-rules", state: snapshot.configuration.prompt.includeGlobalRules ? "included" : "excluded" },
      { kind: "project-rules", state: snapshot.configuration.prompt.includeProjectRules ? "included" : "excluded" },
      { kind: "skills", state: snapshot.configuration.prompt.includeSkills ? "included" : "excluded" },
      ...(set.entries.some((entry) => entry.capabilities.includes("events.subscribe"))
        ? [{ kind: "plugin" as const, state: "dynamic" as const }]
        : []),
    ],
  };
}

function filterMainAgentExtensionSet(
  snapshot: MainAgentSessionSnapshot,
  set: ResolvedExtensionSet,
): ResolvedExtensionSet {
  const enabled =
    snapshot.configuration.builtinPluginIds === null ? null : new Set(snapshot.configuration.builtinPluginIds);
  return {
    ...set,
    entries: set.entries.filter(
      (entry) =>
        entry.source !== "builtin" ||
        !CONFIGURABLE_BUILTIN_PLUGIN_IDS.includes(entry.id as (typeof CONFIGURABLE_BUILTIN_PLUGIN_IDS)[number]) ||
        enabled === null ||
        enabled.has(entry.id),
    ),
  };
}

function isWithin(path: string, parent: string): boolean {
  const child = resolve(path);
  const root = resolve(parent);
  const result = relative(root, child);
  return result === "" || (!result.startsWith("..") && !isAbsolute(result));
}
function promptKind(snapshot: MainAgentSessionSnapshot): "default" | "user" {
  return snapshot.configuration.prompt.mode === "default" ? "default" : "user";
}
function stale(message: string): Error & { code: "STALE_MAIN_AGENT" } {
  return Object.assign(new Error(message), { code: "STALE_MAIN_AGENT" as const });
}
