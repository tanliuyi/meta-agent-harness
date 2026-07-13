/**
 * 本文件测试 desktop command invocation 与 Pi slash command 参数语义一致。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { clipboard } from 'electron'
import { followUp, prompt, runCommand, steer, toSlashCommand } from '../thread-agent-commands'
import { exportSession } from '../thread-session-commands'
import type { ThreadManagerCore } from '../thread-manager-core'
import type { WorkerCommand } from '../worker-types'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()) },
  clipboard: {
    writeText: vi.fn()
  }
}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('thread-agent-commands', () => {
  it('将 command 与 args 还原为 Pi slash command 文本', () => {
    expect(toSlashCommand('/deploy', 'prod --force')).toBe('/deploy prod --force')
    expect(toSlashCommand('deploy', '  prod')).toBe('/deploy   prod')
    expect(toSlashCommand('deploy')).toBe('/deploy')
  })

  it('runCommand 通过 prompt 将 args 传给 Pi extension command handler', async () => {
    const commands: WorkerCommand[] = []
    const core = {
      requireThread: vi.fn(() => ({ threadId: 'thread-a' })),
      updateThread: vi.fn(),
      sendOk: vi.fn(async (_threadId: string, command: WorkerCommand) => {
        commands.push(command)
      })
    } as unknown as ThreadManagerCore

    await runCommand(core, {
      threadId: 'thread-a',
      command: '/deploy',
      args: 'prod --force'
    })

    expect(core.requireThread).toHaveBeenCalledWith('thread-a')
    expect(core.updateThread).toHaveBeenCalledWith('thread-a', { status: 'running' })
    expect(commands).toEqual([
      {
        type: 'prompt',
        message: '/deploy prod --force',
        images: undefined,
        streamingBehavior: undefined
      }
    ])
  })

  it('runCommand 不再支持 skill 命令链路', async () => {
    const core = {
      requireThread: vi.fn(),
      updateThread: vi.fn(),
      sendOk: vi.fn()
    } as unknown as ThreadManagerCore

    await expect(
      runCommand(core, {
        threadId: 'thread-a',
        command: 'skill:test',
        args: 'with args'
      })
    ).rejects.toThrow(
      'Skill commands must be inserted into the prompt with $ instead of run-command'
    )

    expect(core.sendOk).not.toHaveBeenCalled()
    expect(core.updateThread).not.toHaveBeenCalled()
  })

  it('prompt 跳过超过限制的文件引用，不把大文件内容送入 worker', async () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-prompt-file-'))
    const largeFile = join(root, 'large.txt')
    writeFileSync(largeFile, 'a'.repeat(512 * 1024 + 1))
    const commands: WorkerCommand[] = []
    const core = {
      requireThread: vi.fn(() => ({ threadId: 'thread-a' })),
      getThreadCwd: vi.fn(() => root),
      getAgentSettingsService: vi.fn(async () => ({
        getImageAutoResize: vi.fn(() => true)
      })),
      updateThread: vi.fn(),
      sendOk: vi.fn(async (_threadId: string, command: WorkerCommand) => {
        commands.push(command)
      })
    } as unknown as ThreadManagerCore

    try {
      await prompt(core, {
        threadId: 'thread-a',
        message: '请看看这个文件',
        fileArgs: [largeFile]
      })

      expect(commands).toHaveLength(1)
      const command = commands[0]
      if (!command || command.type !== 'prompt') {
        throw new Error('Expected prompt command')
      }
      expect(command).toMatchObject({
        type: 'prompt',
        images: undefined,
        streamingBehavior: undefined
      })
      expect(command.message).toContain('[Skipped: 文件超过 512 KB 限制.]')
      expect(command.message).toContain('请看看这个文件')
      expect(command.message).not.toContain('a'.repeat(1024))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('prompt 在最终 worker 边界拒绝累计超过数量限制的 inline 图片', async () => {
    const core = {
      requireThread: vi.fn(() => ({ threadId: 'thread-a' })),
      updateThread: vi.fn(),
      sendOk: vi.fn()
    } as unknown as ThreadManagerCore
    const image = { type: 'image' as const, mimeType: 'image/png', data: 'YQ==' }

    await expect(
      prompt(core, {
        threadId: 'thread-a',
        message: 'images',
        images: Array.from({ length: 11 }, () => image)
      })
    ).rejects.toThrow('最多添加 10 张图片')
    expect(core.sendOk).not.toHaveBeenCalled()
  })

  it('prompt、steer 与 followUp 在读取路径图片前统一拒绝源文件总预算溢出', async () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-prompt-image-budget-'))
    const pngHeader = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
    const imagePaths = Array.from({ length: 3 }, (_, index) => {
      const filePath = join(root, `large-${index}.png`)
      writeFileSync(filePath, pngHeader)
      truncateSync(filePath, 18 * 1024 * 1024)
      return filePath
    })

    try {
      for (const send of [prompt, steer, followUp]) {
        const core = {
          requireThread: vi.fn(() => ({ threadId: 'thread-a' })),
          getThreadCwd: vi.fn(() => root),
          getAgentSettingsService: vi.fn(async () => ({
            getImageAutoResize: vi.fn(() => true)
          })),
          updateThread: vi.fn(),
          sendOk: vi.fn()
        } as unknown as ThreadManagerCore

        await expect(
          send(core, {
            threadId: 'thread-a',
            message: 'images',
            imageFiles: imagePaths.map((path) => ({ path }))
          })
        ).rejects.toThrow('图片总大小超过限制')
        expect(core.sendOk).not.toHaveBeenCalled()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('Desktop export API 在受控模式使用默认路径，完整模式允许指定路径', async () => {
    const commands: WorkerCommand[] = []
    const core = {
      sendData: vi.fn(async (_threadId: string, command: WorkerCommand) => {
        commands.push(command)
        return { path: '/tmp/session.html' }
      })
    } as unknown as ThreadManagerCore

    await expect(exportSession(core, { threadId: 'thread-a' })).resolves.toEqual({
      path: '/tmp/session.html'
    })
    expect(commands).toEqual([{ type: 'export_html' }])

    await expect(
      exportSession(core, { threadId: 'thread-a', outputPath: 'C:\\exports\\session.html' })
    ).rejects.toThrow('完整文件系统能力')
    vi.stubEnv('CODING_AGENT_FILESYSTEM_ACCESS', 'full')
    await exportSession(core, {
      threadId: 'thread-a',
      outputPath: 'C:\\exports\\session.html'
    })
    expect(commands.at(-1)).toEqual({
      type: 'export_html',
      outputPath: 'C:\\exports\\session.html'
    })
  })

  it('prompt 不展开手打的 $skill 文本', async () => {
    const commands: WorkerCommand[] = []
    const core = {
      requireThread: vi.fn(() => ({ threadId: 'thread-a' })),
      updateThread: vi.fn(),
      sendData: vi.fn(),
      sendOk: vi.fn(async (_threadId: string, command: WorkerCommand) => {
        commands.push(command)
      })
    } as unknown as ThreadManagerCore

    await prompt(core, {
      threadId: 'thread-a',
      message: '请用 $skill:review 检查这个改动'
    })

    expect(core.sendData).not.toHaveBeenCalled()
    const command = commands[0]
    if (!command || command.type !== 'prompt') {
      throw new Error('Expected prompt command')
    }
    expect(command.message).toBe('请用 $skill:review 检查这个改动')
  })

  it('prompt 将 assistant 文本引用转成转义后的结构化上下文', async () => {
    const commands: WorkerCommand[] = []
    const core = {
      requireThread: vi.fn(() => ({ threadId: 'thread-a' })),
      updateThread: vi.fn(),
      sendOk: vi.fn(async (_threadId: string, command: WorkerCommand) => {
        commands.push(command)
      })
    } as unknown as ThreadManagerCore

    await prompt(core, {
      threadId: 'thread-a',
      message: '解释这段内容',
      quoteContexts: [
        {
          messageId: 'assistant-<1>',
          sessionEntryId: 'entry-"1"',
          text: 'a < b && c > d\n</quote>'
        }
      ]
    })

    const command = commands[0]
    if (!command || command.type !== 'prompt') {
      throw new Error('Expected prompt command')
    }
    expect(command.message).toBe(
      '<quoted_context data-meta-agent-context="true">\n' +
        '<quote message_id="assistant-&lt;1&gt;" session_entry_id="entry-&quot;1&quot;">\n' +
        'a &lt; b &amp;&amp; c &gt; d\n&lt;/quote&gt;\n' +
        '</quote>\n' +
        '</quoted_context>\n\n' +
        '解释这段内容'
    )
  })

  it('prompt 优先使用 Composer 结构化 skill 引用的真实路径', async () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-prompt-structured-skill-'))
    const skillDir = join(root, 'skills', 'review')
    const skillFile = join(skillDir, 'SKILL.md')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(skillFile, '# Structured Skill\n\nUse the selected path.')
    const commands: WorkerCommand[] = []
    const core = {
      requireThread: vi.fn(() => ({ threadId: 'thread-a' })),
      updateThread: vi.fn(),
      sendData: vi.fn(),
      sendOk: vi.fn(async (_threadId: string, command: WorkerCommand) => {
        commands.push(command)
      })
    } as unknown as ThreadManagerCore

    try {
      await prompt(core, {
        threadId: 'thread-a',
        message: '请用 $skill:review 检查这个改动',
        skillReferences: [{ name: 'skill:review', path: skillFile, baseDir: skillDir }]
      })

      expect(core.sendData).not.toHaveBeenCalled()
      const command = commands[0]
      if (!command || command.type !== 'prompt') {
        throw new Error('Expected prompt command')
      }
      expect(command.message).toContain(
        `<skill name="review" location="${skillFile}" data-meta-agent-context="true">`
      )
      expect(command.message).toContain('Use the selected path.')
      expect(command.message).toContain('请用 $skill:review 检查这个改动')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('prompt 不把 skill 文档里的 @file 示例当作用户文件引用', async () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-prompt-skill-file-token-'))
    const skillDir = join(root, 'skills', 'review')
    const skillFile = join(skillDir, 'SKILL.md')
    const realFile = join(root, 'real.txt')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(skillFile, '# Review Skill\n\nExample: read @missing.txt only if user asks.')
    writeFileSync(realFile, 'real file content')
    const commands: WorkerCommand[] = []
    const core = {
      requireThread: vi.fn(() => ({ threadId: 'thread-a' })),
      getThreadCwd: vi.fn(() => root),
      getAgentSettingsService: vi.fn(async () => ({
        getImageAutoResize: vi.fn(() => true)
      })),
      updateThread: vi.fn(),
      sendData: vi.fn(),
      sendOk: vi.fn(async (_threadId: string, command: WorkerCommand) => {
        commands.push(command)
      })
    } as unknown as ThreadManagerCore

    try {
      await prompt(core, {
        threadId: 'thread-a',
        message: '请用 $skill:review 检查 @real.txt',
        skillReferences: [{ name: 'skill:review', path: skillFile, baseDir: skillDir }]
      })

      const command = commands[0]
      if (!command || command.type !== 'prompt') {
        throw new Error('Expected prompt command')
      }
      expect(command.message).toContain('real file content')
      expect(command.message).toContain('Example: read @missing.txt only if user asks.')
      expect(command.message).not.toContain('missing.txt">[Skipped:')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('prompt 组合上下文时保持 file、quote、skill 与正文的兼容顺序和换行', async () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-prompt-context-order-'))
    const textFile = join(root, 'source.txt')
    const skillDir = join(root, 'skills', 'review')
    const skillFile = join(skillDir, 'SKILL.md')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(textFile, 'file body')
    writeFileSync(skillFile, '---\nname: review\n---\n# Review')
    const commands: WorkerCommand[] = []
    const core = {
      requireThread: vi.fn(() => ({ threadId: 'thread-a' })),
      getThreadCwd: vi.fn(() => root),
      getAgentSettingsService: vi.fn(async () => ({ getImageAutoResize: vi.fn(() => true) })),
      updateThread: vi.fn(),
      sendOk: vi.fn(async (_threadId: string, command: WorkerCommand) => commands.push(command))
    } as unknown as ThreadManagerCore

    try {
      await prompt(core, {
        threadId: 'thread-a',
        message: '检查 @source.txt',
        fileArgs: [textFile],
        quoteContexts: [{ messageId: 'assistant-a', text: 'quoted' }],
        skillReferences: [{ name: 'skill:review', path: skillFile, baseDir: skillDir }]
      })

      const command = commands[0]
      if (!command || command.type !== 'prompt') throw new Error('Expected prompt command')
      expect(command.message).toBe(
        `<file name="${textFile}" data-meta-agent-context="true">\nfile body\n</file>\n` +
          '<quoted_context data-meta-agent-context="true">\n' +
          '<quote message_id="assistant-a">\nquoted\n</quote>\n' +
          '</quoted_context>\n\n' +
          `<skill name="review" location="${skillFile}" data-meta-agent-context="true">\n` +
          `References are relative to ${skillDir}.\n\n` +
          '# Review\n' +
          '</skill>\n\n' +
          '检查 @source.txt'
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('runCommand 对内建 reload 走 runtime control，不写入 user prompt', async () => {
    const commands: WorkerCommand[] = []
    const core = {
      sendOk: vi.fn(async (_threadId: string, command: WorkerCommand) => {
        commands.push(command)
      })
    } as unknown as ThreadManagerCore

    const result = await runCommand(core, {
      threadId: 'thread-a',
      command: '/reload'
    })

    expect(core.sendOk).toHaveBeenCalledWith('thread-a', { type: 'reload' })
    expect(commands).toEqual([{ type: 'reload' }])
    expect(result).toEqual({ message: '已重载扩展与资源', refreshSnapshot: true })
  })

  it('runCommand 对 name/session/copy/export 映射到 Pi canonical commands', async () => {
    const commands: WorkerCommand[] = []
    const core = {
      updateThread: vi.fn(),
      sendOk: vi.fn(async (_threadId: string, command: WorkerCommand) => {
        commands.push(command)
      }),
      sendData: vi.fn(async (_threadId: string, command: WorkerCommand) => {
        commands.push(command)
        if (command.type === 'get_session_stats') {
          return {
            userMessages: 2,
            assistantMessages: 3,
            toolCalls: 4,
            tokens: { total: 99 }
          }
        }
        if (command.type === 'get_last_assistant_text') {
          return { text: 'last answer' }
        }
        if (command.type === 'export_html') {
          return { path: '/tmp/session.html' }
        }
        return undefined
      })
    } as unknown as ThreadManagerCore

    const nameResult = await runCommand(core, {
      threadId: 'thread-a',
      command: 'name',
      args: 'Demo'
    })
    const sessionResult = await runCommand(core, { threadId: 'thread-a', command: 'session' })
    const copyResult = await runCommand(core, { threadId: 'thread-a', command: 'copy' })
    const exportResult = await runCommand(core, { threadId: 'thread-a', command: 'export' })

    expect(commands).toEqual([
      { type: 'set_session_name', name: 'Demo' },
      { type: 'get_session_stats' },
      { type: 'get_last_assistant_text' },
      { type: 'export_html' }
    ])
    expect(core.updateThread).toHaveBeenCalledWith('thread-a', { title: 'Demo' })
    expect(nameResult).toEqual({ message: '已重命名为 Demo', refreshSnapshot: true })
    expect(sessionResult?.message).toBe('会话统计：用户 2，助手 3，工具 4，tokens 99')
    expect(copyResult?.message).toBe('已复制最后一条助手消息')
    expect(exportResult?.message).toBe('已导出到 /tmp/session.html')
  })

  it('Desktop /export 受控模式拒绝、完整模式恢复指定输出路径', async () => {
    const core = { sendData: vi.fn() } as unknown as ThreadManagerCore

    await expect(
      runCommand(core, {
        threadId: 'thread-a',
        command: 'export',
        args: 'C:\\sensitive.json'
      })
    ).rejects.toThrow('不接受输出路径')
    expect(core.sendData).not.toHaveBeenCalled()

    vi.stubEnv('CODING_AGENT_FILESYSTEM_ACCESS', 'full')
    const sendData = vi.fn(async <T>(): Promise<T> => ({ path: 'C:\\sensitive.json' }) as T)
    const fullAccessCore = { sendData } as unknown as ThreadManagerCore
    await expect(
      runCommand(fullAccessCore, {
        threadId: 'thread-a',
        command: 'export',
        args: 'C:\\sensitive.json'
      })
    ).resolves.toMatchObject({ message: '已导出到 C:\\sensitive.json' })
    expect(sendData).toHaveBeenCalledWith('thread-a', {
      type: 'export_html',
      outputPath: 'C:\\sensitive.json'
    })
  })

  it('runCommand 对带参数的 fork/tree/resume/model 映射到 Pi canonical commands', async () => {
    const commands: WorkerCommand[] = []
    const core = {
      updateThread: vi.fn(),
      getSnapshot: vi.fn().mockResolvedValue({
        sessionFile: '/tmp/session.jsonl',
        title: 'Updated'
      }),
      sendOk: vi.fn(async (_threadId: string, command: WorkerCommand) => {
        commands.push(command)
      })
    } as unknown as ThreadManagerCore

    await runCommand(core, { threadId: 'thread-a', command: 'fork', args: 'entry-1' })
    await runCommand(core, { threadId: 'thread-a', command: 'tree', args: 'entry-2' })
    await runCommand(core, { threadId: 'thread-a', command: 'resume', args: '/tmp/session.jsonl' })
    const modelResult = await runCommand(core, {
      threadId: 'thread-a',
      command: 'model',
      args: 'openai/gpt-5'
    })

    expect(commands).toEqual([
      { type: 'fork', entryId: 'entry-1' },
      { type: 'navigate_tree', entryId: 'entry-2' },
      { type: 'switch_session', sessionPath: '/tmp/session.jsonl' },
      { type: 'set_model', provider: 'openai', modelId: 'gpt-5' }
    ])
    expect(core.getSnapshot).toHaveBeenCalledTimes(3)
    expect(core.updateThread).toHaveBeenCalledWith('thread-a', {
      sessionFile: '/tmp/session.jsonl',
      title: 'Updated'
    })
    expect(modelResult).toEqual({
      message: '已切换模型到 openai/gpt-5',
      refreshSnapshot: true
    })
  })

  it('runCommand 对 share 创建 secret gist 并返回 Pi viewer URL，不写入 prompt', async () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-share-'))
    const sessionFile = join(root, 'session.jsonl')
    writeFileSync(sessionFile, `${JSON.stringify({ type: 'session_start', cwd: root })}\n`)
    vi.stubEnv('GITHUB_TOKEN', 'token-a')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'gist-123' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const core = {
      getSnapshot: vi.fn().mockResolvedValue({ sessionFile }),
      sendOk: vi.fn()
    } as unknown as ThreadManagerCore

    try {
      const result = await runCommand(core, { threadId: 'thread-a', command: 'share' })

      expect(core.sendOk).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/gists',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            authorization: 'Bearer token-a'
          })
        })
      )
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
        public: false,
        files: {
          'session.jsonl': {
            content: `${JSON.stringify({ type: 'session_start', cwd: root })}\n`
          }
        }
      })
      expect(result?.message).toBe('已创建分享链接：https://pi.dev/session/#gist-123')
      expect(result?.details).toEqual({
        title: 'Share',
        body: 'https://pi.dev/session/#gist-123'
      })
      expect(clipboard.writeText).toHaveBeenCalledWith('https://pi.dev/session/#gist-123')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('runCommand 对需要 Desktop UI 的内建命令返回明确错误，不写入 prompt', async () => {
    const core = {
      sendOk: vi.fn()
    } as unknown as ThreadManagerCore

    await expect(
      runCommand(core, {
        threadId: 'thread-a',
        command: 'settings'
      })
    ).rejects.toThrow('/settings 需要通过 Desktop 对应 UI 入口执行')

    expect(core.sendOk).not.toHaveBeenCalled()
  })
})
