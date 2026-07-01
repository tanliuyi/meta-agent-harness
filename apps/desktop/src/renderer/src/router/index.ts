/**
 * 本文件定义 renderer 路由。
 */

import { createRouter, createWebHashHistory } from 'vue-router'

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
    }
  ]
})

export default router
