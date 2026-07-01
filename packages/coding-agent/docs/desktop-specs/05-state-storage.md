# 05. 状态存储与数据库 Spec

## 目标

定义 Desktop 后端状态层。数据库用于持久化、索引、恢复和查询，不用于实时通信。实时事件和命令必须走 transport。

## Canonical Persistence

Pi-compatible JSONL session 是 canonical persistence。

必须保持：

- session entry 兼容。
- branching 兼容。
- import/export 兼容。
- compaction/fork/clone 兼容。

数据库不能成为 session 的不兼容第二真相源。

## 数据库职责

数据库适合存储：

- thread registry
- session metadata index
- messages index
- tool call timeline
- file changes
- approvals
- worker run records
- crash/error diagnostics
- model/settings snapshot
- projection event log
- normalized state cache

数据库不负责：

- prompt/abort/steer/followUp 命令投递
- streaming delta 实时传递
- tool output 实时传递
- heartbeat
- worker lifecycle control
- backpressure/cancel/timeout

## 推荐表

```text
threads
  thread_id
  cwd
  session_file
  title
  status
  archived_at
  created_at
  updated_at

thread_snapshots
  thread_id
  snapshot_json
  updated_at

message_index
  thread_id
  session_entry_id
  role
  summary
  created_at

tool_calls
  thread_id
  tool_call_id
  tool_name
  status
  args_json
  result_summary
  started_at
  finished_at

file_changes
  thread_id
  tool_call_id
  path
  change_type
  patch
  created_at

approvals
  approval_id
  thread_id
  status
  request_json
  response_json
  created_at
  resolved_at

worker_runs
  worker_id
  thread_id
  status
  pid_hash
  started_at
  exited_at
  exit_code
  signal
  stderr_tail

diagnostics
  id
  thread_id
  source
  severity
  message
  details_json
  created_at
```

`pid_hash` 表示如需记录 pid，也应避免直接暴露给 renderer。

## 写入策略

实时路径：

```text
Worker -> transport event -> Electron main -> preload IPC -> Renderer
```

持久化路径：

```text
Worker/Main -> normalize/index -> database
```

要求：

- 数据库写入失败不应阻塞 canonical agent run，除非失败会破坏 session persistence。
- 数据库错误必须进入 diagnostics。
- session JSONL 写入失败是更高优先级错误，必须进入 thread error。

## Snapshot 恢复

恢复优先级：

1. 如果 worker running，向 worker 请求 snapshot。
2. 如果 worker idle/stopped，从 JSONL session + database index 构建 snapshot。
3. 如果数据库缺索引，从 JSONL session 重建最小 snapshot，并补索引。

## Storage Paths

Desktop 可以使用 Electron `app.getPath('userData')` 作为宿主根目录。路径可配置，但 Pi settings/resource/session 语义不能分叉。

建议：

```text
userData/
  meta-agent.db
  coding-agent/
    sessions/
    logs/
    cache/
```

如果需要兼容 `.pi`：

- `.pi` 可以作为 project resource source。
- Pi session import/export 应显式支持。
- 默认路径变化不能改变 Pi config 字段语义。

## 验收

- 不启动 renderer UI，也可以通过 main/test 创建 thread 并在 DB 中看到 registry。
- worker streaming 不依赖 DB。
- DB 删除后，可以从 JSONL session 重建最小 thread snapshot。
- JSONL session 与 DB 索引冲突时，以 JSONL canonical session 为准。
- DB 中不保存明文 credential。
