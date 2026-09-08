import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createMcpAdapter } from "pi-mcp-adapter";
import { applyDesktopConfig, getExplicitConfigPath, type DesktopMcpAdapterConfig } from "./src/configuration.ts";
import { createDesktopApi, resolveOpenBrowser } from "./desktop-api.ts";

interface DesktopExtensionAPI extends ExtensionAPI {
  getConfig<T = DesktopMcpAdapterConfig>(): Readonly<T>;
}

/**
 * pi-mcp-adapter Desktop 插件入口。
 *
 * 以标准 Pi Extension 工厂形态注册,加载 pi-mcp-adapter 的完整 MCP 能力
 * (mcp 代理工具、直接工具、mcpScript、/mcp 命令、OAuth、MCP UI 会话),
 * 并通过 createDesktopApi 将扩展 surface 约束在 Desktop Host Profile v1 内。
 */
export default function piMcpAdapterDesktop(pi: ExtensionAPI): void {
  const hostApi = pi as Partial<DesktopExtensionAPI>;
  const config = typeof hostApi.getConfig === "function" ? hostApi.getConfig<DesktopMcpAdapterConfig>() : {};
  applyDesktopConfig(config);
  const configPath = getExplicitConfigPath(config);
  const adapter = createMcpAdapter(configPath ? { configPath } : {});
  adapter(createDesktopApi(pi, { openBrowser: resolveOpenBrowser(config?.["browser.openTarget"]) }));
}