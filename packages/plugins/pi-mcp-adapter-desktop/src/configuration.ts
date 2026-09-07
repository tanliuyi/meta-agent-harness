import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type PluginConfigurationValue = string | number | boolean;

export type BrowserOpenTarget = "builtin" | "system";

interface PluginConfigurationFieldBase {
  key: string;
  label: string;
  description?: string;
  group?: string;
  order?: number;
  deprecated?: boolean;
  deprecatedMessage?: string;
  required?: boolean;
  widget?: "model-selector";
  modelFormat?: "model-id" | "provider-model";
}

export type PluginConfigurationField =
  | (PluginConfigurationFieldBase & {
      type: "text" | "textarea" | "path";
      defaultValue?: string;
      placeholder?: string;
      minLength?: number;
      maxLength?: number;
      pattern?: string;
      patternMessage?: string;
    })
  | (PluginConfigurationFieldBase & {
      type: "secret";
      placeholder?: string;
      minLength?: number;
      maxLength?: number;
      pattern?: string;
      patternMessage?: string;
    })
  | (PluginConfigurationFieldBase & {
      type: "number";
      defaultValue?: number;
      minimum?: number;
      maximum?: number;
      step?: number;
    })
  | (PluginConfigurationFieldBase & { type: "boolean"; defaultValue?: boolean })
  | (PluginConfigurationFieldBase & {
      type: "select";
      defaultValue?: string;
      options: Array<{ value: string; label: string; description?: string }>;
    });

export interface PluginConfigurationSchema {
  version: 1;
  fields: PluginConfigurationField[];
}

/**
 * Desktop 配置表单的扁平取值。key 与 schema 字段一致;`settings.*` 字段经
 * applyDesktopConfig 写回上游 mcp.json 的 settings 段。
 */
export interface DesktopMcpAdapterConfig {
  /** 覆盖 MCP 配置文件路径;默认按上游规则发现(~/.config/mcp/mcp.json 等)。 */
  configPath?: string;
  /** 浏览器(如 MCP UI 会话、OAuth 授权页)打开位置。 */
  "browser.openTarget"?: BrowserOpenTarget;
  directTools?: "keep" | "enabled" | "disabled";
  toolPrefix?: "keep" | "server" | "none" | "short" | "mcp";
  scriptMode?: boolean;
  freezeDirectTools?: boolean;
  strictDirectToolArguments?: boolean;
  approveTools?: "keep" | "all" | "none";
  autoAuth?: boolean;
  hostConfigDiscovery?: "keep" | "off" | "prompt" | "on";
  outputGuard?: boolean;
  /** 空闲断开时间(分钟);0 表示禁用空闲回收。 */
  idleTimeoutMinutes?: number;
  requestTimeoutMs?: number;
  mcpFooterStatus?: "keep" | "full" | "compact" | "off";
  toolResultRendering?: "keep" | "compact" | "boxed";
  collapsedResultLines?: "keep" | "1" | "2" | "3";
  notifyOnStartupConnect?: boolean;
  showStatusIcon?: boolean;
}

/**
 * Desktop 配置 schema。与上游 settings 对应字段的说明见
 * vendor/pi-mcp-adapter/types.ts 的 McpSettings。
 */
export const MCP_ADAPTER_CONFIGURATION_SCHEMA: PluginConfigurationSchema = {
  version: 1,
  fields: [
    {
      key: "configPath",
      label: "配置文件路径",
      type: "path",
      placeholder: "留空按默认规则发现",
      description: "覆盖 MCP 配置文件(mcp.json)路径;留空时按默认规则发现,包括 ~/.config/mcp/mcp.json、.mcp.json 与 Pi 全局配置。",
      group: "常规",
      order: 1,
    },
    {
      key: "browser.openTarget",
      label: "浏览器打开位置",
      type: "select",
      options: [
        { value: "builtin", label: "内置浏览器", description: "在当前 Desktop 会话的内置浏览器面板中打开" },
        { value: "system", label: "系统默认", description: "使用操作系统默认浏览器打开" },
      ],
      description: "MCP UI 会话与 OAuth 授权页的打开位置。",
      group: "常规",
      order: 2,
    },
    {
      key: "directTools",
      label: "直接工具",
      type: "select",
      options: [
        { value: "keep", label: "保持现状", description: "不修改 mcp.json 中的设置" },
        { value: "enabled", label: "启用", description: "每个 MCP 服务器的工具直接注册为独立工具" },
        { value: "disabled", label: "禁用", description: "只使用 mcp 代理工具访问服务器" },
      ],
      description: "是否把每个 MCP 服务器的工具注册为独立工具(默认按服务器 directTools 配置)。",
      group: "工具注册",
      order: 10,
    },
    {
      key: "toolPrefix",
      label: "工具前缀",
      type: "select",
      options: [
        { value: "keep", label: "保持现状" },
        { value: "server", label: "server", description: "工具名以服务器名命名空间前缀(默认)" },
        { value: "none", label: "none", description: "直接使用原始工具名" },
        { value: "short", label: "short", description: "短命名空间" },
        { value: "mcp", label: "mcp", description: "统一 mcp 命名空间" },
      ],
      description: "直接工具的前缀策略。",
      group: "工具注册",
      order: 11,
    },
    {
      key: "scriptMode",
      label: "启用 MCP 脚本工具",
      type: "boolean",
      description: "注册受信任的 mcpScript JavaScript 脚本工具;关闭后隐藏。",
      group: "工具注册",
      order: 12,
    },
    {
      key: "freezeDirectTools",
      label: "冻结直接工具注册",
      type: "boolean",
      description: "初始同步后冻结直接工具注册,保持系统提示前缀稳定;元数据更新和重连不再重建工具集合。",
      group: "工具注册",
      order: 13,
    },
    {
      key: "strictDirectToolArguments",
      label: "严格校验工具参数",
      type: "boolean",
      description: "对直接工具参数按服务器公布的模式做严格校验(默认关闭)。",
      group: "工具注册",
      order: 14,
    },
    {
      key: "approveTools",
      label: "工具调用批准",
      type: "select",
      options: [
        { value: "keep", label: "保持现状" },
        { value: "all", label: "全部自动批准", description: "匹配的工具/资源调用不再请求确认" },
        { value: "none", label: "全部需要批准", description: "匹配的工具/资源调用都需要确认" },
      ],
      description: "匹配工具的默认批准门控。",
      group: "安全与批准",
      order: 20,
    },
    {
      key: "autoAuth",
      label: "自动重新认证",
      type: "boolean",
      description: "服务器需要重新认证时自动触发 OAuth 流程。",
      group: "安全与批准",
      order: 21,
    },
    {
      key: "hostConfigDiscovery",
      label: "宿主配置发现",
      type: "select",
      options: [
        { value: "keep", label: "保持现状" },
        { value: "off", label: "off", description: "不发现其他工具宿主(如 Claude/Codex)的 MCP 配置(默认)" },
        { value: "prompt", label: "prompt", description: "检测到其他宿主配置时询问导入" },
        { value: "on", label: "on", description: "直接读取并合并其他宿主的 MCP 配置" },
      ],
      description: "是否发现并导入其他工具宿主的 MCP 配置文件。",
      group: "安全与批准",
      order: 22,
    },
    {
      key: "outputGuard",
      label: "输出守护",
      type: "boolean",
      description: "限制超大 MCP 工具/资源输出返回给模型(默认开启,50 KiB / 2,000 行)。",
      group: "安全与批准",
      order: 23,
    },
    {
      key: "idleTimeoutMinutes",
      label: "空闲超时(分钟)",
      type: "number",
      minimum: 0,
      maximum: 1440,
      step: 1,
      description: "服务器空闲断连时间,默认 10 分钟;0 表示禁用空闲回收。",
      group: "连接",
      order: 30,
    },
    {
      key: "requestTimeoutMs",
      label: "请求超时(毫秒)",
      type: "number",
      minimum: 0,
      maximum: 3_600_000,
      step: 1000,
      description: "覆盖 SDK 请求超时;0 或留空使用 SDK 默认值。",
      group: "连接",
      order: 31,
    },
    {
      key: "notifyOnStartupConnect",
      label: "启动连接通知",
      type: "boolean",
      description: "服务器启动连接成功时发送通知(默认开启)。",
      group: "界面",
      order: 40,
    },
    {
      key: "showStatusIcon",
      label: "状态图标",
      type: "boolean",
      description: "在 MCP 状态与连接文本中显示插件图标前缀(默认开启)。",
      group: "界面",
      order: 41,
    },
    {
      key: "mcpFooterStatus",
      label: "状态栏显示",
      type: "select",
      options: [
        { value: "keep", label: "保持现状" },
        { value: "full", label: "full", description: "详细状态,含连接/禁用数量(默认)" },
        { value: "compact", label: "compact", description: "精简的已连接/已启用数量" },
        { value: "off", label: "off", description: "不显示 MCP 状态栏" },
      ],
      description: "状态栏 MCP 信息粒度。",
      group: "界面",
      order: 42,
    },
    {
      key: "toolResultRendering",
      label: "结果渲染模式",
      type: "select",
      options: [
        { value: "keep", label: "保持现状" },
        { value: "compact", label: "compact", description: "自渲染的紧凑行(默认)" },
        { value: "boxed", label: "boxed", description: "传统方框行" },
      ],
      description: "MCP 工具结果的渲染模式。",
      group: "界面",
      order: 43,
    },
    {
      key: "collapsedResultLines",
      label: "结果折叠行数",
      type: "select",
      options: [
        { value: "keep", label: "保持现状" },
        { value: "1", label: "1 行" },
        { value: "2", label: "2 行" },
        { value: "3", label: "3 行" },
      ],
      description: "结果折叠前显示的行数。",
      group: "界面",
      order: 44,
    },
  ],
};

type JsonObject = Record<string, unknown>;

/** 与上游 agent-dir.ts 保持一致的 Pi agent 目录解析。 */
function readRebrandConfig(): { name?: unknown; configDir?: unknown } | undefined {
  const dir = process.env.PI_PACKAGE_DIR?.trim();
  if (!dir) return undefined;
  try {
    const manifest = JSON.parse(readFileSync(join(resolve(dir), "package.json"), "utf8")) as {
      piConfig?: { name?: unknown; configDir?: unknown };
    };
    return manifest.piConfig;
  } catch {
    return undefined;
  }
}

export function getMcpConfigPath(): string {
  const rebrand = readRebrandConfig();
  const configDir = typeof rebrand?.configDir === "string" && rebrand.configDir.trim() ? rebrand.configDir.trim() : ".pi";
  const appName = typeof rebrand?.name === "string" && rebrand.name.trim() ? rebrand.name.trim() : "pi";
  const configured = process.env[`${appName.toUpperCase()}_CODING_AGENT_DIR`]?.trim();
  let agentDir: string;
  if (!configured) {
    agentDir = join(homedir(), configDir, "agent");
  } else if (configured === "~") {
    agentDir = homedir();
  } else if (configured.startsWith("~/")) {
    agentDir = resolve(homedir(), configured.slice(2));
  } else {
    agentDir = resolve(configured);
  }
  return join(agentDir, "mcp.json");
}

/** 嵌套 key(含点号)写入目标对象。 */
function setNested(target: JsonObject, key: string, value: unknown): void {
  const segments = key.split(".");
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    const next = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
    cursor[segment] = next;
    cursor = next as JsonObject;
  }
  cursor[segments.at(-1)!] = value;
}

function readExisting(path: string): JsonObject {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as JsonObject;
    return {};
  } catch {
    return {};
  }
}

function atomicWrite(path: string, value: JsonObject): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const source = `${JSON.stringify(value, null, 2)}\n`;
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, source, { mode: 0o600 });
  try {
    renameSync(temp, path);
  } catch {
    rmSync(temp, { force: true });
    writeFileSync(path, source, { mode: 0o600 });
  }
}

const SETTINGS_SELECT_MAPPINGS: Record<string, Record<string, unknown> | undefined> = {
  directTools: { keep: undefined, enabled: true, disabled: false },
  toolPrefix: { keep: undefined, server: "server", none: "none", short: "short", mcp: "mcp" },
  approveTools: { keep: undefined, all: true, none: false },
  hostConfigDiscovery: { keep: undefined, off: "off", prompt: "prompt", on: "on" },
  mcpFooterStatus: { keep: undefined, full: "full", compact: "compact", off: "off" },
  toolResultRendering: { keep: undefined, compact: "compact", boxed: "boxed" },
  collapsedResultLines: { keep: undefined, "1": 1, "2": 2, "3": 3 },
};

/** Desktop 表单 key -> mcp.json settings key。 */
const SETTINGS_KEY_MAPPINGS: Record<string, string> = {
  idleTimeoutMinutes: "idleTimeout",
  requestTimeoutMs: "requestTimeoutMs",
  scriptMode: "scriptMode",
  freezeDirectTools: "freezeDirectTools",
  strictDirectToolArguments: "strictDirectToolArguments",
  autoAuth: "autoAuth",
  outputGuard: "outputGuard",
  notifyOnStartupConnect: "notifyOnStartupConnect",
  showStatusIcon: "showStatusIcon",
};

/**
 * 将桌面配置表单中 settings 相关字段合并写入上游 mcp.json 的 settings 段。
 * 只覆盖用户显式设置的字段,保留文件中的 mcpServers、imports 与其他设置。
 */
export function applyDesktopConfig(config: DesktopMcpAdapterConfig | undefined): JsonObject {
  if (!config || typeof config !== "object") return {};
  const path = getMcpConfigPath();
  const target = readExisting(path);
  const previous = JSON.stringify(target);

  let settings: JsonObject =
    target.settings && typeof target.settings === "object" && !Array.isArray(target.settings)
      ? { ...(target.settings as JsonObject) }
      : {};

  for (const entry of Object.entries(config)) {
    const [key, value] = entry;
    if (key === "configPath" || key === "browser.openTarget") continue;
    if (value === undefined) continue;

    const selectMapping = SETTINGS_SELECT_MAPPINGS[key];
    if (selectMapping) {
      if (typeof value === "string" && selectMapping[value] !== undefined) {
        settings[key] = selectMapping[value];
      } else if (value === "keep") {
        delete settings[key];
      }
      continue;
    }

    const settingsKey = SETTINGS_KEY_MAPPINGS[key] ?? key;
    if (typeof value === "string" && value.trim().length === 0) {
      delete settings[settingsKey];
    } else if (typeof value === "string") {
      settings[settingsKey] = value.trim();
    } else {
      settings[settingsKey] = value;
    }
  }

  if (Object.keys(settings).length > 0) target.settings = settings;
  if (JSON.stringify(target) === previous) return target;
  atomicWrite(path, target);
  return target;
}

/** 获取配置中显式设置的 configPath(去空白);未设置为 undefined。 */
export function getExplicitConfigPath(config: DesktopMcpAdapterConfig | undefined): string | undefined {
  const value = config?.configPath?.trim();
  return value ? resolve(value) : undefined;
}