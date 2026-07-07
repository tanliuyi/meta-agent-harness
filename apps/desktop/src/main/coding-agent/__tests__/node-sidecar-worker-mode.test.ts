/**
 * 本文件测试 node sidecar worker 启动模式判定。
 */

import { describe, expect, it } from 'vitest'
import { shouldRunArgvMode } from '../node-sidecar-worker-mode'

describe('node-sidecar-worker-mode', () => {
  it('无启动参数时作为 Desktop IPC worker 运行', () => {
    expect(shouldRunArgvMode([])).toBe(false)
  })

  it('带 print/json 参数时作为 desktop argv 入口运行', () => {
    expect(shouldRunArgvMode(['--mode', 'json', '-p', 'Task: hello'])).toBe(true)
  })

  it('任意 argv 启动参数都进入 desktop argv 入口', () => {
    expect(shouldRunArgvMode(['--help'])).toBe(true)
  })
})
