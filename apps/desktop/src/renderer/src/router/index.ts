/**
 * router/index.ts - renderer 路由配置。
 *
 * @description
 * 定义应用路由表，使用 hash 模式，支持基于会话 ID 的动态工作区路由。
 */

import { createRouter, createWebHistory } from 'vue-router'
import {
  WORKSPACE_ROUTE_NAME,
  WORKSPACE_SESSION_ROUTE_NAME,
  WorkspaceRouteView
} from './workspace-route-host'

/**
 * Vue Router 应用实例。
 * 使用 hash 模式，默认重定向到 /new，动态会话路由对应 Workspace 视图。
 */
const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: WORKSPACE_ROUTE_NAME,
      component: WorkspaceRouteView,
      redirect: { name: 'WorkspaceNew' },
      children: [
        {
          path: 'new',
          name: 'WorkspaceNew',
          component: () => import('@/views/workspace/components/content/WorkspaceNew.vue')
        },
        {
          path: ':sessionId',
          name: WORKSPACE_SESSION_ROUTE_NAME,
          component: () => import('@/views/workspace/components/content/WorkspaceSession.vue'),
          props: true
        }
      ]
    },
    {
      path: '/settings',
      name: 'Settings',
      component: () => import('../views/settings/View.vue'),
      redirect: '/settings/general',
      children: [
        {
          path: 'general',
          name: 'SettingsGeneral',
          component: () => import('../views/settings/general/GeneralSettingsView.vue')
        },
        {
          path: 'personalization',
          name: 'SettingsPersonalization',
          component: () =>
            import('../views/settings/personalization/PersonalizationSettingsView.vue')
        },
        {
          path: 'memory',
          name: 'SettingsMemory',
          component: () => import('../views/settings/memory/MemorySettingsView.vue')
        },
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
              redirect: '/settings/models/default'
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
              redirect: '/settings/models/registry?tab=credentials'
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
        },
        {
          path: 'diagnostics',
          name: 'SettingsDiagnostics',
          component: () => import('../views/settings/diagnostics/DiagnosticsView.vue')
        },
        {
          path: 'extensions',
          name: 'SettingsExtensions',
          component: () => import('../views/settings/extensions/ExtensionsSettingsView.vue'),
          redirect: '/settings/extensions/discovery',
          children: [
            {
              path: 'discovery',
              name: 'SettingsExtensionsDiscovery',
              component: () => import('../views/settings/extensions/DiscoveryView.vue')
            },
            {
              path: 'packages',
              name: 'SettingsExtensionsPackages',
              component: () => import('../views/settings/extensions/PackagesView.vue')
            }
          ]
        },
        {
          path: 'archive',
          name: 'SettingsArchive',
          component: () => import('../views/settings/archive/ArchiveView.vue')
        },
        {
          path: 'about',
          name: 'SettingsAbout',
          component: () => import('../views/settings/about/AboutView.vue')
        }
      ]
    }
  ]
})

/** 导出路由实例，供 main.ts 注册。 */
export default router
