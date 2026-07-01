import { defineStore } from 'pinia'
import { ref } from 'vue'

export default defineStore('workspace-ui', () => {
  const sidebarOpen = ref(true)
  const sidebarWidth = ref(208)
  const minSidebarWidth = 160
  const maxSidebarWidth = 420

  const setSidebarWidth = (width: number): void => {
    sidebarWidth.value = Math.min(maxSidebarWidth, Math.max(minSidebarWidth, width))
  }

  return {
    maxSidebarWidth,
    minSidebarWidth,
    setSidebarWidth,
    sidebarOpen,
    sidebarWidth
  }
})
