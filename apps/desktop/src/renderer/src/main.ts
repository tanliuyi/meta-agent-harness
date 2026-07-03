/**
 * main.ts - 创建并挂载 Vue renderer 应用。
 *
 * @description
 * 依次注册 Pinia 状态管理、Vue Router 路由，并挂载到 #app 节点。
 */

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import pinia from './stores'
import { useAppStore } from './stores/app'
import './styles/fonts.scss'
import './styles/shadcn.css'
import './styles/base.scss'

/**
 * 初始化并挂载 Vue 应用实例。
 */
async function bootstrap(): Promise<void> {
  const app = createApp(App)

  app.use(pinia).use(router)

  await useAppStore(pinia).initializeRuntime()

  app.mount('#app')
}

void bootstrap()
