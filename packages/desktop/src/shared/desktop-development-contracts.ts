import { Type } from "typebox";

const text = Type.String({ minLength: 1, maxLength: 200 });
const ids = Type.Union([Type.Null(), Type.Array(text, { maxItems: 64, uniqueItems: true })]);
export const mainAgentConfigurationSchema = Type.Object(
  {
    prompt: Type.Object(
      {
        mode: Type.Union([Type.Literal("default"), Type.Literal("append"), Type.Literal("replace")]),
        text: Type.String({ maxLength: 32768 }),
        includeGlobalRules: Type.Boolean(),
        includeProjectRules: Type.Boolean(),
        includeSkills: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    tools: ids,
    builtinPluginIds: ids,
  },
  { additionalProperties: false },
);
const profile = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 80 }),
    description: Type.String({ maxLength: 500 }),
    configuration: mainAgentConfigurationSchema,
  },
  { additionalProperties: false },
);
const mutation = Type.Union([
  Type.Object({ action: Type.Literal("create"), expectedRevision: text, profile }, { additionalProperties: false }),
  Type.Object(
    {
      action: Type.Literal("update"),
      expectedRevision: text,
      profile: Type.Object(
        { ...profile.properties, id: text, revision: Type.Integer({ minimum: 1 }), builtin: Type.Boolean() },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal("set-default"), expectedRevision: text, id: text },
    { additionalProperties: false },
  ),
]);
const versioned = { requestId: text, expectedRevision: text };
export const desktopDevelopmentMethods = {
  main_agents: {
    description:
      "List bounded main-agent profile summaries/default, store revision, tool/plugin catalog and configuration schema. Use nextOffset for more summaries and get_main_agent for complete profiles.",
    parameters: Type.Object(
      {
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      },
      { additionalProperties: false },
    ),
  },
  get_main_agent: {
    description:
      "Read one complete profile, or a byte-bounded serialized JSON chunk when large. Join chunk strings until nextOffset=null, then JSON.parse. Offset counts UTF-16 code units. Pass expectedRevision on subsequent reads; conflict returns the new store revision.",
    parameters: Type.Object(
      { id: text, offset: Type.Optional(Type.Integer({ minimum: 0 })), expectedRevision: Type.Optional(text) },
      { additionalProperties: false },
    ),
  },
  validate_main_agent: {
    description:
      "Validate a main-agent profile without saving, using the persistent service normalizer. Returns valid and normalized name without echoing large configuration.",
    parameters: Type.Object({ profile }, { additionalProperties: false }),
  },
  save_main_agent: {
    description:
      "Create/update a main-agent profile or set the default through the main-agent configuration service. Uses expectedRevision. Returns bounded saved status, store revision and affected profile identity; conflict returns status and current store revision. Configuration applies to new sessions.",
    parameters: Type.Object({ mutation }, { additionalProperties: false }),
  },
  plugins: {
    description:
      "Read persisted extension approvals/Developer Mode and current worker generation, reloadRequired and diagnostics. Persisted settings do not prove loaded state.",
    parameters: Type.Object({}, { additionalProperties: false }),
  },
  set_developer_mode: {
    description: "Enable/disable Developer Mode; persists through existing extension settings service.",
    parameters: Type.Object({ ...versioned, enabled: Type.Boolean() }, { additionalProperties: false }),
  },
  load_local_plugin: {
    description:
      "Open the existing host file/directory approval dialog at path, then approve the user's selected local extension. Requires Developer Mode. Returns persisted approval; schedule reload separately.",
    parameters: Type.Object(
      { ...versioned, path: Type.String({ minLength: 1, maxLength: 4096 }) },
      { additionalProperties: false },
    ),
  },
  plugin_configuration: {
    description:
      "Read validated plugin configuration schema, non-secret values and secret-presence flags. Use development:<id> for local approvals or canonical marketplace ID.",
    parameters: Type.Object({ pluginId: text }, { additionalProperties: false }),
  },
  save_plugin_configuration: {
    description:
      "Validate/save plugin configuration through the existing service. valuesJson contains non-secret scalars; optional secretValuesJson contains secret strings encrypted by the host. Return invalid/conflict/saved, then schedule reload to apply.",
    parameters: Type.Object(
      {
        ...versioned,
        pluginId: text,
        valuesJson: Type.String({ maxLength: 32768 }),
        secretValuesJson: Type.Optional(Type.String({ maxLength: 32768 })),
        clearSecrets: Type.Optional(Type.Array(text, { maxItems: 64, uniqueItems: true })),
      },
      { additionalProperties: false },
    ),
  },
  plugin_runtime: {
    description:
      "Inspect actual loaded extensions, captured methods/catalog, native tools, skills and diagnostics of the calling worker. Optional pluginId filters method details. Does not return secret config.",
    parameters: Type.Object({ pluginId: Type.Optional(text) }, { additionalProperties: false }),
  },
  reload_plugins: {
    description:
      "Schedule a reload of the calling worker after the agent has settled, commands completed and metadata persisted. Returns scheduled, never applied. Optional continuation prompts the reloaded agent to verify runtime; end this turn to reach the safe point.",
    parameters: Type.Object(
      { requestId: text, continuation: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })) },
      { additionalProperties: false },
    ),
  },
  reload_status: {
    description:
      "Read a reload request's scheduled/applying/applied/failed status and worker generation. Requests are retained for the application lifetime (bounded history).",
    parameters: Type.Object({ requestId: text }, { additionalProperties: false }),
  },
} as const;

export interface DesktopReloadStatus {
  requestId: string;
  projectId: string;
  threadId: string;
  state: "scheduled" | "applying" | "applied" | "failed";
  previousWorkerInstanceId: string;
  workerInstanceId?: string;
  generation?: string;
  error?: string;
  continuation?: string;
  continuationAccepted?: boolean;
}
