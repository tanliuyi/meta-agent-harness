import { computed, readonly, ref } from 'vue'
import type { UpdaterState } from '@shared/updater'
import { updaterApi } from '@renderer/api'

const state = ref<UpdaterState>({
  status: 'idle',
  currentVersion: ''
})
let initialized = false

function initialize(): void {
  if (initialized) return
  initialized = true

  updaterApi.onStateChanged((nextState) => {
    state.value = nextState
  })
  void updaterApi.getState().then((initialState) => {
    state.value = initialState
  })
}

export function useUpdater() {
  initialize()

  const isBusy = computed(
    () => state.value.status === 'checking' || state.value.status === 'downloading'
  )

  return {
    state: readonly(state),
    isBusy,
    check: () => updaterApi.check(),
    download: () => updaterApi.download(),
    install: () => updaterApi.install()
  }
}
