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
import './styles/fonts.scss'
import './styles/base.scss'

/**
 * Vue 应用实例。
 * 通过 createApp 创建，并链式注册 Pinia、Router。
 */
const app = createApp(App)

app.use(pinia).use(router).mount('#app')
