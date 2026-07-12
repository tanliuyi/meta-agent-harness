const state = document.getElementById('state')
const ping = document.getElementById('ping')
const savedState = window.piPanel.getState() || { localPingCount: 0 }

function savePanelState(nextState) {
  window.piPanel.setState(nextState)
}

function renderState(message) {
  state.textContent = JSON.stringify(
    {
      ...message,
      localPingCount: savedState.localPingCount
    },
    null,
    2
  )
}

window.piPanel.onMessage((message) => {
  if (message.type === 'pi:webview.theme') {
    document.documentElement.dataset.theme = message.theme
    return
  }
  if (message.type === 'pi:webview.visibility' || message.type === 'pi:webview.restoreState') {
    return
  }
  renderState(message)
})

ping.addEventListener('click', () => {
  savedState.localPingCount += 1
  savePanelState(savedState)
  window.piPanel.post({ type: 'ping', sentAt: new Date().toISOString() })
})

renderState({ type: 'ready' })
