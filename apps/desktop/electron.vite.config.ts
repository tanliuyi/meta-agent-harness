/**
 * 本文件配置 Electron main、preload、renderer 与 coding agent worker 构建入口。
 */

import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

const sharedAlias = resolve('src/shared')
const rendererAlias = resolve('src/renderer/src')
const codingAgentSrcAlias = resolve('../../packages/coding-agent/src')
const codingAgentIndexAlias = resolve(codingAgentSrcAlias, 'index.ts')
const codingAgentDesktopSrcAlias = resolve('../../packages/coding-agent-desktop/src')
const codingAgentDesktopIndexAlias = resolve(codingAgentDesktopSrcAlias, 'index.ts')

const commonAliases = [
  { find: '@coding-agent-src', replacement: codingAgentSrcAlias },
  { find: '@coding-agent-desktop-src', replacement: codingAgentDesktopSrcAlias },
  { find: '@earendil-works/pi-coding-agent', replacement: codingAgentIndexAlias },
  {
    find: /^@earendil-works\/pi-coding-agent-desktop\/(.*)$/,
    replacement: `${codingAgentDesktopSrcAlias}/$1`
  },
  {
    find: '@earendil-works/pi-coding-agent-desktop',
    replacement: codingAgentDesktopIndexAlias
  },
  { find: '@shared', replacement: sharedAlias }
]

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@meta-agent/hermes-memory'] })],
    resolve: {
      alias: commonAliases
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'coding-agent-utility-worker': resolve('src/main/coding-agent/utility-worker-main.ts'),
          'coding-agent-node-sidecar-worker': resolve(
            'src/main/coding-agent/node-sidecar-worker-main.ts'
          )
        }
      }
    }
  },
  preload: {
    resolve: {
      alias: commonAliases
    }
  },
  renderer: {
    publicDir: 'resources',
    resolve: {
      alias: [
        { find: /^@\/(.*)$/, replacement: `${rendererAlias}/$1` },
        ...commonAliases,
        { find: '@renderer', replacement: rendererAlias }
      ]
    },
    plugins: [
      vue({
        template: {
          compilerOptions: {
            isCustomElement: (tag) => tag === 'webview'
          }
        }
      })
    ]
  }
})
