/**
 * 本文件定义 desktop coding agent IPC channel 名称。
 */

export const codingAgentChannels = {
  /** 创建 Project。 */
  createProject: 'coding-agent:create-project',
  /** 打开 Project。 */
  openProject: 'coding-agent:open-project',
  /** 获取 Project。 */
  getProject: 'coding-agent:get-project',
  /** 列出 Project。 */
  listProjects: 'coding-agent:list-projects',
  /** 重命名 Project。 */
  renameProject: 'coding-agent:rename-project',
  /** 创建新线程。 */
  createThread: 'coding-agent:create-thread',
  /** 停止线程运行。 */
  stopThread: 'coding-agent:stop-thread',
  /** 重新启动已停止的线程。 */
  restartThread: 'coding-agent:restart-thread',
  /** 列出所有线程。 */
  listThreads: 'coding-agent:list-threads',
  /** 获取单个线程信息。 */
  getThread: 'coding-agent:get-thread',
  /** 获取线程快照。 */
  getSnapshot: 'coding-agent:get-snapshot',
  /** 向线程发送用户提示。 */
  prompt: 'coding-agent:prompt',
  /** 向线程发送引导/转向输入。 */
  steer: 'coding-agent:steer',
  /** 向线程发送跟进输入。 */
  followUp: 'coding-agent:follow-up',
  /** 中止线程当前运行。 */
  abort: 'coding-agent:abort',
  /** 创建新会话。 */
  newSession: 'coding-agent:new-session',
  /** 切换会话。 */
  switchSession: 'coding-agent:switch-session',
  /** 导入会话。 */
  importSession: 'coding-agent:import-session',
  /** 导出会话。 */
  exportSession: 'coding-agent:export-session',
  /** 从指定节点分叉线程。 */
  fork: 'coding-agent:fork',
  /** 克隆线程。 */
  clone: 'coding-agent:clone',
  /** 重命名线程。 */
  renameThread: 'coding-agent:rename-thread',
  /** 归档线程。 */
  archiveThread: 'coding-agent:archive-thread',
  /** 列出可用的模型。 */
  listModels: 'coding-agent:list-models',
  /** 设置当前模型。 */
  setModel: 'coding-agent:set-model',
  /** 循环切换到下一个模型。 */
  cycleModel: 'coding-agent:cycle-model',
  /** 设置思考级别。 */
  setThinkingLevel: 'coding-agent:set-thinking-level',
  /** 循环切换思考级别。 */
  cycleThinkingLevel: 'coding-agent:cycle-thinking-level',
  /** 压缩线程上下文。 */
  compact: 'coding-agent:compact',
  /** 设置自动压缩。 */
  setAutoCompaction: 'coding-agent:set-auto-compaction',
  /** 设置自动重试。 */
  setAutoRetry: 'coding-agent:set-auto-retry',
  /** 中止重试。 */
  abortRetry: 'coding-agent:abort-retry',
  /** 获取可用命令列表。 */
  getCommands: 'coding-agent:get-commands',
  /** 运行指定命令。 */
  runCommand: 'coding-agent:run-command',
  /** 响应 UI 扩展的请求。 */
  respondUi: 'coding-agent:respond-ui',
  /** 响应审批请求。 */
  respondApproval: 'coding-agent:respond-approval',
  /** 获取 debug diagnostics。 */
  listDiagnostics: 'coding-agent:list-diagnostics',
  /** 事件通道。 */
  event: 'coding-agent:event'
} as const
