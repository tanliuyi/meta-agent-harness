import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const aiSrcIndex = fileURLToPath(new URL('../ai/src/index.ts', import.meta.url))
const aiSrcCompat = fileURLToPath(new URL('../ai/src/compat.ts', import.meta.url))
const aiSrcOAuth = fileURLToPath(new URL('../ai/src/oauth.ts', import.meta.url))
const agentSrcIndex = fileURLToPath(new URL('../agent/src/index.ts', import.meta.url))
const codingAgentSrcIndex = fileURLToPath(new URL('../coding-agent/src/index.ts', import.meta.url))

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    server: {
      deps: {
        external: [/@silvia-odwyer\/photon-node/]
      }
    }
  },
  resolve: {
    alias: [
      { find: /^@earendil-works\/pi-ai$/, replacement: aiSrcIndex },
      { find: /^@earendil-works\/pi-ai\/compat$/, replacement: aiSrcCompat },
      { find: /^@earendil-works\/pi-ai\/oauth$/, replacement: aiSrcOAuth },
      { find: /^@earendil-works\/pi-agent-core$/, replacement: agentSrcIndex },
      { find: /^@earendil-works\/pi-coding-agent$/, replacement: codingAgentSrcIndex }
    ]
  }
})
