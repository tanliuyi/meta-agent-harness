import { describe, expect, it } from 'vitest'
import {
  getToolGroupStatus,
  groupTimelineTools,
  summarizeExploreToolGroup,
  summarizeMutationToolGroup,
  type ToolCall
} from '../support/tool-group'

type TestItem =
  | { type: 'tool'; key: string; toolCall: ToolCall }
  | { type: 'message'; key: string; message: { role: string }; toolCall?: ToolCall }
  | { type: 'thinking'; key: string }

describe('tool-group', () => {
  it('合并连续 mutation tools', () => {
    const items = [
      toolItem('edit-a', 'edit', { path: 'src/a.ts' }),
      toolItem('write-b', 'write', { path: 'src/b.ts' })
    ]

    expect(groupTimelineTools(items)).toMatchObject([
      {
        type: 'tool-group',
        groupKind: 'mutation',
        toolCallIds: ['edit-a', 'write-b'],
        toolCalls: [
          { toolCallId: 'edit-a', toolName: 'edit' },
          { toolCallId: 'write-b', toolName: 'write' }
        ]
      }
    ])
  })

  it('合并连续 explore tools', () => {
    const items = [
      toolItem('read-a', 'read', { path: 'src/a.ts' }),
      toolItem('grep-a', 'grep', { pattern: 'foo', path: 'src' }),
      toolItem('ls-a', 'ls', { path: 'src' })
    ]

    expect(groupTimelineTools(items)).toMatchObject([
      {
        type: 'tool-group',
        groupKind: 'explore',
        toolCallIds: ['read-a', 'grep-a', 'ls-a'],
        toolCalls: [
          { toolCallId: 'read-a', toolName: 'read' },
          { toolCallId: 'grep-a', toolName: 'grep' },
          { toolCallId: 'ls-a', toolName: 'ls' }
        ]
      }
    ])
  })

  it('不同类型工具相邻时分开，单个工具不分组', () => {
    const items = [
      toolItem('read-a', 'read', { path: 'src/a.ts' }),
      toolItem('edit-a', 'edit', { path: 'src/a.ts' }),
      toolItem('write-b', 'write', { path: 'src/b.ts' }),
      toolItem('grep-a', 'grep', { pattern: 'foo' })
    ]

    expect(groupTimelineTools(items).map((item) => item.type)).toEqual([
      'tool',
      'tool-group',
      'tool'
    ])
  })

  it('非工具项和 bash 会打断分组', () => {
    const items: TestItem[] = [
      toolItem('read-a', 'read', { path: 'src/a.ts' }),
      { type: 'thinking', key: 'thinking-a' },
      toolItem('grep-a', 'grep', { pattern: 'foo' }),
      toolItem('bash-a', 'bash', { command: 'cat package.json' }),
      toolItem('find-a', 'find', { pattern: '*.ts' })
    ]

    expect(groupTimelineTools(items).map((item) => item.type)).toEqual([
      'tool',
      'thinking',
      'tool',
      'tool',
      'tool'
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
        groupKind: 'explore',
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

  it('mutation 摘要使用路径去重并将 write 称为写入', () => {
    expect(
      summarizeMutationToolGroup([
        toolCall('edit-a', 'edit', { path: 'src/a.ts' }),
        toolCall('edit-b', 'edit', { path: 'src/a.ts' }),
        toolCall('write-a', 'write', { file_path: 'src/b.ts' })
      ])
    ).toBe('编辑 1 文件，写入 1 文件')
  })

  it('explore 摘要统计查看、搜索和列目录', () => {
    expect(
      summarizeExploreToolGroup([
        toolCall('read-a', 'read', { path: 'src/a.ts' }),
        toolCall('read-b', 'read', { path: 'src/a.ts' }),
        toolCall('grep-a', 'grep', { pattern: 'foo' }),
        toolCall('find-a', 'find', { pattern: '*.ts' }),
        toolCall('ls-a', 'ls', { path: 'src' })
      ])
    ).toBe('查看 1 文件，搜索 2 次，列出 1 目录')
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
