/**
 * 本文件管理 renderer 应用级基础状态。
 */

import { defineStore } from 'pinia'

export const useAppStore = defineStore('app', {
  state: () => ({
    name: 'Meta Agent'
  })
})
