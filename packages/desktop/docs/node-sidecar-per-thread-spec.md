# Desktop Node Sidecar 规范

状态：Accepted
最后更新：2026-07-23

## 1. 目标

本规范遵循 [Pi Desktop 产品边界](./pi-product-boundary.md)：Desktop 是 Pi 的桌面宿主和版本锁定分发实例，不依赖或隐式调用用户全局安装的 Pi。

Desktop 将标准 Pi runtime 放在普通 Node sidecar 中运行，每个 live thread 一个 worker，metadata 使用独立 worker。Electron main 只负责 IPC、窗口、项目状态和 worker 生命周期。

Desktop 与 Pi CLI 使用同一套：

- `agentDir` 和 Project `.pi` 配置；
- extension package 声明、source、启用状态和发现顺序；
- model、auth、settings、prompt、skill 和 session JSONL 语义。

npm extension 的 materialized `node_modules` 按 runtime identity 隔离，不能跨 Node ABI 共享。Desktop 不修改 legacy npm tree，也不自动安装、重建或执行 extension lifecycle scripts。现有扩展无需修改即可派生标准 Pi runtime，包括通过 `process.argv[1]` 重新启动当前入口或通过 PATH 执行 `pi`。

## 2. Node runtime

sidecar 必须使用用户系统中的普通 Node，版本要求 `>=22.19.0`。探测顺序为：

1. `PI_DESKTOP_NODE_EXEC_PATH`；
2. Desktop 用户级安装目录中的 active Node；
3. 当前进程 `PATH` 中的 `node`。

启动前校验 Node 版本、platform、arch 和 modules ABI。禁止使用 Electron `process.execPath`、`utilityProcess`、`ELECTRON_RUN_AS_NODE=1` 或 shell 猜测 PATH。

打包版 `runtime-manifest.json` 使用 `nodePath: "system"`，不包含 Node executable、npm CLI 或 native runtime。sidecar JS 位于 `app.asar.unpacked` 的真实文件系统，并通过 manifest 校验。

Desktop 发布物必须包含其声明版本的标准 Pi 构建产物和真实 CLI entry。Desktop 可以提供 `pi-sidecar/bin/pi`（Windows 为相应平台启动器）供 PATH 调用，但该文件只能是轻量启动器：它必须复用 thread worker 当前选定的 Node、Pi CLI 入口、内置 provider factories、`agentDir` 和 runtime 配置，不得内嵌第二套 Node 或 Pi runtime。manifest 必须记录启动器、入口和 runtime identity 的路径与完整性。

worker 启动环境必须将 Desktop Pi 启动器目录放在 PATH 最前，并提供真实 CLI entry。扩展派生的 runtime 不得回退到系统 `pi`、全局 npm 包、`npx pi` 或未经兼容性校验的 `PI_SUBAGENT_PI_BINARY`，也不得为某个扩展实现专用分支。

## 3. 缺失 Node 的一键安装

如果没有可用 Node，main 仍创建窗口，但 renderer 显示阻断式 NodeRuntime 面板，禁止进入会话 UI。面板显示最低版本、当前阶段、百分比、错误信息和重试按钮。

点击安装后：

1. 从 Node 官方 distribution 下载固定版本 archive；
2. 按平台和架构选择 darwin arm64/x64、linux arm64/x64 或 win32 arm64/x64 包；
3. 下载过程中发送 `checking`、`downloading`、`verifying`、`extracting`、`ready` 或 `error` 进度；
4. 校验固定 SHA-256，不接受校验失败的文件；
5. 解压到 `<userData>/node-runtime`，使用 staging 目录和原子 `active.json`；
6. 安装成功后自动重启 Desktop，重启后 sidecar 直接使用该 Node。

安装器不需要用户打开终端、选择目录或确认脚本。失败时删除 staging，保留 cache 和错误原因，用户可再次点击重试。

## 4. Sidecar topology

```text
Renderer -> preload -> Electron main
                         |-> ThreadWorkerRegistry
                         |    |-> thread A ordinary Node
                         |    |-> thread B ordinary Node
                         |-> MetadataWorkerClient
                         |-> ProjectStore / files / PTY
```

每个 thread worker 只持有一个 `SessionRuntime` 和一个 live `AgentSession`。worker 崩溃只影响当前 thread；恢复只能通过新 worker 和 fresh bootstrap，不自动重放 prompt、edit、reload、cancel、compact 或其他有副作用命令。

metadata worker 只处理 catalog、draft 配置和 cold session metadata，不打开 registry 中的 live session。live rename/remove 必须路由给对应 thread worker并串行化。

## 5. Extension loading

sidecar 使用 Pi 默认 resource loader 从共享 extension tree 加载扩展。

扩展启动子 Pi 时继承当前 worker 的 Desktop runtime 环境。通过 PATH 执行 `pi` 和通过 `process.execPath` 加 `process.argv[1]` 派生的进程都必须进入同一标准 CLI lifecycle，并继续加载用户配置、第三方扩展和 Desktop 内置 provider。Desktop 不要求扩展识别 Electron、sidecar 或 Desktop 启动器。

Desktop 不执行 lifecycle script approval，也不在缺依赖时自动安装或 rebuild；当前 runtime npm tree 缺失时直接返回包含 runtime identity 和显式 `pi install` 修复命令的错误。扩展安装和依赖变更由同一 Desktop runtime 下的 Pi CLI/用户管理，Desktop 下次启动或新建 worker 时读取对应 runtime tree。git package 与本地 extension 首期不提供 native dependency 隔离保证。

## 6. IPC 和生命周期

- sidecar wire protocol 独立于 renderer protocol，带 protocol version、worker instance、request correlation 和 event sequence；
- request/response 必须 settle exactly once；worker exit 拒绝 pending request；
- timeline 队列有上限、ACK/credit 和 resync；
- attach 使用 token，迟到事件不能污染新 thread；
- graceful shutdown 超时后 TERM/KILL，退出后不得留下 orphan child；
- Electron 单实例锁和 registry single-flight 保证 Desktop 内同一 thread 只有一个 writer；确认旧 child 退出前不得启动替代 worker；
- CLI 与 Desktop 首期不保证同时写同一 session。

## 7. 当前实现文件

- `src/main/sidecar/node-runtime-locator.ts`：Node 探测、版本和 manifest；
- `src/main/sidecar/node-runtime-installer.ts`：下载、校验、解压和进度；
- `src/main/index.ts`、`src/main/ipc.ts`、`src/preload/index.ts`：生命周期和 IPC；
- `src/renderer/src/App.tsx`、`src/renderer/src/styles/components.css`：阻断面板；
- `src/main/sidecar/thread-worker-registry.ts`、`src/sidecar/thread-worker-service.ts`：thread worker；
- `src/main/sidecar/metadata-worker-client.ts`、`src/sidecar/metadata-worker-service.ts`：metadata worker；
- `scripts/build-desktop-pi-executable.mjs`：Desktop Pi 轻量启动器构建实现；
- `scripts/generate-desktop-sidecar-manifest.mjs`：开发/打包 manifest；
- `scripts/desktop-pi-smoke.mjs`、`scripts/validate-desktop-package.mjs`、`scripts/smoke-desktop-sidecar.mjs`：产物和扩展派生校验。

## 8. 验证与发布门槛

代码修改后运行：

```sh
npm run check
```

桌面产物验证：

```sh
npm --prefix packages/desktop run package
npm --prefix packages/desktop run smoke:sidecar -- --artifact <resources-or-app>
npm --prefix packages/desktop run smoke:gui -- --artifact <app> --mode both
```

验收必须确认：

- packaged manifest 的 `nodePath` 为 `system`，npm CLI 和 Node integrity 为空；
- 安装包不包含内置 Node 或 `node-runtime` 目录；
- 安装包包含目标平台 Pi 启动器和标准 Pi entry，路径和 integrity 与 manifest 一致；
- sidecar 与扩展派生 Pi 使用相同 Node 版本、modules ABI、Pi entry 和 Pi 版本；
- 无 Node 时 renderer 阻断并可一键完成安装和自动重启；
- Desktop 与 Pi CLI 看到同一 extension 声明；相同 runtime identity 使用同一 npm tree，不同 ABI 使用不同 tree；
- 隔离临时 `agentDir` 中的普通扩展可通过 PATH `pi` 和当前 `process.argv[1]` 派生标准 Pi，测试不得继承或写入用户真实 `PI_CODING_AGENT_DIR`；
- sidecar smoke、GUI smoke、focused tests 和根级 `npm run check` 通过。

## 9. 相关规范

- [Pi Desktop 产品边界](./pi-product-boundary.md)
- [Desktop 内置 Provider 规范](./builtin-provider-spec.md)

## 10. 非目标

- 不实现 Electron 专用 native dependency tree；
- 首期不实现 immutable generation、自动迁移或 runtime dependency GC；
- 不在 Desktop 中执行 npm install/rebuild/lifecycle approval；
- 不把 renderer 直接连接到 sidecar；
- 不修改 Pi session JSONL schema。
