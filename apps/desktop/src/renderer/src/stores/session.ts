import { defineStore } from 'pinia'
import { shallowReactive } from 'vue'

export default defineStore('session-store', () => {
  const sessions = shallowReactive<Record<string, unknown>>({})

  return {
    sessions
  }
})
