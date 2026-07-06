/**
 * 本文件配置 Electron main、preload、renderer 与 coding agent worker 构建入口。
 */

import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

const sharedAlias = resolve('src/shared')
const rendererAlias = resolve('src/renderer/src')

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': sharedAlias
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'coding-agent-utility-worker': resolve(
            '../../packages/coding-agent/src/desktop/worker/worker-main.ts'
          ),
          'coding-agent-node-sidecar-worker': resolve(
            'src/main/coding-agent/node-sidecar-worker-main.ts'
          )
        }
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': sharedAlias
      }
    }
  },
  renderer: {
    publicDir: 'resources',
    resolve: {
      alias: {
        '@': rendererAlias,
        '@shared': sharedAlias,
        '@renderer': rendererAlias
      }
    },
    plugins: [vue()]
  }
})
