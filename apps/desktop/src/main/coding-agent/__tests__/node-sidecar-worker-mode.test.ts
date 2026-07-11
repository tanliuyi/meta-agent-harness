/**
 * 本文件测试 node sidecar worker 启动模式判定。
 */

import { describe, expect, it } from 'vitest'
import { shouldRunCliCompatibilityMode } from '../node-sidecar-worker-mode'

describe('node-sidecar-worker-mode', () => {
  it('无启动参数时作为 Desktop IPC worker 运行', () => {
    expect(shouldRunCliCompatibilityMode([], '')).toBe(false)
  })

  it('带 Pi print/json 参数时作为 CLI 兼容入口运行', () => {
    expect(shouldRunCliCompatibilityMode(['--mode', 'json', '-p', 'Task: hello'])).toBe(true)
  })

  it('任意 Pi argv 启动参数都进入兼容入口', () => {
    expect(shouldRunCliCompatibilityMode(['--help'])).toBe(true)
  })

  it('Desktop launcher 拉起的无参数 pi 也进入兼容入口', () => {
    expect(shouldRunCliCompatibilityMode([], '1')).toBe(true)
  })

  it('内部 IPC worker 不会被环境中的其他值误判为 CLI', () => {
    expect(shouldRunCliCompatibilityMode([], '0')).toBe(false)
  })
})
