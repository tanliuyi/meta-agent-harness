/**
 * app.ts - 应用级基础状态管理。
 */

import { defineStore } from 'pinia'

/**
 * 应用级 Store。
 * 提供应用名称等全局基础状态。
 */
export const useAppStore = defineStore('app', {
  state: () => ({
    /** 应用名称。 */
    name: 'Meta Agent'
  })
})
