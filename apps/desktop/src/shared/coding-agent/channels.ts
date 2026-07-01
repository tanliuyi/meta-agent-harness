/**
 * 本文件定义 desktop coding agent IPC channel 名称。
 */

export const codingAgentChannels = {
  createThread: 'coding-agent:create-thread',
  stopThread: 'coding-agent:stop-thread',
  restartThread: 'coding-agent:restart-thread',
  listThreads: 'coding-agent:list-threads',
  getThread: 'coding-agent:get-thread',
  getSnapshot: 'coding-agent:get-snapshot',
  prompt: 'coding-agent:prompt',
  steer: 'coding-agent:steer',
  followUp: 'coding-agent:follow-up',
  abort: 'coding-agent:abort',
  newSession: 'coding-agent:new-session',
  switchSession: 'coding-agent:switch-session',
  importSession: 'coding-agent:import-session',
  exportSession: 'coding-agent:export-session',
  fork: 'coding-agent:fork',
  clone: 'coding-agent:clone',
  renameThread: 'coding-agent:rename-thread',
  archiveThread: 'coding-agent:archive-thread',
  listModels: 'coding-agent:list-models',
  setModel: 'coding-agent:set-model',
  cycleModel: 'coding-agent:cycle-model',
  setThinkingLevel: 'coding-agent:set-thinking-level',
  cycleThinkingLevel: 'coding-agent:cycle-thinking-level',
  compact: 'coding-agent:compact',
  setAutoCompaction: 'coding-agent:set-auto-compaction',
  setAutoRetry: 'coding-agent:set-auto-retry',
  abortRetry: 'coding-agent:abort-retry',
  getCommands: 'coding-agent:get-commands',
  runCommand: 'coding-agent:run-command',
  respondUi: 'coding-agent:respond-ui',
  respondApproval: 'coding-agent:respond-approval',
  event: 'coding-agent:event'
} as const
