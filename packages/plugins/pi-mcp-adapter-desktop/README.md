# Pi MCP Adapter Desktop

这是 [`pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter) 的 Meta Agent Desktop Host Profile v1 适配入口。

## Marketplace 描述

发布到插件市场时使用的描述（marketplace ID `meta-agent-development`，publisher `admin`，插件 `pi.mcp-adapter`）：

> 为桌面端提供 MCP（Model Context Protocol）服务器接入能力：直接工具注册、`mcp` 代理工具、`mcpScript` 脚本、`/mcp`、`/mcp-auth` 命令、OAuth 授权（内置浏览器打开授权页）与 MCP UI 会话。支持从 `~/.config/mcp/mcp.json`、`.mcp.json`、Claude/Codex 等宿主配置导入服务器。

## 桌面配置

插件声明了 Marketplace 配置 schema（`MCP_ADAPTER_CONFIGURATION_SCHEMA`，18 个字段）。从市场安装后，Desktop 会在 **Plugin detail > 配置** 渲染表单，并把用户保存的值通过 `pi.getConfig()` 交给插件；插件启动时将**显式设置的字段**合并写入上游 `mcp.json` 的 `settings` 段（0600 权限，不覆盖文件中的 `mcpServers`、`imports` 与未涉及的设置）。配置路径与上游一致（`PI_CODING_AGENT_DIR` 优先，否则 `~/.pi/agent/mcp.json`）。

字段分组：

| 组 | 字段 | 说明 |
| --- | --- | --- |
| 常规 | `configPath`、`browser.openTarget` | 覆盖 mcp.json 路径；浏览器（MCP UI 会话、OAuth 授权页）打开位置：内置浏览器或系统默认 |
| 工具注册 | `directTools`、`toolPrefix`、`scriptMode`、`freezeDirectTools`、`strictDirectToolArguments` | 直接工具开关与命名空间前缀、mcpScript 工具、直接工具冻结与严格参数校验 |
| 安全与批准 | `approveTools`、`autoAuth`、`hostConfigDiscovery`、`outputGuard` | 工具批准门控、自动重新认证、宿主配置发现、超大输出守护 |
| 连接 | `idleTimeoutMinutes`、`requestTimeoutMs` | 空闲断连时间与请求超时 |
| 界面 | `notifyOnStartupConnect`、`showStatusIcon`、`mcpFooterStatus`、`toolResultRendering`、`collapsedResultLines` | 状态栏与结果渲染外观 |

`select` 字段都提供 `keep`（保持现状）选项，未显式设置的字段不会写入 mcp.json。Developer Mode 本地加载时不提供市场配置表单；直接编辑 mcp.json 或 Pi 全局配置即可。

## 功能

保留上游扩展的核心功能：

- `mcp` 代理工具：按工具名/正则搜索并调用任意 MCP 服务器工具
- 直接工具：每个 MCP 服务器解析后注册为独立工具（`toolPrefix` 控制命名空间）
- `mcpScript` 工具：受信任的 MCP-only JavaScript 脚本
- `/mcp`（别名 `/pi-mcp`）状态命令与 `/mcp-auth` OAuth 授权命令；非 TUI 运行模式自动降级为文本状态与通知
- OAuth 授权：优先在当前 Desktop 会话的内置浏览器打开授权页，回退系统浏览器与手动复制 URL
- MCP UI 会话：Streamable HTTP 工具结果的本地 Web 可视化（带同意管理与工具批准）
- 多宿主配置发现与导入（Claude Code、Claude Desktop、Codex、Cursor、Windsurf、VS Code、OpenCode）

Desktop 不提供 Pi TUI 自定义面板、快捷键和自定义工具渲染，因此此入口会忽略上游的 `registerShortcut()` 调用，并移除工具的 `renderCall`/`renderResult` 回调；工具结果仍通过标准文本和结构化 `details` 显示，`/mcp` 面板降级为文本状态输出。

### OAuth 凭据存储

Desktop 插件市场不能分发 `@napi-rs/keyring` 原生模块，因此 vendor 副本在 OS 凭据库不可用时自动降级为 `<agent dir>/mcp-oauth-credentials.json`（0600 权限）存储 OAuth 凭据；可通过环境变量 `PI_MCP_ADAPTER_AUTH_STORE=file|keyring` 显式指定。

## 安装依赖

在本目录运行：

```bash
npm install --ignore-scripts --omit=peer
```

依赖固定使用本地维护的 `vendor/pi-mcp-adapter`（基于 `pi-mcp-adapter@2.32.1`，含两处 Desktop 适配补丁：OAuth 凭据文件存储降级、内置浏览器打开授权页），其余 Pi host 包由 Desktop 提供；`--omit=peer` 可避免在插件目录重复安装 host 包。

## 在 Desktop 中加载

1. 打开 `设置 > Extensions > 本地插件`。
2. 开启 `Developer Mode`。
3. 选择 `添加本地插件`，选择本目录（包含 `market-manifest.json`），不要只选择 `index.ts`。
4. 对新会话直接生效；已有会话在 Composer 中运行 `/reload`。

服务器配置沿用上游发现规则（`~/.config/mcp/mcp.json`、`~/.agents/mcp.json`、`~/.agents/mcp/mcp.json`、Pi 全局 `mcp.json`、项目 `.mcp.json` 与 `.pi/mcp.json`）；`.mcp.json` 优先用于项目/团队级服务器，并通过 Pi 全局文件导入。

## 权限与风险

该插件以当前账户权限运行，不是 sandbox。它可以访问网络、文件、环境变量和子进程；会按配置启动 MCP 服务器进程并与其交换数据，工具结果会返回给模型。OAuth 授权可能把浏览器交给第三方授权服务器；`hostConfigDiscovery` 开启后会读取其他工具宿主（Claude/Codex 等）的配置。MCP UI 会话会在本机临时端口（8377–8396）启动本地 HTTP 服务,仅监听环回地址。凭据写入 0600 的配置文件（或 OS 凭据库）；不要在源码、日志或不可信项目配置中保存密钥。

## 验证

```bash
npm run typecheck
npm test
```

测试使用假的 Extension API 与临时 agent 目录，不会启动真实 MCP 服务器或产生网络请求。