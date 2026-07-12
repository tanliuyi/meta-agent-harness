# Changelog

## [0.0.19] - 2026-07-12

### Added

- **Hermes Memory 技能集成**: 资源快照 (`getResourceSnapshot`) 现在自动发现 Desktop 内置 Hermes Memory 扩展通过 `resources_discover` 注入的技能，包括 user 级和 project 级技能。当与已有 extension 注册的技能名称冲突时，优先保留已有技能。
- **Project 选择自动发现 Command**: 选择 Project 后自动触发 `loadOrphanCommands`，无需手动等待。新增请求代际 (generation) 机制防止竞态：过期请求的结果被静默丢弃，只有最新代际的请求会更新 UI 状态。
- **新会话流式消息保留**: 切换到 live session 时，`getSnapshot` 返回的 canonical 数据不包含尚未完成的 streaming assistant 消息。新增 `preserveStreamingMessages` 逻辑，将 renderer 已通过 `threadSnapshot`/`message_update` 事件收到的 streaming 消息保留下发，避免切换会话后短暂丢失当前输出。
- **DiffViewer 主题色令牌**: 新增 `--color-diff-added-bg`、`--color-diff-added-gutter-bg`、`--color-diff-removed-bg`、`--color-diff-removed-gutter-bg` CSS 自定义属性，支持 light/dark 主题的 diff 颜色。DiffViewer 组件从硬编码的 `color-mix` 迁移到这些令牌。

### Fixed

- **自动压缩后重试保持 running 状态**: 当 `compaction_end` 事件携带 `willRetry: true` 时，保持 session 为 `running` 状态，不再短暂切换到 `idle`。同时刷新 snapshot 确保 compaction summary 消息正确显示。
- **ConfirmDialog 标题栏背景**: 移除 `ConfirmDialogProvider` 标题栏不必要的 `--color-surface-raised` 背景，消除双层叠加导致的视觉突兀。
- **负载命令竞态**: `loadOrphanCommands` 通过代际检查确保只应用最新请求的结果，过期请求的异常不会污染全局错误状态。

### Changed

- **Diff 颜色主题化**: Light 主题采用 GitHub 风格 green/red（`#dafbe1`/`#ffebe9`），Dark 主题采用深色 green/red（`#15321f`/`#3c1618`），替代之前依赖 `color-mix` 的动态计算。
- **`startNewSession` 重置命令状态**: 切换 Project 时总是清空并重新加载 orphan commands，确保命令列表反映当前 Project 的扩展配置。

### Technical

- `@meta-agent/hermes-memory` 集成: 引入 `loadConfig`、`detectProject`、`SkillStore` 以读取 Hermes Memory 配置目录中的技能索引。
- 依赖 `@meta-agent/hermes-memory` 的 `config.js`、`project.js`、`store/skill-store.js` 子路径导出。
