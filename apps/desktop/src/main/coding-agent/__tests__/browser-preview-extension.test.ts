import { describe, expect, it } from 'vitest'
import browserPreviewExtension, {
  createBrowserScreenshotResult,
  createBrowserTextResult
} from '../browser-preview-extension'

type RegisteredTool = {
  name: string
  parameters: { properties?: Record<string, unknown> }
}

describe('browser preview extension tools', () => {
  it('consolidates Browser capabilities into tab and page domain tools', () => {
    const tools = new Map<string, RegisteredTool>()
    const pi = {
      on: () => undefined,
      registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool)
    } as unknown as Parameters<typeof browserPreviewExtension>[0]

    browserPreviewExtension(pi)

    expect([...tools.keys()]).toEqual(['browser_tabs', 'browser_page'])
    expect(tools.get('browser_tabs')?.parameters.properties).toHaveProperty('action')
    expect(tools.get('browser_tabs')?.parameters.properties).toHaveProperty('browserId')
    expect(tools.get('browser_page')?.parameters.properties).toHaveProperty('action')
    expect(tools.get('browser_page')?.parameters.properties).toHaveProperty('browserId')
    expect(tools.get('browser_page')?.parameters.properties).toHaveProperty('method')
    expect(tools.get('browser_page')?.parameters.properties).toHaveProperty('offset')
    expect(tools.get('browser_page')?.parameters.properties).toHaveProperty('includeHidden')
  })

  it('bounds text and screenshot results before duplicating them into tool content', () => {
    expect(createBrowserTextResult({ value: 'ready' })).toMatchObject({
      content: [{ type: 'text' }],
      details: { value: 'ready' }
    })
    expect(() => createBrowserTextResult({ value: 'x'.repeat(600 * 1024) })).toThrow(
      'result exceeds the byte budget'
    )

    expect(() =>
      createBrowserScreenshotResult({
        browserId: 'browser-1',
        dataUrl: `data:image/png;base64,${'a'.repeat(29 * 1024 * 1024)}`,
        url: 'https://example.com/',
        title: 'Example'
      })
    ).toThrow('invalid screenshot')
  })
})
