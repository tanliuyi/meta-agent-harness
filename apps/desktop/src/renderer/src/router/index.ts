/**
 * router/index.ts - renderer 路由配置。
 *
 * @description
 * 定义应用路由表，使用 hash 模式，支持基于会话 ID 的动态工作区路由。
 */

import { createRouter, createWebHashHistory } from 'vue-router'

/**
 * Vue Router 应用实例。
 * 使用 hash 模式，默认重定向到 /new，动态会话路由对应 Workspace 视图。
 */
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/new'
    },
    {
      path: '/:sessionid',
      name: 'Workspace',
      component: () => import('../views/workspace/View.vue')
    },
    {
      path: '/settings',
      name: 'Settings',
      component: () => import('../views/settings/View.vue')
    }
  ]
})

/** 导出路由实例，供 main.ts 注册。 */
export default router
