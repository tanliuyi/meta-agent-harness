export const BUILTIN_MAIN_AGENT_ID = "desktop-default";
export const MAIN_AGENT_CONFIG_VERSION = 1;
export const MAIN_AGENT_SNAPSHOT_VERSION = 1;

export type MainAgentPromptMode = "default" | "append" | "replace";

export interface MainAgentConfiguration {
  prompt: {
    mode: MainAgentPromptMode;
    text: string;
    includeGlobalRules: boolean;
    includeProjectRules: boolean;
    includeSkills: boolean;
  };
  /** Built-in tool selection only; enabled plugin tools are always admitted. null uses SDK/settings defaults, [] disables built-in tools. */
  tools: string[] | null;
  /** null preserves the Desktop built-in feature defaults. */
  builtinPluginIds: string[] | null;
}

export interface MainAgentProfile {
  id: string;
  revision: number;
  name: string;
  description: string;
  builtin: boolean;
  configuration: MainAgentConfiguration;
}

export interface MainAgentStoreSnapshot {
  version: typeof MAIN_AGENT_CONFIG_VERSION;
  revision: string;
  defaultAgentId: string;
  profiles: MainAgentProfile[];
}

export interface MainAgentSelection {
  id: string;
  revision: number;
}

/** Draft-only source. Session creation still accepts an explicit profile or inherits by omission. */
export type MainAgentDraftSelection = MainAgentSelection | { kind: "inherit-parent"; parentThreadId: string };

export interface MainAgentSessionSnapshot {
  version: typeof MAIN_AGENT_SNAPSHOT_VERSION;
  profileId: string;
  profileRevision: number;
  profileName: string;
  configuration: MainAgentConfiguration;
  createdAt: number;
}

export function assertMainAgentConfiguration(value: unknown): asserts value is MainAgentConfiguration {
  if (!value || typeof value !== "object") throw new Error("Main agent configuration is invalid");
  const configuration = value as MainAgentConfiguration;
  if (
    !configuration.prompt ||
    !["default", "append", "replace"].includes(configuration.prompt.mode) ||
    typeof configuration.prompt.text !== "string" ||
    (configuration.prompt.mode === "replace" && !configuration.prompt.text.trim()) ||
    [
      configuration.prompt.includeGlobalRules,
      configuration.prompt.includeProjectRules,
      configuration.prompt.includeSkills,
    ].some((flag) => typeof flag !== "boolean") ||
    !validMainAgentIds(configuration.tools) ||
    !validMainAgentIds(configuration.builtinPluginIds)
  )
    throw new Error("Main agent configuration is invalid");
}

export function assertMainAgentSessionSnapshot(value: unknown): asserts value is MainAgentSessionSnapshot {
  if (!value || typeof value !== "object") throw new Error("Main agent snapshot is invalid");
  const snapshot = value as MainAgentSessionSnapshot;
  if (
    snapshot.version !== MAIN_AGENT_SNAPSHOT_VERSION ||
    typeof snapshot.profileId !== "string" ||
    snapshot.profileId.trim().length === 0 ||
    !Number.isSafeInteger(snapshot.profileRevision) ||
    snapshot.profileRevision < 1 ||
    typeof snapshot.profileName !== "string" ||
    snapshot.profileName.trim().length === 0 ||
    !Number.isFinite(snapshot.createdAt)
  )
    throw new Error("Main agent snapshot version or identity is invalid");
  assertMainAgentConfiguration(snapshot.configuration);
}

function validMainAgentIds(value: unknown): value is string[] | null {
  return (
    value === null ||
    (Array.isArray(value) &&
      value.every((item) => typeof item === "string" && item.trim().length > 0) &&
      new Set(value).size === value.length)
  );
}

export interface MainAgentCatalog {
  tools: Array<{
    id: string;
    name: string;
    source: "builtin" | "extension";
    available: boolean;
    reason?: string;
  }>;
  builtinPlugins: Array<{
    id: string;
    name: string;
    description: string;
    available: boolean;
    reason?: string;
  }>;
}

export interface MainAgentDraftContext {
  selection: MainAgentSelection;
  profiles: Array<Pick<MainAgentProfile, "id" | "revision" | "name" | "description" | "builtin">>;
  snapshot: MainAgentSessionSnapshot;
  tools: Array<{ id: string; source: "builtin" | "extension"; available: boolean; reason?: string }>;
  builtinPlugins: Array<{ id: string; name: string; enabled: boolean; available: boolean; reason?: string }>;
  promptSources: Array<{
    kind: "default" | "user" | "append" | "global-rules" | "project-rules" | "skills" | "plugin";
    state: "included" | "excluded" | "dynamic";
  }>;
}

export type MainAgentMutationInput =
  | { action: "create"; expectedRevision: string; profile: Omit<MainAgentProfile, "id" | "revision" | "builtin"> }
  | { action: "duplicate"; expectedRevision: string; id: string; name?: string }
  | { action: "update"; expectedRevision: string; profile: MainAgentProfile }
  | { action: "delete"; expectedRevision: string; id: string }
  | { action: "set-default"; expectedRevision: string; id: string }
  | { action: "reset-builtin"; expectedRevision: string };

export type MainAgentMutationResult =
  | { status: "saved"; snapshot: MainAgentStoreSnapshot }
  | { status: "conflict"; current: MainAgentStoreSnapshot };
