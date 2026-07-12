import { describe, expect, it } from 'vitest'
import browserPreviewExtension from '../browser-preview-extension'

type RegisteredTool = {
  name: string
  parameters: { properties?: Record<string, unknown> }
}

describe('browser preview extension tools', () => {
  it('registers browser tab lifecycle tools and routes every page tool by browserId', () => {
    const tools = new Map<string, RegisteredTool>()
    const pi = {
      on: () => undefined,
      registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool)
    } as unknown as Parameters<typeof browserPreviewExtension>[0]

    browserPreviewExtension(pi)

    expect([...tools.keys()]).toEqual(
      expect.arrayContaining(['browser_open', 'browser_tabs', 'browser_switch', 'browser_close'])
    )
    for (const name of [
      'browser_navigate',
      'browser_snapshot',
      'browser_inspect',
      'browser_action',
      'browser_execute_js',
      'browser_set_viewport',
      'browser_logs',
      'browser_screenshot'
    ]) {
      expect(tools.get(name)?.parameters.properties).toHaveProperty('browserId')
    }
  })
})
