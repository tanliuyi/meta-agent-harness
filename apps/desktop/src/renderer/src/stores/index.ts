/**
 * index.ts - 创建 renderer 全局 Pinia 实例。
 *
 * @description
 * 提供全局 Pinia 实例，供 Vue 应用注册以管理跨组件状态。
 */

import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

/**
 * 全局 Pinia 实例。
 * 供 Vue 应用注册使用，管理 renderer 进程中的全局状态。
 */
const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

/** 导出 Pinia 实例，供 main.ts 注册。 */
export default pinia
