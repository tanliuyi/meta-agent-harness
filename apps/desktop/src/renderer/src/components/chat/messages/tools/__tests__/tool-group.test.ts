import { describe, expect, it } from 'vitest'
import {
  getToolGroupStatus,
  groupTimelineTools,
  summarizeToolGroup,
  summarizeToolGroupParts,
  type ToolCall
} from '../support/tool-group'

type TestItem =
  | { type: 'tool'; key: string; toolCall: ToolCall }
  | { type: 'message'; key: string; message: { role: string }; toolCall?: ToolCall }
  | { type: 'thinking'; key: string }

describe('tool-group', () => {
  it('合并连续工具', () => {
    const items = [
      toolItem('read-a', 'read', { path: 'src/a.ts' }),
      toolItem('bash-a', 'bash', { command: 'pnpm test' }),
      toolItem('edit-a', 'edit', { path: 'src/a.ts' }),
      toolItem('write-b', 'write', { path: 'src/b.ts' })
    ]

    expect(groupTimelineTools(items)).toMatchObject([
      {
        type: 'tool-group',
        toolCallIds: ['read-a', 'bash-a', 'edit-a', 'write-b'],
        toolCalls: [
          { toolCallId: 'read-a', toolName: 'read' },
          { toolCallId: 'bash-a', toolName: 'bash' },
          { toolCallId: 'edit-a', toolName: 'edit' },
          { toolCallId: 'write-b', toolName: 'write' }
        ]
      }
    ])
  })

  it('非工具项会打断分组，单个工具不分组', () => {
    const items: TestItem[] = [
      toolItem('read-a', 'read', { path: 'src/a.ts' }),
      { type: 'thinking', key: 'thinking-a' },
      toolItem('grep-a', 'grep', { pattern: 'foo' }),
      toolItem('find-a', 'find', { pattern: '*.ts' })
    ]

    expect(groupTimelineTools(items).map((item) => item.type)).toEqual([
      'tool',
      'thinking',
      'tool-group'
    ])
  })

  it('tool result message 可参与连续分组', () => {
    const items: TestItem[] = [
      messageToolItem('message-read-a', 'read', { path: 'src/a.ts' }),
      toolItem('grep-a', 'grep', { pattern: 'foo' })
    ]

    expect(groupTimelineTools(items)).toMatchObject([
      {
        type: 'tool-group',
        toolCallIds: ['message-read-a', 'grep-a']
      }
    ])
  })

  it('group key 只依赖首个子工具，追加子工具时不重置组件状态', () => {
    const initialGroup = groupTimelineTools([
      toolItem('edit-a', 'edit', { path: 'src/a.ts' }),
      toolItem('write-b', 'write', { path: 'src/b.ts' })
    ])[0]
    const appendedGroup = groupTimelineTools([
      toolItem('edit-a', 'edit', { path: 'src/a.ts' }),
      toolItem('write-b', 'write', { path: 'src/b.ts' }),
      toolItem('edit-c', 'edit', { path: 'src/c.ts' })
    ])[0]

    expect(initialGroup).toMatchObject({ type: 'tool-group' })
    expect(appendedGroup).toMatchObject({ type: 'tool-group' })
    expect(appendedGroup.key).toBe(initialGroup.key)
  })

  it('摘要按已知工具语义统计，并用执行统计扩展工具', () => {
    expect(
      summarizeToolGroup([
        toolCall('read-a', 'read', { path: 'src/a.ts' }),
        toolCall('read-b', 'read', { path: 'src/a.ts' }),
        toolCall('grep-a', 'grep', { pattern: 'foo' }),
        toolCall('find-a', 'find', { pattern: '*.ts' }),
        toolCall('ls-a', 'ls', { path: 'src' }),
        toolCall('edit-a', 'edit', { path: 'src/a.ts' }),
        toolCall('edit-b', 'edit', { path: 'src/a.ts' }),
        toolCall('write-a', 'write', { file_path: 'src/b.ts' }),
        toolCall('bash-a', 'bash', { command: 'pnpm test' }),
        toolCall('extension-a', 'extensionTool', {})
      ])
    ).toBe(
      '已读取 1 文件，已搜索 2 次，已列出 1 目录，已编辑 1 文件，已写入 1 文件，已运行 1 命令，已执行 1 工具'
    )
  })

  it('摘要按工具状态展示', () => {
    expect(
      summarizeToolGroup([
        toolCall('bash-a', 'bash', {}, 'queued'),
        toolCall('bash-b', 'bash', {}, 'running'),
        toolCall('bash-c', 'bash', {}, 'succeeded'),
        toolCall('bash-d', 'bash', {}, 'failed')
      ])
    ).toBe('正在运行 1 命令，正在1 命令运行，已运行 1 命令，1 命令失败')
  })

  it('摘要片段保留失败状态用于局部错误样式', () => {
    expect(
      summarizeToolGroupParts([
        toolCall('read-a', 'read', { path: 'src/a.ts' }, 'succeeded'),
        toolCall('bash-a', 'bash', {}, 'failed')
      ])
    ).toEqual([
      {
        key: '读取:succeeded',
        status: 'succeeded',
        text: '已读取 1 文件'
      },
      {
        key: '运行:failed',
        status: 'failed',
        text: '1 命令失败'
      }
    ])
  })

  it('聚合工具组状态', () => {
    expect(getToolGroupStatus([toolCall('a', 'read'), toolCall('b', 'grep', {}, 'failed')])).toBe(
      'failed'
    )
    expect(getToolGroupStatus([toolCall('a', 'read'), toolCall('b', 'grep', {}, 'running')])).toBe(
      'running'
    )
    expect(
      getToolGroupStatus([
        toolCall('a', 'read', {}, 'succeeded'),
        toolCall('b', 'grep', {}, 'succeeded')
      ])
    ).toBe('succeeded')
  })

  it('运行中的工具更新会让 group 保持 running 状态', () => {
    expect(
      getToolGroupStatus([
        toolCall('a', 'read', {}, 'succeeded'),
        toolCall('b', 'grep', {}, 'running')
      ])
    ).toBe('running')
  })
})

function toolItem(id: string, toolName: string, args?: unknown): TestItem {
  return { type: 'tool', key: id, toolCall: toolCall(id, toolName, args) }
}

function messageToolItem(id: string, toolName: string, args?: unknown): TestItem {
  return {
    type: 'message',
    key: id,
    message: { role: 'tool' },
    toolCall: toolCall(id, toolName, args)
  }
}

function toolCall(
  id: string,
  toolName: string,
  args: unknown = {},
  status: ToolCall['status'] = 'succeeded'
): ToolCall {
  return {
    threadId: 'thread-a',
    toolCallId: id,
    toolName,
    status,
    args
  }
}
