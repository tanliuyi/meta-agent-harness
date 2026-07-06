import { describe, expect, it } from 'vitest'
import type { CommandInfo } from '@shared/coding-agent/types'
import { filterCommands, getCommandQueryArgs, getCommandQueryName } from '../commandDisplay'

describe('commandDisplay', () => {
  const commands: CommandInfo[] = [
    createCommand('deploy', 'Deploy project', 'extension'),
    createCommand('skill:test', 'Run test skill', 'skill')
  ]

  it('过滤命令时忽略命令参数', () => {
    expect(filterCommands(commands, '/deploy prod --force').map((command) => command.name)).toEqual(
      ['deploy']
    )
  })

  it('从命令输入中提取 Pi extension command 参数', () => {
    expect(getCommandQueryName('/deploy prod --force')).toBe('deploy')
    expect(getCommandQueryArgs('/deploy prod --force', 'deploy')).toBe('prod --force')
    expect(getCommandQueryArgs('deploy   prod', 'deploy')).toBe('  prod')
    expect(getCommandQueryArgs('/deploy', 'deploy')).toBeUndefined()
    expect(getCommandQueryArgs('other prod', 'deploy')).toBeUndefined()
  })
})

function createCommand(
  name: string,
  description: string,
  source: CommandInfo['source']
): CommandInfo {
  return {
    name,
    description,
    source,
    sourceInfo: {
      path: `/tmp/${name}`,
      source: name,
      scope: 'temporary',
      origin: 'top-level'
    }
  }
}
