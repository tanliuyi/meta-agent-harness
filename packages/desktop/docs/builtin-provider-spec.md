# Desktop 内置 Provider 规范

## 1. 目标

Desktop 可以在不修改 `packages/ai` 的前提下注册仅供桌面应用使用的 LLM provider，并满足以下要求：

- Provider 出现在 Settings -> 凭据页面，用户可以写入 API key。
- 新会话草稿和实际 session 使用同一份 provider 定义。
- 每个 sidecar worker 创建独立 `ModelRegistry` 时都能注册相同 provider。
- Provider 可以复用 Pi 已有 API 协议，也可以通过 extension 提供自定义流实现。
- `packages/ai` 内置 provider 始终优先于同 ID 的 Desktop provider。

## 2. 非目标

本规范不负责：

- 向 `packages/ai` 发布通用 provider。
- 修改 sidecar IPC 协议。
- 将内置 provider 写入用户的 `models.json`。
- 覆盖用户维护的 provider 或 credential 配置。
- 在当前 session 中热替换 provider；凭据和模型变更按现有 Desktop 生命周期对新 session 生效。

## 3. 架构约束

### 3.1 进程模型

Pi session 在独立 sidecar worker 中运行。每个 worker 都调用 `createAgentSessionServices()`，并创建自己的 `AuthStorage`、`ModelRegistry` 和 `ResourceLoader`。

因此，provider 不能只在 Electron main process 的单例中注册。注册定义必须通过 `resourceLoaderOptions.extensionFactories` 传给每次 service 创建。

### 3.2 配置所有权

| 数据 | 权威来源 |
| --- | --- |
| Desktop provider 定义 | `src/main/pi/desktop-builtin-provider.ts` |
| Pi 内置 provider ID | `getModelsConfigMetadata().builtInProviders` |
| Provider credential | `<agentDir>/auth.json` |
| 用户自定义模型与 provider | `<agentDir>/models.json` |
| Settings 已知 provider 列表 | `AuthConfigSnapshot.knownProviders` |

Desktop 不得隐式修改 `auth.json` 或 `models.json`。Settings 页面仍通过 `AuthConfigService` 负责 credential 的读取和原子写入。

## 4. 设计决策

采用 Pi 的 inline extension 注册机制：

```text
DesktopBuiltinProviderRegistry
  |-- getKnownProviderInfos() ------> AuthConfigService ------> Settings
  `-- getExtensionFactories() ------> ResourceLoader
                                         `-- api.registerProvider()
                                               `-- ModelRegistry
```

该方案保持以下边界：

- Provider 定义由 Desktop main/sidecar 代码拥有。
- Provider 注册沿用 Pi 的 `registerProvider()` 校验和模型装载逻辑。
- Worker 不需要新的启动参数或 IPC payload。
- 用户的 `models.json` 保持可编辑且不受程序写入。

## 5. 注册表契约

`DesktopBuiltinProviderRegistry` 位于 `packages/desktop/src/main/pi/desktop-builtin-provider.ts`，公开三个操作：

```typescript
DesktopBuiltinProviderRegistry.register(id, definition);
DesktopBuiltinProviderRegistry.getExtensionFactories();
DesktopBuiltinProviderRegistry.getKnownProviderInfos();
```

一个 `DesktopProviderDefinition` 包含：

- `displayName`：Settings 中显示的名称。
- `envKeys`：Settings 提示的环境变量名。
- `extensionFactory`：传给 `DefaultResourceLoader` 的 `InlineExtension`。

### 5.1 注册时机

具体 provider 在模块顶层调用 `register()`。以下模块直接导入注册表，因此 main process 和 sidecar 所需入口都会执行模块初始化：

- `src/main/auth/auth-config-service.ts`
- `src/main/pi/session-configuration.ts`
- `src/main/pi/session-runtime.ts`

不要求在 `src/main/index.ts` 添加仅用于副作用的导入。

### 5.2 ID 冲突

注册表初始化时读取 `getModelsConfigMetadata().builtInProviders`，形成 Pi 核心 provider ID 集合。

`register(id, definition)` 必须遵守：

1. ID 已由 `packages/ai` 提供时，忽略 Desktop 定义。
2. ID 已由另一个 Desktop 定义注册时，保留第一个定义。
3. 被忽略的定义不得出现在 `getExtensionFactories()` 或 `getKnownProviderInfos()` 中。

该规则保证 Settings 元数据和 `ModelRegistry` 实际模型来源一致，避免 extension 的 `registerProvider()` 完整替换同名核心 provider。

## 6. 接入点

### 6.1 新会话草稿

`loadDraftSessionConfig()` 创建 services 时必须传入：

```typescript
resourceLoaderOptions: {
  extensionFactories: DesktopBuiltinProviderRegistry.getExtensionFactories(),
  packageManagerOnMissing: async () => "error",
}
```

这样草稿模型列表、默认模型解析和 readiness 判断都包含 Desktop provider。

### 6.2 Session runtime

`SessionRuntime.create()` 必须传入相同的 `extensionFactories`。实际 session 与草稿必须使用同一注册表，禁止维护第二份 provider 列表。

### 6.3 Settings 已知 provider

`AuthConfigService` 的 `knownProviders()` 按以下顺序合并：

1. 从 `getModelsConfigMetadata()` 读取 Pi 内置 provider。
2. 追加 `DesktopBuiltinProviderRegistry.getKnownProviderInfos()`。
3. 按 provider ID 去重，核心 provider 优先。
4. Pi metadata 读取失败时，至少返回 Desktop provider 信息。

`knownProviders` 只负责 Settings 展示，不负责模型注册。

## 7. 认证链

Desktop provider 使用 Pi 的现有认证链：

```text
Settings
  -> AuthConfigService
  -> <agentDir>/auth.json
  -> AuthStorage
  -> ModelRegistry.getApiKeyAndHeaders()
  -> provider request
```

定义模型的 extension provider 必须提供 `apiKey` 或 `oauth`，以通过 `registerProvider()` 校验。对于 API-key provider，可以使用环境变量引用作为 fallback：

```typescript
apiKey: "$PROVIDER_API_KEY"
```

运行时优先使用 `auth.json` 中与 provider ID 对应的 credential；未配置时才解析 provider 定义中的 fallback。需要 Bearer header 的 provider 显式设置 `authHeader: true`。

## 8. 当前 Provider

| ID | 显示名称 | API | Credential env key |
| --- | --- | --- | --- |
| `meta-agent` | Meta Agent Provider | `openai-responses` | `META_AGENT_API_KEY` |

模型目录、endpoint、thinking level、context window 和 cost 元数据在 `desktop-builtin-provider.ts` 中集中维护。Settings 或 session 模块不得复制这些模型定义。

## 9. 新增 Provider

新增 Desktop provider 时：

1. 在 `desktop-builtin-provider.ts` 定义稳定且不与 Pi 核心冲突的 provider ID。
2. 定义 `displayName`、`envKeys` 和具名 `InlineExtension`。
3. 在 extension factory 中调用 `api.registerProvider()`。
4. 为每个模型提供 API、输入能力、reasoning、cost、context window 和 max tokens。
5. 仅在后端真实支持时启用 compat capability。
6. 增加注册、认证可用性和冲突优先级测试。
7. 完成 Settings、新会话、恢复 session 和真实请求验收。

若 provider 需要自定义协议，应通过 `streamSimple` 注册对应 API 实现，不得在 SessionRuntime 中添加 provider 特例。

## 10. 测试要求

### 10.1 单元测试

至少覆盖：

- 已注册 Desktop provider 同时出现在 factory 和 Settings metadata 中。
- 核心 provider ID 冲突时 Desktop 定义被完整忽略。
- 重复 Desktop ID 不会产生重复 factory 或 metadata。
- Extension factory 能调用 `registerProvider()` 并注册预期模型。
- `auth.json` 配置对应 credential 后，模型进入 `ModelRegistry.getAvailable()`。

冲突回归测试位于：

```text
packages/desktop/test/desktop-builtin-provider.test.ts
```

### 10.2 集成测试

1. 打开 Settings -> 凭据，确认 provider 可选择。
2. 保存 API key，确认 `auth.json` 使用正确 provider ID。
3. 创建新 session，确认模型列表包含 provider 模型。
4. 发送 prompt，确认请求使用配置的 endpoint 和 credential。
5. 销毁并重建 worker，确认恢复 session 后 provider 仍可用。

### 10.3 验证命令

```bash
node node_modules/vitest/dist/cli.js --run packages/desktop/test/desktop-builtin-provider.test.ts
npm --prefix packages/desktop run typecheck
npm run check
```

若完整检查被无关的 lockfile 或 shrinkwrap 状态阻断，必须单独记录阻断项；不得通过修改无关依赖文件掩盖失败。

## 11. 安全与维护要求

- 不在源码、日志、IPC payload 或 renderer state 中写入真实 API key。
- `envKeys` 只包含变量名，不包含 credential 值。
- Provider endpoint 和传输安全属于 provider 定义的发布审查范围。
- 模型能力和价格必须与实际后端保持一致，避免错误的 token 预算或成本显示。
- Provider 注册错误通过现有 service diagnostics 暴露，不得导致其他 provider 消失。
- 不直接修改 `packages/ai/src/models.generated.ts` 来支持 Desktop-only provider。

## 12. 验收标准

实现满足以下条件时可视为完成：

- Desktop provider 在 Settings 中可配置，且不会覆盖 Pi 核心 provider。
- 草稿配置与实际 session 展示相同的 Desktop 模型集合。
- 新建和恢复 worker 都能注册 provider。
- Credential 继续由 `auth.json` 和 `AuthStorage` 管理。
- 不修改 sidecar 协议，不写入 `models.json`。
- 冲突、注册和认证路径具有自动化测试。
- Desktop typecheck 和相关测试通过。
