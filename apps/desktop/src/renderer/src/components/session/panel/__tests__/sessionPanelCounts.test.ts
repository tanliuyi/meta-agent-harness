/**
 * 本文件测试 SessionPanel tab count 计算。
 */

import { describe, expect, it } from 'vitest'
import { createStableSessionPanelTabCounts } from '../state/sessionPanelCounts'

describe('createStableSessionPanelTabCounts', () => {
  it('Extensions count 覆盖请求、状态、通知、标题和 working 状态', () => {
    const counts = createStableSessionPanelTabCounts({
      approvals: 0,
      changes: 0,
      commands: undefined,
      extensionStatuses: {
        sync: 'Ready',
        empty: undefined
      },
      extensionNotifications: 1,
      extensionTitle: 'Review helper',
      extensionUiRequests: {
        requestA: {}
      },
      extensionWorking: true,
      tree: 0
    })

    expect(counts.extensions).toBe(5)
  })
})
