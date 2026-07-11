import { computed, readonly, ref } from 'vue'
import type { UpdaterState } from '@shared/updater'

const state = ref<UpdaterState>({
  status: 'idle',
  currentVersion: ''
})
let initialized = false

function initialize(): void {
  if (initialized) return
  initialized = true

  window.api.updater.onStateChanged((nextState) => {
    state.value = nextState
  })
  void window.api.updater.getState().then((initialState) => {
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
    check: () => window.api.updater.check(),
    download: () => window.api.updater.download(),
    install: () => window.api.updater.install()
  }
}
