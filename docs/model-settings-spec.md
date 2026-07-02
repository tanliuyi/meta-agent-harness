# Model Settings Spec

## 背景

Meta Agent Desktop 是 desktop-first 的 AI Coding Agent Workbench。模型配置是
thread 创建、agent 运行、上下文压缩、标题生成和诊断排错的基础能力。Desktop 底层
必须保持与 `packages/coding-agent` 的 Pi-compatible settings、model registry、
auth、thinking 和 scoped models 语义同构，但 renderer 只能通过 preload IPC 访问
受控 API，不能直接读取配置文件、凭据或 worker 状态。

Desktop 是 Pi 配置体系之上的产品化 UI 层，不创建第二套 credential/settings/models
格式。用户通过 Desktop 保存的 API key、默认模型和自定义 provider 应写入 Pi 可直接
读取的 `auth.json`、`settings.json` 和 `models.json`。Pi CLI 与 Desktop 可以共用同一
套配置文件；Desktop 只负责提供更高层、更安全、更易理解的配置体验。

本文定义 Desktop 设置页中的“模型”配置规格。该页面位于 settings 产品面内，通过
`vue-router` 子路由呈现，不改变现有 settings sidebar 布局。

## 目标

- 在 settings 中新增模型配置页面，作为全局模型设置的主入口。
- 支持展示可用 provider 和 model registry。
- 支持设置默认 provider、默认 model 和默认 thinking level。
- 支持编辑 Pi-compatible `enabledModels` patterns，作为模型循环/任务模型范围配置。
- 支持保存 API key 到 Pi-compatible `auth.json`。
- 支持新增、更新和删除 Pi-compatible `models.json` 自定义 provider/models。
- 支持展示 provider 凭据状态和模型/settings/resource loading 诊断。
- 保持 renderer 数据流通过 preload/main/worker，不让 renderer 成为配置或凭据事实源。

## 非目标

- 不在 renderer 中保存、读取或展示 API key 明文。
- 不让 renderer 直接读写 `settings.json`、`models.json` 或 credential store。
- 不实现模型市场、远程价格同步或远程模型发现。
- 不实现 thread 内临时模型切换器。
- 不编辑 project-level `.pi/settings.json` 或 `.pi/models.json`；项目级配置后续必须受 Project trust 控制。
- 不改变现有 settings sidebar 的布局结构。

## 路由与页面结构

推荐路由：

```text
/settings
/settings/models
```

`apps/desktop/src/renderer/src/views/settings/View.vue` 作为设置页布局容器：

```text
Settings View.vue
  Sidebar
  ResizablePaneSeparator
  settings-content
    RouterView
```

要求：

- `Sidebar` 和 resizer 的布局结构保持不变。
- settings 内容区域使用 `<RouterView />` 呈现子路由。
- `/settings` 可重定向到 `/settings/models`，或显示设置首页后再进入模型页。
- 如果需要新增“模型”入口，只增加导航目标，不调整 sidebar 的现有布局模型。

## 信息架构

模型配置页包含以下区域：

1. 默认模型
2. Thinking
3. 可用模型
4. 任务模型
5. 诊断

页面标题使用：

```text
模型
```

区域标题使用：

```text
默认模型
Thinking
可用模型
任务模型
诊断
```

## 默认模型

默认模型用于新建 thread 或未设置 scoped model 的 agent 任务。

数据结构：

```ts
export interface DefaultModelConfig {
  provider: string
  modelId: string
}
```

用户能力：

- 查看当前默认 provider 和 model。
- 从 model registry 中选择 provider。
- 从 provider 下选择 model。
- 保存为全局默认模型。
- 恢复系统默认值。

校验规则：

- `provider` 必须存在于当前 registry。
- `modelId` 必须属于所选 provider。
- 当前配置的模型不存在时，页面显示失效状态。
- provider 缺少凭据时允许选择，但必须展示 `missingAuth` 状态。
- 保存失败时显示错误状态，并提示查看诊断。

## Thinking

Desktop 保留 Pi-compatible thinking level：

```ts
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
```

用户能力：

- 查看当前默认 thinking level。
- 选择新的默认 thinking level。
- 查看当前模型对 thinking 的支持状态。
- 当选择超过模型能力的 level 时，展示 clamp 提示。

推荐提示文案：

```text
当前模型最高支持 high，运行时会将 xhigh 调整为 high。
```

交互要求：

- 使用 segmented control、select 或同等紧凑控件。
- 控件状态必须可禁用。
- 保存必须通过 preload IPC 进入 Electron main，并由 main 调用 Pi-compatible `SettingsManager`。

## 可用模型

可用模型来自 model registry。registry 可以包含内置 provider、全局配置、自定义
provider、项目配置和 runtime override。renderer 只展示 preload API 返回的结果。

数据结构：

```ts
export interface ModelListItem {
  provider: string
  id: string
  displayName?: string
  contextWindow?: number
  maxOutputTokens?: number
  supportsTools?: boolean
  supportsImages?: boolean
  supportsReasoning?: boolean
  thinkingLevels?: ThinkingLevel[]
  source?: 'builtin' | 'global' | 'project' | 'runtime'
  status: 'available' | 'missingAuth' | 'invalid' | 'disabled'
}
```

用户能力：

- 按 provider 分组查看模型。
- 搜索模型。
- 过滤可用、缺凭据、无效或禁用模型。
- 查看模型能力，包括上下文窗口、工具调用、图片输入和 reasoning 支持。
- 将某个模型设为默认模型。

页面至少实现：

- 分组展示。
- 空状态。
- 缺凭据状态。
- 当前默认模型标识。
- 设置默认模型的交互入口。

## 任务模型

任务模型对应 scoped models，用于让不同 agent 子任务使用不同模型。默认情况下所有
scope 继承全局默认模型。

推荐 scope：

```ts
export type ModelScope =
  'default' | 'chat' | 'apply' | 'summarize' | 'title' | 'compact' | 'branchSummary'
```

数据结构：

```ts
export interface ScopedModelConfig {
  scope: ModelScope
  provider?: string
  modelId?: string
  inheritsDefault: boolean
}
```

用户能力：

- 查看每个 scope 当前使用的模型。
- 默认显示“继承默认模型”。
- 为特定 scope 选择 provider 和 model。
- 将 scope 恢复为继承默认模型。

当前支持编辑 Pi-compatible `enabledModels` patterns。用户以每行一个 pattern 的方式
配置模型循环范围，例如：

```text
claude-*
openai/gpt-*
gemini-2*
```

保存时 main 必须调用 `SettingsManager.setEnabledModels()`，不能绕过 Pi settings 语义
直接手写 `settings.json`。

## 凭据状态

凭据由 main/worker 或 credential backend 负责解析。renderer 不接触密钥明文。

数据结构：

```ts
export interface ProviderCredentialStatus {
  provider: string
  status: 'configured' | 'missing' | 'invalid' | 'unknown'
  source?: 'credentialStore' | 'env' | 'oauth' | 'runtime'
  message?: string
}
```

用户能力：

- 查看每个 provider 的凭据状态。
- 查看凭据来源类型，但不显示密钥内容。
- 触发安全配置流程。
- 刷新凭据状态。

缺凭据文案：

```text
该 provider 尚未配置凭据
```

## API Key 配置体验

从产品和用户角度，API key 配置不应被呈现为“编辑某个 JSON 文件”，而应被呈现为：

```text
为这个 provider 配置访问凭据
```

Desktop 是 Pi 配置体系之上的更高一层产品入口。用户在 Desktop 中保存 API key 后，
底层必须写入 Pi-compatible `auth.json`，使 Pi CLI、Desktop main、worker 和 SDK
读取到同一份凭据。Desktop 不创建 desktop-only keychain schema，也不把 API key
复制到 renderer state、project database 或 thread snapshot。

### 用户心智

用户需要理解的概念只有三层：

1. 选择 provider，例如 OpenAI、Anthropic、Google、OpenRouter 或自定义 provider。
2. 粘贴 API key，或选择使用环境变量/命令获取 key。
3. 保存后立即看到该 provider 是否可用。

用户不需要理解：

- `auth.json` 的完整 schema。
- Pi credential resolution order。
- `models.json` 与 `auth.json` 的 fallback 差异。
- provider SDK 的内部鉴权方式。

这些细节可以通过“高级设置”“查看配置位置”“诊断详情”暴露给高级用户。

### 推荐入口

API key 配置入口放在模型设置页的两个位置：

- provider 凭据状态列表：每个缺凭据 provider 显示“配置”按钮。
- 默认模型区域：当当前选择的 provider 缺凭据时，显示 inline callout 和“配置凭据”按钮。

交互建议：

```text
OpenAI 尚未配置凭据
保存 API key 后，Desktop 和 Pi CLI 都会使用同一份配置。
[配置凭据]
```

点击后打开 modal 或 side panel，不跳出 settings sidebar 结构。

### 表单字段

基础表单：

```text
Provider
API key
保存
取消
```

推荐字段行为：

- `Provider` 默认带入当前 provider，可切换。
- `API key` 使用 password input，默认隐藏，允许临时显示。
- 保存成功后立即清空输入框。
- 页面只显示 masked 状态，例如 `已配置`、`来自环境变量`、`来自 auth.json`。
- 不提供“查看完整 API key”能力。

高级表单可折叠显示：

```text
使用环境变量引用
Provider-scoped env
使用命令获取 key
```

对应 Pi-compatible 写入：

```json
{
  "openai": { "type": "api_key", "key": "sk-..." }
}
```

环境变量引用：

```json
{
  "openai": { "type": "api_key", "key": "$OPENAI_API_KEY" }
}
```

带 provider-scoped env 的云 provider：

```json
{
  "cloudflare-ai-gateway": {
    "type": "api_key",
    "key": "$CLOUDFLARE_API_KEY",
    "env": {
      "CLOUDFLARE_API_KEY": "...",
      "CLOUDFLARE_ACCOUNT_ID": "...",
      "CLOUDFLARE_GATEWAY_ID": "..."
    }
  }
}
```

命令型 key：

```json
{
  "anthropic": {
    "type": "api_key",
    "key": "!op read 'op://vault/item/credential'"
  }
}
```

命令型 key 属于高级能力。Desktop 保存时只写入命令字符串，不在 renderer 中执行命令，
不展示 stdout；是否执行由 Pi credential resolver 在 main/worker 侧按 Pi 语义处理。

### 保存流程

1. 用户在 Desktop 输入 API key。
2. renderer 只在表单内短暂持有输入值。
3. renderer 调用 preload `setProviderApiKey(input)`。
4. preload 通过 IPC 发送到 Electron main。
5. main 调用 Pi `AuthStorage.set(provider, { type: "api_key", key, env })`。
6. `AuthStorage` 写入 `getAgentDir()/auth.json`。
7. main reload auth 并 refresh model registry。
8. renderer 收到不含密钥明文的 `ModelSettingsSnapshot`。
9. UI 清空输入框，只刷新凭据状态和诊断。

### 保存后反馈

保存成功文案：

```text
凭据已保存。Desktop 和 Pi CLI 将使用同一份配置。
```

保存失败文案：

```text
凭据保存失败。请检查本机 Pi 配置目录权限。
```

缺少附加环境变量文案：

```text
API key 已保存，但该 provider 还需要账户、区域或网关等附加配置。
```

### 安全边界

- API key 不回显明文。
- API key 不进入 Pinia 持久化状态。
- API key 不进入 diagnostics、日志、crash report、thread snapshot 或 session JSONL。
- renderer 不直接读写 `auth.json`。
- main 返回 credential status 时只返回来源和状态，不返回 resolved key、env value 或 command 输出。
- 自定义 provider 的 fallback `models.json.providers[provider].apiKey` 仅用于 Pi 兼容高级场景；
  普通 API key 保存默认仍写入 `auth.json`。

### 与 Pi CLI 的同构关系

Desktop 写入：

```text
getAgentDir()/auth.json
```

Pi CLI 读取同一文件。因此用户可以：

- 在 Desktop 中保存 OpenAI key，然后直接用 Pi CLI 运行 OpenAI 模型。
- 在 Pi CLI 或手动配置中已有 `auth.json`，Desktop 打开后显示 provider 已配置。
- 使用环境变量或命令型 key，Desktop 只显示“来自环境变量/命令配置”，不暴露明文。

Desktop 的产品承诺是“更好配”，不是“另存一份”。配置文件保持与 Pi 同构，Desktop 只在
交互、校验、诊断和安全提示上更高一层。

## 诊断

诊断用于展示 model registry、settings、auth 和 resource loading 的问题。

数据结构：

```ts
export interface ModelDiagnostic {
  id: string
  severity: 'info' | 'warning' | 'error'
  source: 'settings' | 'auth' | 'modelRegistry' | 'resourceLoading'
  message: string
  details?: string
}
```

展示规则：

- `error` 优先展示。
- `warning` 次之。
- `info` 可折叠或弱化展示。
- 不展示敏感凭据。
- 诊断应尽量标明来源，例如 global、project 或 runtime。

## Renderer 数据边界

renderer 应通过 preload API 获取和提交模型配置。推荐 API 形态：

```ts
window.api.models.list()
window.api.models.getSettings()
window.api.models.updateSettings(input)
window.api.models.getCredentialStatus()
window.api.models.getDiagnostics()
```

如果项目采用 command-style IPC，可对应为：

```text
model.list
model.set
thinking.set
settings.get
settings.update
```

renderer store 建议命名：

```ts
useModelSettingsStore()
```

store 职责：

- 加载模型列表。
- 加载当前模型设置。
- 加载凭据状态。
- 加载诊断。
- 提交默认模型变更。
- 提交 thinking level 变更。
- 管理 loading、saving、empty 和 error 状态。

store 不应：

- 读写本地配置文件。
- 保存 API key。
- 直接访问 Electron main、worker process 或 Node 文件系统。

## Main 后端接入规格

模型设置后端应落在 Electron main，而不是 renderer 或单个 thread worker。main 负责
受控读写全局设置、自定义 provider/models 配置、凭据状态摘要和诊断；worker 继续负
责运行中 thread 的模型切换与 agent runtime 状态。

推荐新增服务：

```text
apps/desktop/src/main/coding-agent/model-settings-service.ts
```

职责：

- 创建并持有 Pi-compatible `SettingsManager`。
- 创建并持有 Pi-compatible `ModelRegistry`。
- 读取 Pi-compatible agentDir 下的全局 `settings.json`、`models.json` 和 `auth.json`。
- 输出 renderer 可消费的模型 registry projection。
- 写入全局默认模型、默认 thinking level 和 enabled/scoped model patterns。
- 读写自定义 provider/models 配置。
- 调用 `ModelRegistry.refresh()` 重新加载 registry。
- 输出不包含密钥明文的 credential status。
- 输出 settings 和 models loading diagnostics。

不应：

- 直接修改运行中 thread 的内存模型状态。
- 把 thread 级 `setModel` 当成全局设置保存。
- 在 renderer 可见结果中返回 API key、headers 原文或 command 输出。
- 创建与 `packages/coding-agent` 不兼容的 desktop-only models 配置格式。

### 存储路径

Desktop 默认使用 Pi 的 agentDir，配置文件与 Pi CLI 通用：

```text
getAgentDir()/settings.json
getAgentDir()/models.json
getAgentDir()/auth.json
```

实现上通过 host option 把该目录传给 `packages/coding-agent`：

```ts
const agentDir = getAgentDir()
const authStorage = AuthStorage.create(join(agentDir, 'auth.json'))
SettingsManager.create(app.getPath('userData'), agentDir, { projectTrusted: false })
ModelRegistry.create(authStorage, join(agentDir, 'models.json'))
```

说明：

- 全局模型设置页默认只写 app-level/global 配置。
- API key 写入 `auth.json` 的 Pi-compatible `{ type: "api_key", key, env? }` 结构。
- 自定义 provider fallback key 仍可按 Pi `models.json.providers[provider].apiKey` 语义保存。
- project-level `.pi/settings.json` 和 `.pi/models.json` 后续必须受 Project trust 控制。
- 如果未来允许用户切换 Desktop agentDir，必须清楚标明这会切换 Pi-compatible 配置根，而
  不是切到 desktop-only 配置格式。

### Main API

推荐 manager/service API：

```ts
export interface ModelSettingsService {
  getModelSettings(): Promise<ModelSettingsSnapshot>
  updateModelSettings(input: UpdateModelSettingsInput): Promise<ModelSettingsSnapshot>
  listModelRegistry(): Promise<ModelRegistrySnapshot>
  listProviderCredentials(): Promise<ProviderCredentialStatus[]>
  listModelDiagnostics(): Promise<ModelDiagnostic[]>
  listCustomProviders(): Promise<CustomProviderSummary[]>
  upsertCustomProvider(input: UpsertCustomProviderInput): Promise<ModelSettingsSnapshot>
  deleteCustomProvider(provider: string): Promise<ModelSettingsSnapshot>
  setProviderApiKey(input: SetProviderApiKeyInput): Promise<ModelSettingsSnapshot>
  refreshModelRegistry(): Promise<ModelSettingsSnapshot>
}
```

推荐 IPC channels：

```ts
modelSettings.get
modelSettings.update
modelRegistry.list
modelCredentials.list
modelDiagnostics.list
customProviders.list
customProviders.upsert
customProviders.delete
providerApiKey.set
modelRegistry.refresh
```

preload 暴露：

```ts
window.api.codingAgent.getModelSettings()
window.api.codingAgent.updateModelSettings(input)
window.api.codingAgent.listModelRegistry()
window.api.codingAgent.listProviderCredentials()
window.api.codingAgent.listModelDiagnostics()
window.api.codingAgent.listCustomProviders()
window.api.codingAgent.upsertCustomProvider(input)
window.api.codingAgent.deleteCustomProvider(provider)
window.api.codingAgent.setProviderApiKey(input)
window.api.codingAgent.refreshModelRegistry()
```

现有 thread 级 API 保留：

```ts
listModels(threadId)
setModel({ threadId, provider, modelId })
setThinkingLevel({ threadId, level })
```

两组 API 边界：

- `modelSettings.*`：全局配置，影响新建 thread 和后续 worker 初始化。
- `thread model commands`：当前 thread runtime override，影响已经运行或恢复的 thread。

### Snapshot 类型

```ts
export interface ModelSettingsSnapshot {
  settings: {
    defaultProvider?: string
    defaultModel?: string
    defaultThinkingLevel?: ThinkingLevel
    enabledModels?: string[]
  }
  registry: ModelRegistrySnapshot
  credentials: ProviderCredentialStatus[]
  diagnostics: ModelDiagnostic[]
  customProviders: CustomProviderSummary[]
  storage: {
    agentDir: string
    settingsPath: string
    modelsPath: string
  }
}

export interface ModelRegistrySnapshot {
  models: ModelListItem[]
  providers: ProviderSummary[]
  loadError?: string
  refreshedAt: string
}

export interface ProviderSummary {
  id: string
  displayName: string
  source: 'builtin' | 'custom' | 'extension' | 'project'
  modelCount: number
  availableModelCount: number
  credentialStatus: CredentialStatus
}

export interface UpdateModelSettingsInput {
  defaultProvider?: string
  defaultModel?: string
  defaultThinkingLevel?: ThinkingLevel
  enabledModels?: string[]
}
```

映射规则：

- `ModelRegistry.getAll()` 映射为 `ModelListItem[]`。
- `ModelRegistry.getAvailable()` 用于计算 `status: 'available' | 'missingAuth'`。
- `ModelRegistry.getProviderAuthStatus(provider)` 映射为 `ProviderCredentialStatus`。
- `ModelRegistry.getError()` 映射为 `ModelDiagnostic`。
- `SettingsManager.drainErrors()` 映射为 settings diagnostics。
- 不返回 `apiKey`、`headers`、resolved env 或 command 输出。

### 写入与刷新流程

更新默认模型：

1. main 接收 `UpdateModelSettingsInput`。
2. 校验 provider/model 是否存在于 `ModelRegistry.getAll()`。
3. 如果 provider 缺凭据，允许保存但返回 warning diagnostic。
4. 调用 `SettingsManager.setDefaultModelAndProvider(provider, modelId)`。
5. 调用 `SettingsManager.setDefaultThinkingLevel(level)`，如果 input 提供。
6. 如果 input 提供 `enabledModels`，调用 `SettingsManager.setEnabledModels(patterns)`。
7. `await settingsManager.flush()`。
8. 返回新的 `ModelSettingsSnapshot`。

更新 custom provider/models：

1. main 接收 `UpsertCustomProviderInput`。
2. 用与 `ModelRegistry` 相同的 `models.json` schema 校验输入。
3. 以 JSON object 方式更新 `models.json` 的 `providers[provider]`。
4. 写文件时使用锁或原子写入，避免并发破坏配置。
5. 调用 `ModelRegistry.refresh()`。
6. 返回新的 `ModelSettingsSnapshot`。

保存 provider API key：

1. renderer 只把用户输入提交给 preload，不持久化、不回显。
2. main 调用 `AuthStorage.set(provider, { type: "api_key", key, env })`。
3. `AuthStorage` 写入 Pi-compatible `auth.json`。
4. main 调用 `authStorage.reload()` 和 `ModelRegistry.refresh()`。
5. renderer 只展示来源和状态，例如 `credentialStore`、`environment`、`models_json_key`。

删除 custom provider：

1. main 校验 provider 是否来自 custom models.json。
2. 从 `models.json.providers` 删除对应 provider。
3. 调用 `ModelRegistry.refresh()`。
4. 如果默认模型指向被删除 provider，返回 warning diagnostic；不自动改默认值，除非用户确认。

### 运行中 thread 行为

全局模型设置更新后：

- 新建 thread 使用新的 global default。
- idle thread 下次 resume 时使用最新 settings merge 结果，除非 session 有 runtime override。
- running thread 不被强制切换模型。
- 如果用户需要影响当前 thread，应在 thread UI 中调用现有 `setModel` 或后续提供“应用到当前 thread”动作。

main 可以发布 projection event：

```ts
{
  type: ('modelSettings.changed', snapshot)
}
{
  type: ('modelRegistry.refreshed', registry)
}
```

renderer 订阅后刷新设置页，但不直接修改 running thread snapshot。

## 自定义 Provider 与 Models

Desktop 自定义 provider/models 必须复用 `packages/coding-agent/docs/models.md` 中的
`models.json` 语义。

支持 API：

- `openai-completions`
- `openai-responses`
- `anthropic-messages`
- `google-generative-ai`

Provider 配置字段：

```ts
export interface CustomProviderConfig {
  name?: string
  baseUrl?: string
  apiKey?: string
  api?: string
  headers?: Record<string, string>
  compat?: Record<string, unknown>
  authHeader?: boolean
  models?: CustomModelConfig[]
  modelOverrides?: Record<string, CustomModelOverride>
}
```

Model 配置字段：

```ts
export interface CustomModelConfig {
  id: string
  name?: string
  api?: string
  baseUrl?: string
  reasoning?: boolean
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>
  input?: Array<'text' | 'image'>
  contextWindow?: number
  maxTokens?: number
  cost?: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
  }
  headers?: Record<string, string>
  compat?: Record<string, unknown>
}
```

UI 一期建议只支持表单化的常用字段：

- provider id
- display name
- baseUrl
- api
- apiKey 来源类型：环境变量、literal、command、已存凭据
- authHeader
- models: id、name、reasoning、input、contextWindow、maxTokens

高级字段使用 JSON editor：

- `headers`
- `compat`
- `thinkingLevelMap`
- `modelOverrides`
- `cost`

安全规则：

- 内置或普通 provider 的 API key 默认写入 Pi-compatible `auth.json`。
- 自定义 provider 的 fallback key 可以写入 `models.json.apiKey`，语义与 Pi 完全一致。
- renderer 只能把用户输入提交给 main，保存后不再回显明文。
- 列表中显示 `apiKey` 来源：`environment`、`models_json_key`、`models_json_command`、`stored`、`oauth`。
- command-backed value 只显示“命令配置已存在”，不执行命令、不显示 stdout。

校验规则：

- 新 provider 定义 `models` 时必须有 `baseUrl`。
- 非 built-in provider 的 model 必须能从 provider 或 model 得到 `api`。
- `model.id` 必填且 provider 内唯一。
- `contextWindow`、`maxTokens` 必须大于 0。
- `input` 只允许 `text` 或 `image`。
- 内置 provider override-only 配置允许只写 `baseUrl`、`headers`、`compat` 或 `modelOverrides`。

合并语义：

- built-in provider 加 `models`：保留内置模型，自定义模型按 `id` upsert。
- custom provider 加 `models`：作为新 provider 注册。
- `modelOverrides`：只覆盖已存在 built-in model 的指定字段，未知 model id 产生 warning。
- 删除 custom provider 后，内置 provider 行为通过 `ModelRegistry.refresh()` 恢复。

## 页面状态

页面必须覆盖以下状态：

- 初始加载中。
- 加载成功。
- 模型列表为空。
- provider 缺少凭据。
- 当前配置的模型不存在。
- 保存中。
- 保存成功。
- 保存失败。
- 存在诊断错误。

推荐空状态文案：

```text
暂无可用模型
请检查 provider 凭据、自定义 provider 配置或 models.json 诊断信息。
```

模型失效文案：

```text
当前配置的模型不在可用模型列表中
```

保存失败文案：

```text
模型配置保存失败，请查看诊断信息
```

## 用户流程

### 设置默认模型

1. 用户进入 `/settings/models`。
2. 页面加载当前默认模型和可用模型列表。
3. 用户选择 provider。
4. 用户选择 model。
5. 页面展示该模型能力与凭据状态。
6. 用户点击保存。
7. renderer 调用 preload API。
8. 保存成功后刷新当前配置。
9. 后续新 thread 默认使用该模型。

### 设置 thinking level

1. 用户查看当前 thinking level。
2. 用户选择新的 level。
3. 页面根据当前模型能力显示 clamp 提示。
4. 用户保存。
5. 后端持久化设置。
6. 后续新 thread 或 agent 运行使用该配置。

### 处理缺凭据 provider

1. 用户选择某 provider 下的模型。
2. 页面发现 credential status 为 `missing`。
3. 页面显示缺凭据状态。
4. 用户点击配置入口。
5. renderer 触发 preload API。
6. main 进程打开安全配置流程。
7. 页面刷新凭据状态。

### 配置任务模型

1. 用户打开“任务模型”区域。
2. 每个 scope 默认显示“继承默认模型”。
3. 用户在 `enabledModels` 文本框中输入每行一个 model pattern。
4. 用户保存。
5. 后端通过 `SettingsManager.setEnabledModels()` 保存 patterns。
6. agent runtime 在模型循环和 scoped model 解析中使用这些 patterns。

## 权限与安全

- renderer 不读取本地 settings、models 或 credential 文件。
- renderer 不保存 API key。
- renderer 不展示 credential 明文。
- 所有保存操作必须经过 preload API。
- main/worker 负责 settings merge、auth resolve 和 diagnostics。
- project 级模型配置必须尊重 Project trust 状态。
- 未 trusted 的 project 不加载项目本地 agent resources。

## 与 Thread 的关系

模型设置分为两类：

- 全局默认设置：影响新建 thread。
- 运行时 override：影响当前 thread。

本规格覆盖全局默认模型、默认 thinking、`enabledModels`、provider 凭据和自定义
provider/models 配置。thread 内 runtime override、当前 thread 临时切换和 snapshot
当前模型展示属于 workspace/chat 产品面。

## 验收标准

- `/settings/models` 可访问。
- settings `View.vue` 使用子路由呈现设置内容。
- 现有 settings sidebar 布局保持不变。
- 页面包含默认模型、Thinking、可用模型、任务模型和诊断区域。
- 页面覆盖 loading、empty、error、missing auth、保存中和保存失败状态。
- 保存动作通过 preload/store 抽象，不直接访问文件系统。
- 默认模型、默认 thinking、`enabledModels`、API key 和自定义 provider/models 保存
  都通过 Electron main 的 Pi-compatible service 完成。
- API key 写入 `getAgentDir()/auth.json` 后不向 renderer 回显明文。
- 自定义 provider/models 写入 `getAgentDir()/models.json` 后刷新 model registry。
- TypeScript 和 Vue 编译通过。

## 实现状态

当前实现已接入全局模型配置链路：

- `/settings/models` 通过 `vue-router` 子路由呈现。
- renderer 使用 `useModelSettingsStore` 调用 preload 暴露的受控 API。
- main 使用 `ModelSettingsService` 读写 `settings.json`、`models.json` 和 `auth.json`。
- 默认 provider/model、默认 thinking level 和 `enabledModels` 通过 `SettingsManager` 保存。
- API key 通过 `AuthStorage` 写入 Pi-compatible `auth.json`。
- 自定义 provider/models 通过 `models.json` 保存，并刷新 `ModelRegistry`。

后续增强：

- project-level `.pi/settings.json` / `.pi/models.json` 编辑，并接入 Project trust。
- thread 级 runtime override 与“应用到当前 thread”动作。
- 更完整的结构化 provider/model 高级字段编辑体验。
