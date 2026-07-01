# Desktop Specs

本目录把 [Desktop Coding Agent 架构](../desktop-architecture.md) 拆成可实现、可验收的规格。

第一期目标是完成后端能力、utility worker、IPC 与 renderer 数据层联调，并提供简单可用 UI。所有 spec 都必须遵守一个总原则：Desktop 与 Pi 保持同构内核，session、event、config、resource、extension、tool 语义不走两条分支。

## Specs

- [01. Pi 同构兼容](01-pi-compatibility.md)
- [02. Worker Protocol](02-worker-protocol.md)
- [03. Thread Worker Registry](03-thread-worker-registry.md)
- [04. Electron IPC 与 Preload API](04-electron-ipc.md)
- [05. 状态存储与数据库](05-state-storage.md)
- [06. 第一期验收规格](06-phase-one-acceptance.md)
- [07. Project / Workspace](07-project-workspace.md)

## 分层关系

```text
Renderer，第一期接入数据层和简单 UI
  |
  | preload typed API
  v
Electron main
  |
  | ThreadManager + ThreadWorkerRegistry + 状态索引
  v
Coding agent worker
  |
  | Pi-compatible canonical runtime
  v
AgentSession / SessionManager / Tools / Extensions / Settings
```

## 约束

- 实时事件走 transport，不走数据库。
- 数据库只做索引、缓存、恢复和查询。
- JSONL session 是 canonical persistence。
- projection event 和 desktop snapshot 不替代 Pi canonical event/session。
- renderer 不直接获得 shell、filesystem、worker process 或 credential 权限。
