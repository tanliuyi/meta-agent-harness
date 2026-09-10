# Lovart 参考技术规范：Design Agent Workbench

状态：Draft / Reference
适用范围：`packages/desktop`、`packages/agent` 的现有公共合同、Pi Extension、Desktop sidecar、renderer Workbench 与设计资产存储

> 本文描述一个与当前 Meta Agent Desktop 架构相容的 Design Agent 参考实现。它参考 Lovart 公开可观察的工作流：项目级上下文、画布、Brand Kit、局部编辑、多资产交付和模型路由；不假设 Lovart 的内部实现，也不要求修改 Pi 核心来复制其内部名称。

## 1. 技术目标

技术实现必须让以下链路可持久化、可取消、可审计和可恢复：

```text
brief
  -> structured plan
  -> asset graph
  -> model/plugin execution
  -> artifact projection
  -> local refinement
  -> validation
  -> export package
```

首期优先复用当前 Desktop 的边界：

- Agent 继续由 Pi session worker 驱动；
- 插件继续使用标准 `ExtensionAPI`；
- 插件方法继续由 Desktop 的 `run_code` 聚合边界承载；
- renderer 通过 typed IPC 和现有 session projection 获取状态；
- 图像仍由 `pi.image-gen` 负责 Provider 适配和文件写入；
- `pi.web-access` 只负责研究和来源抓取，不把网页指令当成可信操作；
- 不修改 `packages/ai`、`packages/agent` 的 Agent loop 语义，除非后续证明存在通用缺口。

## 2. 架构概览

```text
Renderer
  Design Workbench
  ├─ Brief / Plan view
  ├─ Design Canvas
  ├─ Artifact Inspector
  └─ Export / Validation view
        │ typed preload IPC
        ▼
Electron Main
  DesignProjectService
  DesignArtifactService
  DesignExportService
  DesignAssetProtocol
  ├─ project persistence
  ├─ artifact index
  ├─ revision/CAS
  └─ opaque renderer handles
        │ session command / existing transport
        ▼
Thread Sidecar / Pi Session Worker
  Design Agent Extension
  ├─ plan orchestration
  ├─ asset graph scheduler
  ├─ model capability router
  ├─ quality checks
  └─ run_code plugin method bridge
        │
        ├─ pi.image-gen
        ├─ pi.web-access
        └─ future image/video/layout providers
```

### 2.1 所有权

| 能力 | 权威所有者 |
| --- | --- |
| 当前项目选择、画布视图状态 | renderer Workbench store |
| 项目、计划、资产索引和 revision | Electron main `DesignProjectService` |
| Agent 执行、工具调用和取消 | thread sidecar / Pi session worker |
| 生成模型和 Provider 适配 | Pi AI 或设计相关 Extension |
| 图像落盘 | `pi.image-gen` 或经过批准的 artifact writer |
| renderer 图片读取 | main-owned asset protocol / opaque resource handle |
| 当前 generation 的插件方法 | thread worker generation-local registry |

renderer 不能成为项目文件、资产字节或 Agent 执行的权威来源。sidecar 不直接接受 renderer 任意文件路径作为设计资产 identity。

## 3. 领域对象

所有跨进程 DTO 必须是可 structured clone、无 `any`、无 class instance、无 function 的 plain data。文件路径、密钥和供应商私有响应不能进入 renderer-facing DTO。

### 3.1 DesignProject

```ts
interface DesignProject {
  id: string;
  title: string;
  workspaceId: string;
  status:
    | "draft"
    | "planning"
    | "awaiting-approval"
    | "generating"
    | "reviewing"
    | "exporting"
    | "completed"
    | "partially-failed"
    | "failed"
    | "cancelled";
  brief: DesignBrief;
  brandKit?: BrandKitRef;
  plan?: DesignPlan;
  decisions: DesignDecision[];
  artifactIds: string[];
  activeArtifactId?: string;
  revision: string;
  createdAt: number;
  updatedAt: number;
}

interface DesignBrief {
  objective: string;
  audience?: string;
  product?: string;
  channels: DesignChannel[];
  mustInclude: string[];
  mustPreserve: string[];
  forbiddenChanges: string[];
  references: ReferenceAssetRef[];
  outputNotes?: string;
}

type DesignChannel = {
  id: string;
  name: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
  format?: "png" | "jpeg" | "svg" | "pdf" | "psd" | "mp4";
};
```

`workspaceId` 是 Desktop 已解析的项目 identity，不把绝对路径暴露给 renderer。缺少尺寸时可以由计划器提出建议，但不能静默把建议当成用户约束。

### 3.2 BrandKit

```ts
interface BrandKit {
  id: string;
  version: number;
  name: string;
  logos: BrandAssetRef[];
  colors: BrandColor[];
  typography: BrandFont[];
  layoutRules: string[];
  toneOfVoice?: string;
  protectedElements: string[];
  createdAt: number;
  updatedAt: number;
}

type BrandColor = {
  name: string;
  value: string;
  role?: "primary" | "secondary" | "accent" | "background" | "text";
};

type BrandFont = {
  family: string;
  role?: "display" | "body" | "label";
  weight?: string;
};
```

Brand Kit 的文件内容通过 main-owned asset store 管理。模型任务只接收必要的结构化 tokens 和 opaque asset references，不接收不可控的绝对路径。

### 3.3 DesignPlan

```ts
interface DesignPlan {
  id: string;
  projectId: string;
  version: number;
  summary: string;
  visualDirection: VisualDirection;
  sharedConstraints: DesignConstraint[];
  assets: PlannedAsset[];
  checks: DesignCheck[];
  approval: "pending" | "approved" | "rejected" | "superseded";
  createdAt: number;
}

interface VisualDirection {
  mood: string;
  composition: string;
  palette: string[];
  typography: string;
  referenceIds: string[];
}

interface PlannedAsset {
  id: string;
  name: string;
  kind: "hero" | "social" | "poster" | "email" | "product" | "storyboard" | "other";
  channel: DesignChannel;
  dependsOn: string[];
  variants: number;
  modelRequirements: ModelRequirement[];
  constraints: DesignConstraint[];
}

interface DesignConstraint {
  id: string;
  kind: "must-include" | "must-preserve" | "avoid" | "format" | "brand" | "accessibility";
  text: string;
  severity: "required" | "recommended";
}

interface DesignCheck {
  id: string;
  kind: "text" | "brand" | "dimension" | "contrast" | "asset-completeness" | "manual-review";
  description: string;
  severity: "blocking" | "warning";
}
```

计划器可以使用网页研究结果，但只保存来源、摘要和结构化结论，不保存隐藏推理全文。

### 3.4 DesignArtifact

```ts
interface DesignArtifact {
  id: string;
  projectId: string;
  plannedAssetId?: string;
  parentArtifactId?: string;
  kind: "image" | "video" | "audio" | "layout" | "document";
  status: "planned" | "queued" | "generating" | "ready" | "selected" | "exported" | "failed" | "archived";
  source: ArtifactSource;
  media?: ArtifactMedia;
  lineage: ArtifactOperation[];
  checks: ArtifactCheckResult[];
  createdAt: number;
  updatedAt: number;
}

interface ArtifactSource {
  modelId?: string;
  providerId?: string;
  promptSummary?: string;
  briefVersion: number;
  brandKitVersion?: number;
  referenceIds: string[];
}

interface ArtifactMedia {
  mimeType: string;
  width?: number;
  height?: number;
  durationMs?: number;
  resourceId: string;
  fileName: string;
  size: number;
}

interface ArtifactOperation {
  id: string;
  kind: "generate" | "edit" | "resize" | "remove-background" | "upscale" | "export";
  summary: string;
  createdAt: number;
}

interface ArtifactCheckResult {
  checkId: string;
  status: "passed" | "failed" | "warning" | "not-run";
  summary: string;
}
```

Artifact 是不可变版本。编辑不会覆盖父资产；它创建新的 `DesignArtifact` 并设置 `parentArtifactId`。

## 4. 持久化布局

推荐使用项目工作区下的 Desktop-owned 目录，不让 renderer 直接写入：

```text
<workspace>/.pi/design/
├─ projects/
│  └─ <project-id>/
│     ├─ project.json
│     ├─ plans.jsonl
│     ├─ decisions.jsonl
│     ├─ artifacts.jsonl
│     ├─ checks.jsonl
│     └─ exports/
├─ assets/
│  └─ <opaque-resource-id>.<ext>
└─ index.json
```

实现约束：

- `<project-id>` 使用 main 生成的安全 identity，不直接使用用户输入的标题；
- `project.json`、index 和 JSONL 使用同目录临时文件、fsync 和 atomic rename；
- project mutation 使用 expected revision/CAS；
- 资产文件使用不可变 resource ID，不能按用户文件名覆盖；
- renderer 只得到 `resourceId`、MIME、尺寸和文件名；
- 旧版本在没有 project、session、export 和 active view 引用后才能 GC；
- 生成失败不能删除父版本或已成功的同批资产；
- 现有 `pi.image-gen` 的通用默认目录 `.pi/images` 保持不变；Design Workbench 可以为设计任务提供受控的 artifact output directory。

如果未来需要将设计项目存到 Desktop userData，而不是 workspace，应保持同一个 `DesignProjectService` 合同，不让 renderer 或 sidecar 直接依赖存储路径。

## 5. Agent 执行模型

### 5.1 任务阶段

```text
CreateProject
  -> Plan
  -> AwaitApproval
  -> ScheduleAssets
  -> GenerateVariants
  -> ValidateArtifacts
  -> Review
  -> Edit / Retry
  -> Export
```

### 5.2 计划阶段

设计 Agent 首先输出 JSON-safe 的 `DesignPlan`，不要把完整隐藏推理注入消息。计划阶段可以调用：

- `pi.web-access`：市场、竞品和参考资料研究；
- 文件/图片读取：解析项目内参考素材；
- Brand Kit parser：提取颜色、字体和 Logo metadata；
- model capability catalog：查询模型支持的媒体类型、尺寸和编辑能力。

网页来源是不可信输入。网页中的指令、脚本、Prompt 或外部链接不能改变系统工具权限、文件范围或用户确认要求。

### 5.3 生成阶段

1. main 校验 project revision、plan version 和 user permission。
2. sidecar 创建 generation-local task graph。
3. 每个 `PlannedAsset` 解析出模型需求、参考素材和约束。
4. 独立任务进入并发调度；有依赖的任务等待父 Artifact ready。
5. 任务调用 design extension 或现有 `pi.image-gen`。
6. 结果以临时资源写入 asset store，校验 MIME、大小和文件 identity。
7. artifact metadata 和 parent lineage 原子提交。
8. renderer 收到 bounded progress 和 artifact snapshot。

### 5.4 协作与自主模式

协作模式：

```text
plan -> user approval -> bounded generation -> user selection -> edit
```

自主模式：

```text
plan -> policy check -> bounded generation -> auto-check -> review bundle
```

自主模式必须有：

- 最大资产数量；
- 最大并发数；
- 最大运行时间；
- 最大模型费用或 credits；
- 单资产最大重试次数；
- 遇到 required constraint 冲突时暂停并请求用户确认。

## 6. Plugin 与现有 Desktop 集成

### 6.1 复用现有 image-gen

当前 [`packages/plugins/pi-image-gen/index.ts`](../../plugins/pi-image-gen/index.ts) 已提供多 Provider 图像生成、参考图、变体、尺寸和质量参数。Design Agent 不复制 Provider adapter，而是通过稳定的内部 method contract 调用它。

参考调用形状：

```ts
const result = await plugin["pi.image-gen"].image_generate({
  prompt,
  image: referencePaths,
  n: plannedAsset.variants,
  size: channelSize,
  outputDir: controlledArtifactDirectory,
});
```

实际调用名称以当前 generation 捕获的 plugin method registry 为准。设计编排层不应把 Provider-specific URL、API key 或私有响应传给 renderer。

### 6.2 `run_code` 边界

现有 Desktop `run_code` 规范已经规定：

- 插件工具可以隐藏在 generation-local registry 中；
- 模型看到一个固定的 `run_code` 入口；
- 中间 method result 不进入 Pi transcript；
- 只有 outer return 和允许的附件进入模型结果；
- plugin methods 不构成权限 sandbox。

Design Agent 应使用这一边界承载普通设计插件方法，不为每个图片、视频和校验工具增加模型可见的 tool schema。

设计插件可以提供：

```text
plan_design
create_asset_batch
edit_artifact_region
validate_artifact
export_design_package
```

这些方法仍然必须使用标准 `ExtensionAPI` 注册，并接受标准的 abort、progress 和 context。设计专用的 UI 状态通过 bounded `RunCodeDetails`、project service snapshot 或已有 session projection传递，不直接让插件操作 React state。

### 6.3 Web research

`pi.web-access` 只在研究阶段或用户明确要求联网时使用。研究结果应转换为：

```ts
interface ResearchReference {
  id: string;
  title: string;
  url: string;
  sourceType: "web" | "file" | "user-upload";
  summary: string;
  claims: string[];
  fetchedAt: number;
}
```

不得把整页正文、网页脚本或不受控 HTML 直接写入 DesignPlan。用户可查看来源和摘要，但研究结论不自动成为品牌约束，除非用户确认或项目策略明确允许。

## 7. 模型能力路由

### 7.1 Capability catalog

不要根据模型名称硬编码“这个模型一定适合海报”。建立可配置能力 metadata：

```ts
interface ModelCapability {
  providerId: string;
  modelId: string;
  media: Array<"image" | "video" | "audio" | "3d">;
  operations: Array<"generate" | "edit" | "inpaint" | "outpaint" | "upscale" | "remove-background">;
  supportsReferenceImages: boolean;
  supportsMask: boolean;
  supportsReadableText: boolean;
  supportedSizes: string[];
  costClass: "low" | "medium" | "high";
  latencyClass: "fast" | "normal" | "slow";
}
```

### 7.2 路由规则

路由输入：

- PlannedAsset kind；
- 操作类型；
- 渠道尺寸；
- 是否需要可读文字；
- 是否需要局部编辑；
- 是否有参考图或 mask；
- 用户预算和延迟偏好；
- 当前 Provider auth 状态。

路由输出：

- 可用 model capability；
- 主模型和 fallback；
- 需要的输入格式转换；
- 估算成本和延迟；
- 不满足约束时的 blocking reason。

路由器不能在没有用户授权时静默切换到收费更高或不同数据政策的 Provider。失败时记录 route decision，便于比较质量与成本。

## 8. 局部编辑技术合同

### 8.1 请求

```ts
interface EditArtifactRequest {
  projectId: string;
  sourceArtifactId: string;
  operation:
    | "text"
    | "color"
    | "object"
    | "background"
    | "layout"
    | "remove-background";
  instruction: string;
  selection?: SelectionRef;
  preserve: PreserveConstraint[];
  brandKitVersion?: number;
  expectedProjectRevision: string;
}

type SelectionRef =
  | { type: "rect"; x: number; y: number; width: number; height: number; coordinateSpace: "normalized" | "pixel" }
  | { type: "mask"; resourceId: string; width: number; height: number };

type PreserveConstraint = {
  kind: "object" | "text" | "color" | "composition" | "lighting";
  description: string;
};
```

selection 的资源引用必须由 main 解析。renderer 不传任意本地 path，mask 必须属于当前项目或当前会话的 approved resource。

### 8.2 语义

- `sourceArtifactId` 必须是当前项目可见且未被删除的 Artifact；
- 局部编辑永远创建新 Artifact；
- 没有 selection 时，系统应提示用户这是全图编辑，而不是假装局部修改；
- `preserve` 进入模型任务和结果检查；
- Provider 不支持 mask 时，可以退化到参考图编辑，但 UI 必须显示“可能影响未选区域”；
- 输出校验失败时保留失败版本和诊断，不替换当前选中版本；
- 文字、Logo 和受保护产品元素的改变需要更高优先级检查。

### 8.3 当前阶段限制

当前图像插件支持参考图编辑，但没有统一的 mask、图层或对象 identity 合同。P0 可以先实现矩形选择和“保持约束”记录；真正的对象级 Touch Edit、可编辑文字层和图层分解属于 P1/P2，不能仅靠 Prompt 声称已经实现。

## 9. 计划调度与并发

### 9.1 Task graph

```ts
interface DesignTask {
  id: string;
  projectId: string;
  plannedAssetId: string;
  dependsOn: string[];
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  attempt: number;
  route?: ModelRoute;
  errorCode?: string;
}
```

规则：

- 依赖未完成时不能执行；
- 同一 Artifact 的 edit 操作默认串行；
- 不同 PlannedAsset 可以并行，但受全局 Provider 和项目预算限制；
- 一个任务失败不取消无依赖的任务；
- project cancel 传播到所有 queued/running task；
- generation replacement 后旧 task 的结果不能写入新 generation，必须通过 main revision 和 task token 检查。

### 9.2 预算

每个 project run 至少有：

- 最大任务数；
- 最大并行任务数；
- 最大重试次数；
- 最大运行时间；
- 最大 bytes；
- 可选的 cost/credit budget。

预算是 main/sidecar 的 host-owned policy，不由模型或插件的返回值增加。

## 10. IPC 与状态合同

### 10.1 Main API

建议新增独立 namespace，不把设计项目塞入通用 Desktop reducer：

```ts
interface DesktopDesignApi {
  listProjects(input: ListDesignProjectsInput): Promise<DesignProjectPage>;
  getProject(input: GetDesignProjectInput): Promise<DesignProjectSnapshot>;
  createProject(input: CreateDesignProjectInput): Promise<DesignProjectSnapshot>;
  updateBrief(input: UpdateDesignBriefInput): Promise<DesignMutationResult>;
  createBrandKit(input: CreateBrandKitInput): Promise<DesignMutationResult>;
  approvePlan(input: ApproveDesignPlanInput): Promise<DesignMutationResult>;
  startRun(input: StartDesignRunInput): Promise<DesignRunResult>;
  editArtifact(input: EditArtifactRequest): Promise<DesignRunResult>;
  cancelRun(input: CancelDesignRunInput): Promise<void>;
  exportProject(input: ExportDesignProjectInput): Promise<DesignExportResult>;
  openArtifact(input: OpenDesignArtifactInput): Promise<void>;
  subscribe(listener: (event: DesignEvent) => void): () => void;
}
```

所有 mutation 至少包含 `requestId`、`projectId`、`expectedRevision` 和用户动作来源。main 负责 runtime validation、revision check、scope check 和路径解析。

### 10.2 Events

```ts
type DesignEvent =
  | { type: "project-updated"; projectId: string; revision: string }
  | { type: "plan-updated"; projectId: string; planId: string }
  | { type: "task-status"; projectId: string; taskId: string; state: string; summary: string }
  | { type: "artifact-created"; projectId: string; artifact: DesignArtifactSummary }
  | { type: "artifact-check"; projectId: string; artifactId: string; result: ArtifactCheckResult }
  | { type: "run-finished"; projectId: string; runId: string; state: string };
```

事件只发送 bounded summaries。renderer 需要完整项目快照时显式调用 `getProject`，不能通过事件携带整个图片或完整模型响应。

### 10.3 Renderer 目录

遵循现有 renderer 依赖方向，建议：

```text
packages/desktop/src/renderer/src/features/design/
  design-workbench.tsx
  design-workbench-model.ts
  design-workbench-controller.ts
  design-project-list.tsx
  design-plan-panel.tsx
  design-artifact-inspector.tsx
  design-export-panel.tsx

packages/desktop/src/renderer/src/components/panel/design/
  design-canvas.tsx
  design-canvas-item.tsx
  design-asset-variant-picker.tsx
  design-selection-overlay.tsx
  design-run-activity.tsx
```

约束：

- 每个 `.tsx` 文件最多一个顶层 React component；
- 不在组件内部声明组件；
- route 只负责组合；
- project snapshot、canvas selection 和 chat runtime 不互相成为第二权威源；
- 高频 artifact/task 更新通过 selector 只更新消费它的叶子；
- 图片使用现有 session/resource 或设计 asset opaque handle；
- 不向 renderer 传绝对路径、API key、原始 provider response 或网页正文。

## 11. Canvas 合同

画布元素使用稳定 identity：

```ts
interface CanvasItem {
  id: string;
  artifactId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  selected: boolean;
  status: "normal" | "generating" | "failed" | "archived";
}
```

要求：

- 坐标和尺寸使用稳定的 canvas coordinate space，不因窗口 resize 改变 Artifact identity；
- loading、error、长标题和按钮不能改变卡片的外部尺寸；
- selected/hover/focus 使用 data attributes；
- 选区操作必须有 keyboard fallback 和 accessible label；
- 画布缩放、平移和选择状态属于 renderer view state，不写入每次 project revision；
- 用户明确保存的布局位置才写入项目文档；
- 画布只渲染已授权 project artifacts，不能用任意 URL 加载远程图片。

## 12. 校验器

### 12.1 生成前

- project revision 未冲突；
- plan 已批准或当前模式允许自动批准；
- asset 数量、尺寸和格式合法；
- Brand Kit version 存在；
- reference resource 属于 project/session scope；
- model route 满足媒体、编辑和尺寸能力；
- budget 足够；
- output directory 是 main-approved artifact store。

### 12.2 生成后

至少支持以下 checks：

- MIME 和文件大小；
- 图片尺寸和比例；
- OCR 文字存在性和基本可读性；
- required text 是否缺失或溢出；
- Brand Kit 颜色近似度；
- Logo 资源是否存在；
- 资产数量和计划覆盖率；
- 局部编辑 preserve 约束的可观察检查；
- 导出 manifest 与实际文件一致。

检查失败不一定丢弃 Artifact。根据 `severity` 标记为 blocking、warning 或 manual review。

## 13. 错误、取消和恢复

稳定错误类别建议：

```text
DESIGN_PROJECT_NOT_FOUND
DESIGN_PROJECT_REVISION_CONFLICT
DESIGN_PLAN_INVALID
DESIGN_PLAN_NOT_APPROVED
DESIGN_ASSET_LIMIT_EXCEEDED
DESIGN_ROUTE_UNAVAILABLE
DESIGN_PROVIDER_AUTH_REQUIRED
DESIGN_REFERENCE_NOT_FOUND
DESIGN_ARTIFACT_NOT_FOUND
DESIGN_EDIT_SCOPE_INVALID
DESIGN_ARTIFACT_VALIDATION_FAILED
DESIGN_EXPORT_FAILED
DESIGN_RUN_ABORTED
DESIGN_GENERATION_STALE
```

语义：

- Abort 只停止当前 run，不删除已提交 Artifact；
- timeout 后 late provider result 必须丢弃；
- 单个 task 失败时项目进入 `partially-failed`，除非失败的是 blocking dependency；
- retry 创建新 task attempt，并保留失败诊断；
- project revision conflict 返回当前快照，不覆盖用户本地修改；
- replacement worker 或 sidecar dispose 后旧 generation 不得写入项目；
- export 失败不改变当前 Artifact selected 状态。

## 14. 安全与隐私

- 设计插件继承当前 Desktop Extension 的 full-trust 模型；Skill、capability 和 model route 不是权限 sandbox。
- 用户上传的 Brand Kit 和产品图不得默认发送到未被用户启用的 Provider。
- Provider 路由必须展示或可查询数据处理和费用边界。
- 网页研究内容是不可信输入，必须经过 source extraction 和 bounded summary。
- 设计任务不能通过模型返回的 outputDir 绕过 workspace/artifact store containment。
- 文件名、Logo metadata、OCR 文本和网页内容均视为不可信字符串，写入 manifest 前须进行长度和字符校验。
- 日志不得包含 API key、绝对路径、原始图像 base64、完整网页正文或完整 provider response。
- 设计资产 resource ID 使用随机 opaque identity，不能编码 project path、session ID 或用户文件名。
- 只在需要时向模型提供图片；画布读取使用 main-owned resource protocol。

## 15. 失败模式与技术取舍

### 15.1 不把 MCoT 当作实现目标

Lovart 使用 MCoT 作为公开产品名称。本项目不需要复制名称或隐藏推理过程。可实现、可评估的替代物是：

```text
DesignPlanner
+ DesignPlan schema
+ ModelCapabilityRouter
+ BrandConstraintCompiler
+ ArtifactValidator
```

需要保留的是结构化行为，而不是内部思维链。

### 15.2 不先改 Pi Agent Core

首期可通过 Desktop plugin、`run_code`、main-owned project service 和 renderer workbench 完成闭环。只有当现有 Pi 生命周期无法表达设计事件、附件或取消语义时，才提出通用 core contract，并附带 core tests。

### 15.3 不把每个资产变成一个顶层 tool

顶层 tool 数量和模型 schema 会随设计能力增长，导致上下文变大、工具选择变差。设计能力应由一个稳定的 orchestrator/plugin method 入口承载，资产级状态放在 DesignProject 和 Artifact graph 中。

### 15.4 不用 Prompt 假装支持局部编辑

如果 Provider 没有 mask、对象 identity 或 inpaint 能力，系统必须在 UI 中标明编辑精度等级：

```text
exact-region
reference-guided
full-image-regeneration
```

精度等级写入 Artifact operation，供评测和用户判断。

## 16. 可观测性

每个 run 和 task 记录：

- projectId、runId、taskId；
- brief/plan/brandKit version；
- route decision、provider/model；
- queued/running/provider/validation/export latency；
- attempt、error code、bytes 和 cost estimate；
- artifact parent/operation；
- user approval、selection 和 rejection action。

默认不记录 Prompt 全文和图片内容。需要调试时使用用户明确开启的 redacted diagnostic mode。

产品指标与技术指标分开：产品指标衡量“能否交付”，技术指标衡量“调用是否稳定”。

## 17. 测试计划

### 17.1 Domain tests

- DesignPlan schema 和 revision；
- Brand Kit 版本绑定；
- Artifact parent lineage；
- task graph dependency；
- cancel、retry 和 partial failure；
- export manifest；
- model capability route；
- preserve constraint 编译；
- project path containment。

### 17.2 Main/IPC tests

- project CRUD；
- expected revision conflict；
- atomic save 和 crash recovery；
- opaque resource open；
- renderer 不可提交任意路径；
- stale event 和 generation guard；
- 任务取消后的 late result；
- 资产 GC 不删除仍被 session/export 引用的文件。

### 17.3 Plugin/sidecar tests

- `pi.image-gen` reference image 和 output directory 合同；
- `run_code` plugin registry 的 method validation；
- method abort、timeout、parallel/serial lane；
- Provider route fallback；
- 一个任务失败不影响无依赖任务；
- worker replacement 不复用旧 registry；
- web research content 不改变 tool permission。

### 17.4 Renderer tests

- 项目列表和 workbench 生命周期；
- plan approve/reject；
- canvas artifact identity；
- selection overlay；
- variant compare；
- task status updates 只更新对应卡片；
- 1024x680 和宽屏布局不重叠；
- keyboard focus、ARIA、loading/error/empty states；
- canvas resize 不改变 artifact identity。

## 18. 实施阶段

### Phase 0：领域合同

新增共享领域类型、project/artifact persistence service 和 fixture。先用固定图片和 fake provider 验证 brief、plan、artifact lineage、revision 和 export manifest。

### Phase 1：接入现有图片插件

将 `pi.image-gen` 的结果映射成 DesignArtifact，建立画布和变体卡片；不实现局部 mask，先实现引用、版本和基础重试。

### Phase 2：Brand Kit 与局部编辑

增加结构化 Brand Kit、矩形 selection、保留约束和 edit lineage。Provider 不支持精确局部编辑时明确降级等级。

### Phase 3：路由、检查和自主模式

增加 model capability catalog、任务图并发调度、成本预算、生成后 checks 和 autonomous policy。

### Phase 4：更多媒体和团队协作

在图像闭环稳定后再增加视频、音频、3D、评论、审批和可复用 Design Skill。

## 19. 验收标准

全部满足才认为 P0 Design Workbench 完成：

1. 用户可以创建、关闭并恢复设计项目。
2. brief、参考图、计划和资产状态可持久化。
3. 多资产计划可以并行生成，单个失败不会删除成功资产。
4. 每个 Artifact 有稳定 ID、父版本、operation 和资源引用。
5. 画布可以展示、比较、选择和归档变体。
6. project revision conflict 不会覆盖用户修改。
7. renderer 不接收绝对路径、API key 或任意远程图片 URL。
8. 图片生成复用现有插件 Provider adapter，不复制 Provider 认证代码。
9. Agent 生成结果可以通过现有 `run_code`/plugin method 边界执行并观察。
10. 取消、超时、worker replacement 和 late result 都有明确处理。
11. 生成任务有预算、并发和重试上限。
12. 导出包含 manifest、渠道尺寸和 Artifact 版本关系。
13. UI 在加载、生成、失败、部分成功和空项目状态下可用且无布局重叠。
14. Domain、main/IPC、sidecar/plugin 和 renderer 都有 focused tests。
15. `npm run check`、Desktop typecheck、renderer boundary checks 和 `git diff --check` 通过。

## 20. 参考实现文件边界

初始实现建议放置在：

```text
packages/desktop/src/main/design/
  design-project-service.ts
  design-artifact-service.ts
  design-export-service.ts
  design-asset-store.ts
  design-model-router.ts

packages/desktop/src/shared/
  design-contracts.ts

packages/desktop/src/renderer/src/features/design/
  design-workbench.tsx
  design-workbench-model.ts
  design-workbench-controller.ts

packages/desktop/src/renderer/src/components/panel/design/
  design-canvas.tsx
  design-artifact-card.tsx
  design-artifact-inspector.tsx
  design-selection-overlay.tsx

packages/plugins/pi-design-agent/
  index.ts
  plugin-api.json
  skills/pi-design-agent/SKILL.md
```

这些路径是参考边界，不代表必须一次创建全部文件。实现应先从一个端到端 vertical slice 开始，再扩展抽象。
