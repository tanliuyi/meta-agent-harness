# Pi Desktop 产品边界

状态：Accepted
最后更新：2026-07-23

## 1. 决策

Pi Desktop 是 Pi 的桌面宿主和分发形态，不是独立于 Pi 的另一套产品或 runtime。

Desktop 必须内嵌并运行随自身版本发布的标准 Pi runtime，同时不要求用户在系统中预先安装 Pi CLI。用户是否安装全局 Pi，以及全局 Pi 与 Desktop 内嵌 Pi 的版本是否一致，都不得改变 Desktop 会话的运行行为。

核心原则是：

> 运行时隔离，用户数据兼容。

## 2. 产品模型

```text
Pi Runtime
|-- Pi CLI：终端宿主
`-- Pi Desktop：图形宿主
```

CLI 与 Desktop 共享：

- coding-agent 核心实现和标准 CLI lifecycle；
- model、auth、settings、prompt、skill 和 extension 语义；
- session JSONL 和项目 `.pi` 配置格式；
- provider、tool 和 extension API 契约；
- 同一 Pi 版本中的行为语义。

Desktop 可以提供窗口、路由、线程列表、系统集成、自动更新和 Desktop 内置 provider。这些属于宿主能力，不得形成另一套 session runtime、配置体系或 extension loader。

## 3. 安装与启动边界

Desktop 发布物必须包含其声明版本的标准 Pi 构建产物，因此不得依赖：

- 用户全局安装 `pi`；
- `npm install -g` 或 `npx pi`；
- 系统 `PATH` 中存在 Pi；
- 系统 Pi 与 Desktop 使用相同版本。

Node runtime 可以来自经过兼容性校验的系统 Node，也可以由 Desktop 管理安装。一次 Desktop 会话选定 Node 后，sidecar 和该会话派生的 Pi 子进程必须使用同一个 Node runtime、同一个 Pi entry 和同一个 Pi 版本。

Desktop 提供给 PATH 的 `pi` 只允许是当前会话的轻量启动器。启动器必须转发到当前选定 Node 和 Desktop 内嵌 Pi entry，不得内嵌第二套 Node 或第二套 Pi runtime。

## 4. 多版本共存

用户可以同时拥有不同版本的 Pi CLI 和 Pi Desktop，例如：

```text
系统 Pi CLI：0.78
Pi Desktop 内嵌 Pi：0.80
```

两者是同一产品的不同安装实例，但运行时彼此隔离：

- Desktop 始终使用随自身发布并经过验证的 Pi 版本；
- Desktop 不得根据系统 PATH 静默改用全局 Pi；
- 全局 Pi 的安装、升级、降级或卸载不得改变 Desktop 行为；
- Desktop 更新 Pi 版本时必须随 Desktop 版本一起测试和发布；
- 外部 Pi binary 只有经过明确选择及版本、协议和 runtime 兼容校验后才可使用，首期不支持该能力。

“同一产品”描述的是实现、协议和用户资产的共同所有权，不表示不同安装实例必须执行同一个磁盘上的 binary。

## 5. 子进程与扩展

Desktop sidecar 加载标准 Pi extension tree。扩展无需识别 Electron、Desktop 或专用 runtime。

扩展通过以下方式派生 Pi 时，必须回到当前 Desktop 会话锁定的 Pi runtime：

```text
pi ...
<selected-node> <desktop-pi-entry> ...
process.execPath + process.argv[1]
```

Desktop 必须为 sidecar 和扩展子进程设置会话级 PATH、Pi entry 和 runtime identity。不得静默回退到：

- 系统 Pi；
- 全局 npm package；
- `npx pi`；
- 未经校验的 `PI_SUBAGENT_PI_BINARY`；
- 与 sidecar Node ABI 不同的内嵌 executable。

扩展显式执行用户提供的绝对路径属于扩展主动调用外部程序，不属于 Desktop 的内部 Pi 路由保证。

## 6. 环境变量

Desktop 应继承标准 Pi 的配置、认证、provider 和网络环境语义，但必须规范化会改变内部 binary 路由的变量。

至少遵守以下规则：

- `PI_CODING_AGENT_DIR` 指向当前 Desktop 与 Pi 共享的 agent directory；
- Desktop 内部 entry 和 runtime identity 由 Desktop 设置，外部环境不得覆盖；
- PATH 中当前 Desktop 会话的 Pi 启动器优先于系统 Pi；
- `PI_SUBAGENT_PI_BINARY` 等 binary override 不得让会话切换到未经兼容性校验的 Pi；
- 环境变量只在 Desktop 进程启动及子进程创建时继承，其他 Pi 进程运行后不能反向修改 Desktop 环境。

## 7. 用户数据兼容

运行时隔离不能演变为用户资产隔离。CLI 与 Desktop 应共享 Pi 的用户数据，但共享数据必须有明确兼容契约。

### 7.1 共享资产

以下资产原则上共享：

- `agentDir` 下的 auth、models、settings、prompts、skills、extension package 声明和本地 extension source；
- 项目 `.pi` 配置；
- session JSONL 和 session metadata。

Desktop 不得复制、投影或维护一套语义不同的用户配置。npm extension 的 materialized `node_modules` 是按 runtime fingerprint 隔离的可重建派生状态，不属于跨 runtime 共享用户资产。

### 7.2 Runtime dependency isolation

不同 Node ABI 不得加载同一个 materialized npm dependency tree。支持 runtime isolation 的宿主必须：

- 以完整 runtime identity 选择独立 npm root，磁盘目录使用稳定 hash；
- 在 runtime manifest 中记录 schema、runtime identity、Node version、modules ABI、platform 和 arch；
- 缺少当前 runtime tree 时 fail closed，不回退 legacy/global `node_modules`；
- Desktop 不在 session 启动时自动联网、install、rebuild 或执行 lifecycle scripts；
- 只有用户在 Desktop 中明确确认“更新扩展”，或显式执行 Pi package 命令，才可以准备当前 runtime tree；
- Desktop 的恢复操作只安装错误中标识的缺失 npm package，不顺带升级其他 npm/git/local extensions；
- 保留 legacy tree 供旧 Pi 使用，不移动、覆盖或删除；
- 一个 worker 生命周期内固定使用同一个 runtime tree。

首期仅保证 Pi-managed npm packages。git package 和本地 extension 仍由用户管理；如果它们包含 ABI-bound native dependencies，必须返回可诊断的不兼容错误，不能宣称已隔离。客户界面只说明“需要更新扩展”及联网/安装脚本风险；Node、ABI、runtime fingerprint 和 entry path 仅进入日志与诊断。

### 7.3 兼容要求

- 持久化格式必须可识别 schema 或格式版本；
- 新版本读取旧格式时，迁移必须原子化并可诊断；
- 写回结构化配置时应保留未知字段，避免不同版本互相抹除数据；
- reader 应忽略其能够安全忽略的未知可选字段或事件；
- 无法安全读写的数据版本必须阻止写入并明确提示，不得静默覆盖；
- 真正不兼容的数据升级应隔离受影响的派生状态，而不是复制全部 Pi 用户资产。

具体 schema 的兼容范围由对应配置或 session 规范定义。本文件只规定产品层面的兼容责任。

## 8. 并发写入

共享用户数据不代表不同安装实例可以无协调地同时写入同一资源。

- 配置写入必须使用现有 revision、原子替换和冲突检测；
- Desktop 与 CLI 首期不保证同时写同一个 session；
- 未实现跨进程 writer ownership 前，不得宣称支持 Desktop 与 CLI 同时操作同一 live session；
- 后续若支持并发，必须另行定义锁、writer identity、事件顺序和崩溃恢复协议。

## 9. 发布与验收

每个 Desktop 发布物必须声明并验证其内嵌 Pi 版本。验收至少覆盖：

1. 用户未安装系统 Pi 时，Desktop 和扩展派生 Pi 均可运行；
2. 系统 Pi 版本低于 Desktop 内嵌版本时，Desktop 仍使用内嵌版本；
3. 系统 Pi 版本高于 Desktop 内嵌版本时，Desktop 仍使用内嵌版本；
4. PATH 和 binary override 指向其他 Pi 时，不会静默改变 Desktop runtime；
5. sidecar 与派生 Pi 使用相同 Node 版本、modules ABI、Pi entry 和 Pi 版本；
6. CLI 与 Desktop 对共享配置、扩展和 session 资产遵守对应兼容规范；
7. 打包、签名和更新后，runtime identity 与完整性校验仍然有效。

## 10. 非目标

本边界不要求：

- 用户安装或升级全局 Pi；
- Desktop 调用用户的全局 Pi binary；
- 不同版本的 Pi 安装实例共享进程或可执行文件；
- 首期支持外部 Pi runtime 切换；
- 首期支持 CLI 与 Desktop 同时写同一个 live session；
- Desktop 为某个第三方 extension 实现专用派生逻辑。

## 11. 相关规范

- [Desktop Node Sidecar 规范](./node-sidecar-per-thread-spec.md)
- [Desktop 内置 Provider 规范](./builtin-provider-spec.md)
- [Desktop application updates](./application-update-spec.md)
