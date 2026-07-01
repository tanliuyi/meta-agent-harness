# meta-agent

meta-agent 是一个 AI Coding Agent GUI 项目，目标是提供一个面向代码任务的桌面端智能体工作台。

项目会使用 Electron 构建前端桌面应用，并通过 pnpm workspace 组织 GUI、Agent Runtime、AI 能力封装等模块。

Agent 的设计与实现会参考 pi agent，重点关注任务规划、工具调用、上下文管理、执行反馈和人机协作体验。

## Workspace

- `apps/*`
- `packages/*`

## Direction

- Electron GUI：提供桌面端交互界面，承载任务会话、执行状态、代码变更预览和用户确认流程。
- Agent Runtime：负责任务理解、规划、工具调度、执行循环和结果汇报。
- AI Layer：封装模型调用、上下文组装、提示词策略和多模型适配能力。
- Workspace Integration：连接本地仓库、终端、文件系统、Git 和开发工具链。

## Commands

```sh
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm lint
```
