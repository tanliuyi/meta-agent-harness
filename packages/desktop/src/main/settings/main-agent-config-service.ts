import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import {
  assertMainAgentConfiguration,
  BUILTIN_MAIN_AGENT_ID,
  MAIN_AGENT_CONFIG_VERSION,
  type MainAgentCatalog,
  type MainAgentConfiguration,
  type MainAgentMutationInput,
  type MainAgentMutationResult,
  type MainAgentProfile,
  type MainAgentStoreSnapshot,
} from "../../shared/main-agent-contracts.ts";

export const MISSING_MAIN_AGENT_REVISION = "missing:main-agents-v1";
export const CONFIGURABLE_BUILTIN_PLUGIN_IDS = [
  "desktop",
  "pi-hermes-memory",
  "pi-subagents",
  "pi-auto-title",
  "pi-goal",
  "pi-browser",
] as const;

const MAIN_AGENT_CATALOG: MainAgentCatalog = {
  tools: [
    ...["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"].map((id) => ({
      id,
      name: id,
      source: "builtin" as const,
      available: true,
    })),
  ],
  builtinPlugins: [
    { id: "desktop", name: "Desktop Runtime", description: "通过 run_code 检查和控制 Desktop 应用" },
    { id: "pi-hermes-memory", name: "记忆", description: "注入记忆并运行复盘、纠错和索引能力" },
    { id: "pi-subagents", name: "子智能体", description: "提供任务委派能力；执行者仍使用各自的工具配置" },
    { id: "pi-auto-title", name: "自动标题", description: "按全局自动标题设置为会话生成标题" },
    { id: "pi-goal", name: "目标", description: "提供会话目标工具和命令" },
    { id: "pi-browser", name: "浏览器", description: "向会话提供浏览器方法和相关说明" },
  ].map((plugin) => ({ ...plugin, available: true })),
};

export const DEFAULT_MAIN_AGENT_CONFIGURATION: MainAgentConfiguration = Object.freeze({
  prompt: Object.freeze({
    mode: "default",
    text: "",
    includeGlobalRules: true,
    includeProjectRules: true,
    includeSkills: true,
  }),
  tools: null,
  builtinPluginIds: null,
});

interface StoredMainAgents {
  version: 1;
  defaultAgentId: string;
  profiles: MainAgentProfile[];
}

export class MainAgentConfigService {
  readonly path: string;
  private saveTail: Promise<void> = Promise.resolve();

  constructor(userDataDir: string) {
    this.path = join(userDataDir, "main-agents.json");
  }

  async getSnapshot(): Promise<MainAgentStoreSnapshot> {
    const current = await this.readCurrent();
    return snapshot(current.data, current.revision);
  }

  getCatalog(): MainAgentCatalog {
    return structuredClone(MAIN_AGENT_CATALOG);
  }

  validateProfile(profile: Omit<MainAgentProfile, "id" | "revision" | "builtin">) {
    return normalizeProfile(profile);
  }

  mutate(input: MainAgentMutationInput): Promise<MainAgentMutationResult> {
    const operation = this.saveTail.then(() => this.mutateLocked(input));
    this.saveTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async mutateLocked(input: MainAgentMutationInput): Promise<MainAgentMutationResult> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(this.path, { realpath: false, stale: 30_000, retries: 6 });
    try {
      const current = await this.readCurrent();
      if (input.expectedRevision !== current.revision)
        return { status: "conflict", current: snapshot(current.data, current.revision) };
      const data = structuredClone(current.data);
      switch (input.action) {
        case "create":
          data.profiles.push({ ...normalizeProfile(input.profile), id: randomUUID(), revision: 1, builtin: false });
          break;
        case "duplicate": {
          const source = requireProfile(data, input.id);
          data.profiles.push({
            ...structuredClone(source),
            id: randomUUID(),
            revision: 1,
            builtin: false,
            name: normalizeName(input.name ?? `${source.name} 副本`),
          });
          break;
        }
        case "update": {
          const existing = requireProfile(data, input.profile.id);
          if (existing.builtin !== input.profile.builtin || existing.revision !== input.profile.revision)
            throw new Error("Main agent profile revision is stale");
          data.profiles[data.profiles.indexOf(existing)] = {
            ...normalizeProfile(input.profile),
            id: existing.id,
            builtin: existing.builtin,
            revision: existing.revision + 1,
          };
          break;
        }
        case "delete":
          if (input.id === BUILTIN_MAIN_AGENT_ID) throw new Error("The built-in main agent cannot be deleted");
          requireProfile(data, input.id);
          data.profiles = data.profiles.filter((profile) => profile.id !== input.id);
          if (data.defaultAgentId === input.id) data.defaultAgentId = BUILTIN_MAIN_AGENT_ID;
          break;
        case "set-default":
          requireProfile(data, input.id);
          data.defaultAgentId = input.id;
          break;
        case "reset-builtin": {
          const builtin = requireProfile(data, BUILTIN_MAIN_AGENT_ID);
          data.profiles[data.profiles.indexOf(builtin)] = builtinProfile(builtin.revision + 1);
          break;
        }
      }
      validateData(data);
      await this.atomicWrite(`${JSON.stringify(data, null, 2)}\n`);
      return { status: "saved", snapshot: await this.getSnapshot() };
    } finally {
      await release();
    }
  }

  private async readCurrent(): Promise<{ data: StoredMainAgents; revision: string }> {
    try {
      const info = await lstat(this.path);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("main-agents.json must be a regular file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { data: defaultData(), revision: MISSING_MAIN_AGENT_REVISION };
      throw error;
    }
    const bytes = await readFile(this.path);
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error("main-agents.json JSON syntax invalid");
    }
    validateData(value);
    return { data: value, revision: createHash("sha256").update(bytes).digest("hex") };
  }

  private async atomicWrite(source: string): Promise<void> {
    const directory = dirname(this.path);
    const temporary = join(directory, `.main-agents.${process.pid}.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(source, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, this.path);
      await chmod(this.path, 0o600).catch(() => undefined);
    } finally {
      await handle?.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}

function defaultData(): StoredMainAgents {
  return { version: MAIN_AGENT_CONFIG_VERSION, defaultAgentId: BUILTIN_MAIN_AGENT_ID, profiles: [builtinProfile(1)] };
}
function builtinProfile(revision: number): MainAgentProfile {
  return {
    id: BUILTIN_MAIN_AGENT_ID,
    revision,
    name: "默认智能体",
    description: "保持 Desktop 的默认提示词、工具和内置功能行为",
    builtin: true,
    configuration: structuredClone(DEFAULT_MAIN_AGENT_CONFIGURATION),
  };
}
function snapshot(data: StoredMainAgents, revision: string): MainAgentStoreSnapshot {
  return { ...structuredClone(data), revision };
}
function requireProfile(data: StoredMainAgents, id: string): MainAgentProfile {
  const profile = data.profiles.find((candidate) => candidate.id === id);
  if (!profile) throw new Error(`Main agent profile not found: ${id}`);
  return profile;
}
function normalizeName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 80) throw new Error("Main agent name must be 1-80 characters");
  return name;
}
function normalizeProfile(profile: Omit<MainAgentProfile, "id" | "revision" | "builtin"> | MainAgentProfile) {
  return {
    name: normalizeName(profile.name),
    description: profile.description.trim().slice(0, 500),
    configuration: normalizeConfiguration(profile.configuration),
  };
}
function normalizeConfiguration(value: MainAgentConfiguration): MainAgentConfiguration {
  if (value?.prompt?.mode === "replace" && typeof value.prompt.text === "string" && !value.prompt.text.trim())
    throw new Error("Replacement prompt must not be blank");
  assertMainAgentConfiguration(value);
  const tools = normalizeIds(value.tools, "tools");
  const builtinPluginIds = normalizeIds(value.builtinPluginIds, "builtinPluginIds");
  if (
    builtinPluginIds?.some(
      (id) => !CONFIGURABLE_BUILTIN_PLUGIN_IDS.includes(id as (typeof CONFIGURABLE_BUILTIN_PLUGIN_IDS)[number]),
    )
  )
    throw new Error("Unknown configurable built-in plugin");
  return { prompt: { ...value.prompt }, tools, builtinPluginIds };
}
function normalizeIds(value: string[] | null, field: string): string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id.trim()))
    throw new Error(`Invalid main agent ${field}`);
  return [...new Set(value.map((id) => id.trim()))];
}
function validateData(value: unknown): asserts value is StoredMainAgents {
  if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1)
    throw new Error("main-agents.json version is unsupported");
  const data = value as StoredMainAgents;
  if (typeof data.defaultAgentId !== "string" || !Array.isArray(data.profiles))
    throw new Error("Invalid main-agents.json structure");
  const ids = new Set<string>();
  for (const profile of data.profiles) {
    if (
      !profile ||
      typeof profile.id !== "string" ||
      ids.has(profile.id) ||
      !Number.isSafeInteger(profile.revision) ||
      profile.revision < 1 ||
      typeof profile.builtin !== "boolean"
    )
      throw new Error("Invalid main agent profile");
    ids.add(profile.id);
    normalizeProfile(profile);
  }
  if (
    !ids.has(BUILTIN_MAIN_AGENT_ID) ||
    data.profiles.find((profile) => profile.id === BUILTIN_MAIN_AGENT_ID)?.builtin !== true ||
    !ids.has(data.defaultAgentId)
  )
    throw new Error("Invalid main agent defaults");
}
