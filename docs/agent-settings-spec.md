# Agent Settings Spec

## 背景

Desktop 是 Pi 配置体系之上的产品化 UI 层。除模型、provider、API key 之外，Pi agent
还有大量全局运行配置保存在 `getAgentDir()/settings.json` 中，例如消息投递、transport、
自动压缩、重试、项目 trust、图片处理、终端呈现、资源路径和 shell 命令设置。

本规格定义 Desktop settings 中的 “Agent” 配置页。该页面通过 `vue-router` 子路由呈现，
不改变现有 settings sidebar 布局。Desktop 不创建 desktop-only settings 格式，所有保存
操作必须通过 Electron main 调用 Pi-compatible `SettingsManager`，最终写入 Pi CLI 可读取
的同一份 `settings.json`。

## 目标

- 在 `/settings/agent` 提供 Pi agent 非模型配置的可视化入口。
- 复用 `packages/coding-agent/src/core/settings-manager.ts` 的 getter/setter 语义。
- 覆盖 Pi `settings.json` 中适合全局编辑的非模型配置。
- renderer 只通过 preload IPC 获取快照和提交更新，不直接访问文件系统。
- 页面显示 `agentDir` 和 `settings.json` 路径，帮助用户理解 Desktop 与 Pi CLI 共用配置。

## 非目标

- 不编辑 project-level `.pi/settings.json`。
- 不绕过 `SettingsManager` 直接手写 settings 字段。
- 不暴露 Pi 内部字段，例如 `lastChangelogVersion`、`trackingId`。
- 不改变运行中 thread 的内存状态；全局设置影响新建或下次初始化的 agent runtime。
- 不把 API key、models 或 custom provider 配置放在 Agent 页；这些属于模型配置页。

## 路由

```text
/settings/agent
```

`/settings` 仍可默认重定向到 `/settings/models`。sidebar 只增加一个 “Agent” 导航项，
不调整布局模型。

## 页面信息架构

Agent 设置页包含以下区域：

1. 消息投递
2. 运行时
3. 显示与交互
4. 安全与遥测
5. 图片与终端
6. Shell
7. 资源路径
8. 状态与诊断

## 配置映射

本页覆盖 Pi `SettingsManager` 已有全局 setter 的非模型字段。

| 页面区域 | UI 字段 | Pi settings 字段 | SettingsManager |
| --- | --- | --- | --- |
| 消息投递 | Steering | `steeringMode` | `setSteeringMode` |
| 消息投递 | Follow-up | `followUpMode` | `setFollowUpMode` |
| 消息投递 | Transport | `transport` | `setTransport` |
| 运行时 | 自动上下文压缩 | `compaction.enabled` | `setCompactionEnabled` |
| 运行时 | 压缩预留 token | `compaction.reserveTokens` | `setCompactionReserveTokens` |
| 运行时 | 压缩保留最近 token | `compaction.keepRecentTokens` | `setCompactionKeepRecentTokens` |
| 运行时 | 分支摘要预留 token | `branchSummary.reserveTokens` | `setBranchSummaryReserveTokens` |
| 运行时 | 跳过分支摘要提示 | `branchSummary.skipPrompt` | `setBranchSummarySkipPrompt` |
| 运行时 | 自动重试 | `retry.enabled` | `setRetryEnabled` |
| 运行时 | Agent 最大重试次数 | `retry.maxRetries` | `setRetryMaxRetries` |
| 运行时 | Agent 重试基础延迟 | `retry.baseDelayMs` | `setRetryBaseDelayMs` |
| 运行时 | Provider timeout | `retry.provider.timeoutMs` | `setProviderRetryTimeoutMs` |
| 运行时 | Provider 最大重试次数 | `retry.provider.maxRetries` | `setProviderRetryMaxRetries` |
| 运行时 | Provider retry delay 上限 | `retry.provider.maxRetryDelayMs` | `setProviderRetryMaxRetryDelayMs` |
| 运行时 | HTTP idle timeout | `httpIdleTimeoutMs` | `setHttpIdleTimeoutMs` |
| 运行时 | WebSocket connect timeout | `websocketConnectTimeoutMs` | `setWebSocketConnectTimeoutMs` |
| 显示与交互 | Theme | `theme` | `setTheme` |
| 显示与交互 | 安静启动 | `quietStartup` | `setQuietStartup` |
| 显示与交互 | 折叠 Changelog | `collapseChangelog` | `setCollapseChangelog` |
| 显示与交互 | 隐藏 Thinking | `hideThinkingBlock` | `setHideThinkingBlock` |
| 显示与交互 | Double Escape | `doubleEscapeAction` | `setDoubleEscapeAction` |
| 显示与交互 | Tree filter | `treeFilterMode` | `setTreeFilterMode` |
| 显示与交互 | 硬件光标 | `showHardwareCursor` | `setShowHardwareCursor` |
| 显示与交互 | Editor padding | `editorPaddingX` | `setEditorPaddingX` |
| 显示与交互 | Autocomplete rows | `autocompleteMaxVisible` | `setAutocompleteMaxVisible` |
| 安全与遥测 | Project trust 默认策略 | `defaultProjectTrust` | `setDefaultProjectTrust` |
| 安全与遥测 | 安装/更新 telemetry | `enableInstallTelemetry` | `setEnableInstallTelemetry` |
| 安全与遥测 | Analytics | `enableAnalytics` | `setEnableAnalytics` |
| 安全与遥测 | Skill commands | `enableSkillCommands` | `setEnableSkillCommands` |
| 安全与遥测 | Anthropic extra usage 提示 | `warnings.anthropicExtraUsage` | `setWarnings` |
| 安全与遥测 | HTTP proxy | `httpProxy` | `setHttpProxy` |
| 图片与终端 | 自动缩放图片 | `images.autoResize` | `setImageAutoResize` |
| 图片与终端 | 阻止图片发送 | `images.blockImages` | `setBlockImages` |
| 图片与终端 | 终端内联图片 | `terminal.showImages` | `setShowImages` |
| 图片与终端 | 图片宽度 cells | `terminal.imageWidthCells` | `setImageWidthCells` |
| 图片与终端 | 收缩时清屏 | `terminal.clearOnShrink` | `setClearOnShrink` |
| 图片与终端 | 终端进度 | `terminal.showTerminalProgress` | `setShowTerminalProgress` |
| Shell | Shell path | `shellPath` | `setShellPath` |
| Shell | Shell command prefix | `shellCommandPrefix` | `setShellCommandPrefix` |
| Shell | NPM command argv | `npmCommand` | `setNpmCommand` |
| Shell | Session dir | `sessionDir` | `setSessionDir` |
| 资源路径 | Packages | `packages` | `setPackages` |
| 资源路径 | Extensions | `extensions` | `setExtensionPaths` |
| 资源路径 | Skills | `skills` | `setSkillPaths` |
| 资源路径 | Prompts | `prompts` | `setPromptTemplatePaths` |
| 资源路径 | Themes | `themes` | `setThemePaths` |
| 高级 | Thinking budgets | `thinkingBudgets` | `setThinkingBudgets` |
| 高级 | Markdown code block indent | `markdown.codeBlockIndent` | `setCodeBlockIndent` |

## Main 后端接入

新增服务：

```text
apps/desktop/src/main/coding-agent/agent-settings-service.ts
```

职责：

- 创建 Pi-compatible `SettingsManager.create(cwd, getAgentDir(), { projectTrusted: false })`。
- 读取全局 merged settings projection。
- 只通过 `SettingsManager` 公开 setter 写入全局配置。
- `flush()` 后返回新的 `AgentSettingsSnapshot`。
- 将 `drainErrors()` 映射为 renderer 可展示 diagnostics。

IPC：

```text
coding-agent:get-agent-settings
coding-agent:update-agent-settings
```

preload：

```ts
window.api.codingAgent.getAgentSettings()
window.api.codingAgent.updateAgentSettings(input)
```

## Renderer 数据边界

新增 store：

```text
apps/desktop/src/renderer/src/stores/agent-settings.ts
```

store 职责：

- 加载 `AgentSettingsSnapshot`。
- 维护当前页面 draft。
- 保存时提交 `UpdateAgentSettingsInput`。
- 管理 loading、saving、error 和 diagnostics。

store 不应：

- 直接读取或写入 `settings.json`。
- 推断 project-level settings。
- 修改运行中 thread snapshot。

## 资源路径输入

资源路径使用每行一个值的 textarea：

- `packages`
- `extensions`
- `skills`
- `prompts`
- `themes`

`packages` 支持 Pi 的 string source；如果已有 object source，Desktop 可以以 JSON 字符串形式
展示和回写。结构化 package source 编辑器可作为后续增强。

## 未覆盖范围

以下 Pi settings 不在 Agent 页直接编辑：

- `defaultProvider`、`defaultModel`、`defaultThinkingLevel`、`enabledModels`：由模型设置页负责。
- `lastChangelogVersion`、`trackingId`：内部状态，不作为用户配置项。
- project-level `.pi/settings.json` 覆盖：需要选定 project，并受 Project trust 控制，后续在
  project 设置或 workspace 设置中定义。

## 运行中 Thread 行为

Agent 全局设置保存后：

- 新建 thread 使用最新 global `settings.json`。
- idle thread 下次 worker 初始化或 reload 时读取最新 settings。
- running thread 不被强制改写内存状态。
- 若需要影响当前 thread，应通过 workspace/chat 中已有 runtime command 或后续专门入口处理。

## 验收标准

- `/settings/agent` 可访问。
- sidebar 布局保持不变，只新增 “Agent” 导航项。
- 页面可以加载并保存 Pi-compatible `settings.json` 中的非模型配置。
- 保存链路为 renderer store -> preload -> IPC -> main service -> `SettingsManager`。
- TypeScript/Vue 类型检查通过。
- 页面显示 `agentDir`、`settings.json` 路径和 settings diagnostics。
