/**
 * 定义与 Pi RPC 同构的 canonical agent command。
 */

import type { RpcCommand } from '@earendil-works/pi-coding-agent'

/** 分配式 Omit 辅助类型。 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** 基础 canonical agent 命令类型，省略了 RPC 命令的 id 字段。 */
type BaseCanonicalAgentCommand = DistributiveOmit<RpcCommand, 'id'>

/** Canonical agent 命令联合类型。 */
export type CanonicalAgentCommand =
  | Exclude<BaseCanonicalAgentCommand, { type: 'switch_session' } | { type: 'fork' }>
  | {
      /** 命令类型：重载 settings、resources、extensions、skills、prompts 和 themes。 */
      type: 'reload'
    }
  | {
      /** 命令类型：从 auth.json 和 models.json 刷新当前 runtime 的模型 registry。 */
      type: 'refresh_model_registry'
    }
  | {
      /** 命令类型：切换会话。 */
      type: 'switch_session'
      /** 目标会话路径。 */
      sessionPath: string
      /** 可选的工作目录覆盖。 */
      cwdOverride?: string
    }
  | {
      /** 命令类型：导入会话。 */
      type: 'import_session'
      /** 输入会话路径。 */
      inputPath: string
      /** 可选的工作目录覆盖。 */
      cwdOverride?: string
    }
  | {
      /** 命令类型：分叉。 */
      type: 'fork'
      /** 入口消息 ID。 */
      entryId: string
      /** 分叉位置。 */
      position?: 'before' | 'at'
    }
  | {
      /** 命令类型：创建分叉 session 文件，不替换当前 runtime。 */
      type: 'create_fork_session'
      /** 入口消息 ID。 */
      entryId: string
      /** 分叉位置。 */
      position?: 'before' | 'at'
    }
  | {
      /** 命令类型：在当前 session tree 内导航。 */
      type: 'navigate_tree'
      /** 目标 entry ID。 */
      entryId: string
      /** 是否摘要离开的分支。 */
      summarize?: boolean
      /** 自定义摘要指令。 */
      customInstructions?: string
    }
  | {
      /** 命令类型：加载 session tree 子节点。 */
      type: 'get_session_tree_children'
      /** 父 entry ID；null 表示 roots。 */
      parentId: string | null
      /** 返回深度。 */
      maxDepth?: number
    }
  | {
      /** 命令类型：获取 root 到 entry 的路径。 */
      type: 'get_session_tree_path'
      /** 目标 entry ID；未传则使用当前 leaf。 */
      entryId?: string
    }
  | {
      /** 命令类型：设置 session entry label。 */
      type: 'set_session_entry_label'
      /** 目标 entry ID。 */
      entryId: string
      /** 新 label；空值表示清除。 */
      label?: string
    }

/**
 * 判断给定命令是否为 canonical agent 命令。
 * @param command - 要判断的命令。
 * @returns 是否为 canonical agent 命令。
 */
export function isCanonicalAgentCommand(command: {
  type: string
}): command is CanonicalAgentCommand {
  return canonicalCommandTypes.has(command.type)
}

/** 预定义的 canonical 命令类型集合。 */
const canonicalCommandTypes = new Set<string>([
  'prompt',
  'steer',
  'follow_up',
  'abort',
  'new_session',
  'get_state',
  'set_model',
  'cycle_model',
  'get_available_models',
  'set_thinking_level',
  'cycle_thinking_level',
  'set_steering_mode',
  'set_follow_up_mode',
  'compact',
  'set_auto_compaction',
  'set_auto_retry',
  'abort_retry',
  'reload',
  'refresh_model_registry',
  'bash',
  'abort_bash',
  'get_session_stats',
  'export_html',
  'switch_session',
  'import_session',
  'fork',
  'create_fork_session',
  'navigate_tree',
  'get_session_tree_children',
  'get_session_tree_path',
  'set_session_entry_label',
  'clone',
  'get_fork_messages',
  'get_last_assistant_text',
  'set_session_name',
  'get_messages',
  'get_commands'
])
