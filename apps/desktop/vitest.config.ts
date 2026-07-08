import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

const codingAgentSrcAlias = resolve(__dirname, '../../packages/coding-agent/src')
const codingAgentDesktopSrcAlias = resolve(__dirname, '../../packages/coding-agent-desktop/src')
const rendererAlias = resolve(__dirname, 'src/renderer/src')

export default defineConfig({
  resolve: {
    alias: [
      { find: '@coding-agent-src', replacement: codingAgentSrcAlias },
      { find: '@coding-agent-desktop-src', replacement: codingAgentDesktopSrcAlias },
      {
        find: /^@earendil-works\/pi-coding-agent-desktop\/(.*)$/,
        replacement: `${codingAgentDesktopSrcAlias}/$1`
      },
      {
        find: '@earendil-works/pi-coding-agent-desktop',
        replacement: resolve(codingAgentDesktopSrcAlias, 'index.ts')
      },
      {
        find: '@earendil-works/pi-coding-agent',
        replacement: resolve(codingAgentSrcAlias, 'index.ts')
      },
      { find: '@renderer', replacement: rendererAlias },
      { find: /^@\/(.*)$/, replacement: `${rendererAlias}/$1` },
      { find: '@shared', replacement: resolve(__dirname, 'src/shared') }
    ]
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts']
  }
})
