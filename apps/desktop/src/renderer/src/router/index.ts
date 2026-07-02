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
      component: () => import('../views/settings/View.vue'),
      redirect: '/settings/models',
      children: [
        {
          path: 'agent',
          name: 'SettingsAgent',
          component: () => import('../views/settings/agent/AgentSettingsView.vue'),
          redirect: '/settings/agent/delivery',
          children: [
            {
              path: 'delivery',
              name: 'SettingsAgentDelivery',
              component: () => import('../views/settings/agent/DeliveryView.vue')
            },
            {
              path: 'runtime',
              name: 'SettingsAgentRuntime',
              component: () => import('../views/settings/agent/RuntimeView.vue')
            },
            {
              path: 'display',
              name: 'SettingsAgentDisplay',
              component: () => import('../views/settings/agent/DisplayView.vue')
            },
            {
              path: 'safety',
              name: 'SettingsAgentSafety',
              component: () => import('../views/settings/agent/SafetyView.vue')
            },
            {
              path: 'media',
              name: 'SettingsAgentMedia',
              component: () => import('../views/settings/agent/MediaView.vue')
            },
            {
              path: 'shell',
              name: 'SettingsAgentShell',
              component: () => import('../views/settings/agent/ShellView.vue')
            },
            {
              path: 'resources',
              name: 'SettingsAgentResources',
              component: () => import('../views/settings/agent/ResourcesView.vue')
            },
            {
              path: 'advanced',
              name: 'SettingsAgentAdvanced',
              component: () => import('../views/settings/agent/AdvancedView.vue')
            },
            {
              path: 'status',
              name: 'SettingsAgentStatus',
              component: () => import('../views/settings/agent/StatusView.vue')
            }
          ]
        },
        {
          path: 'models',
          name: 'SettingsModels',
          component: () => import('../views/settings/models/ModelsView.vue'),
          redirect: '/settings/models/default',
          children: [
            {
              path: 'default',
              name: 'SettingsModelsDefault',
              component: () => import('../views/settings/models/DefaultModelView.vue')
            },
            {
              path: 'thinking',
              name: 'SettingsModelsThinking',
              component: () => import('../views/settings/models/ThinkingView.vue')
            },
            {
              path: 'registry',
              name: 'SettingsModelsRegistry',
              component: () => import('../views/settings/models/RegistryView.vue')
            },
            {
              path: 'tasks',
              name: 'SettingsModelsTasks',
              component: () => import('../views/settings/models/TaskModelsView.vue')
            },
            {
              path: 'api-keys',
              name: 'SettingsModelsApiKeys',
              component: () => import('../views/settings/models/ApiKeysView.vue')
            },
            {
              path: 'providers',
              name: 'SettingsModelsProviders',
              component: () => import('../views/settings/models/CustomProvidersView.vue')
            },
            {
              path: 'diagnostics',
              name: 'SettingsModelsDiagnostics',
              component: () => import('../views/settings/models/DiagnosticsView.vue')
            }
          ]
        }
      ]
    }
  ]
})

/** 导出路由实例，供 main.ts 注册。 */
export default router
