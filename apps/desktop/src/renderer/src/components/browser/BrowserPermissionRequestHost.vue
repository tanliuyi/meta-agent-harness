<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { confirm } from '@renderer/composables/useConfirmDialog'
import { registerBrowserPermissionRequestHandler } from './browserPermissionRequestHandler'

let unsubscribe: (() => void) | undefined

onMounted(() => {
  unsubscribe = registerBrowserPermissionRequestHandler({
    subscribe: window.api.browserPreview.onPermissionRequested,
    confirmRequest: async (request) => {
      const result = await confirm({
        id: `browser-permission-${request.requestId}`,
        title: `允许 ${request.origin} 使用网页权限？`,
        description: `站点请求 ${request.permission} 权限。允许后，该站点在本次应用运行期间可继续使用这项权限；可在 Settings > Safety 中关闭或改为完整允许。`,
        confirmText: '允许',
        cancelText: '拒绝',
        tone: 'destructive'
      })
      return result.confirmed
    },
    respond: window.api.browserPreview.respondPermission
  })
})

onBeforeUnmount(() => unsubscribe?.())
</script>

<template>
  <!-- Renderless host: lifecycle hooks own the browser permission subscription. -->
</template>
