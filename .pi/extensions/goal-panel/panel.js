const state = {
  goal: undefined,
  editorOpen: false,
  pendingAction: undefined
}

const elements = {
  status: document.getElementById('status'),
  statusText: document.getElementById('status-text'),
  empty: document.getElementById('empty'),
  details: document.getElementById('details'),
  objective: document.getElementById('objective'),
  metricIteration: document.getElementById('metric-iteration'),
  metricElapsed: document.getElementById('metric-elapsed'),
  metricTokens: document.getElementById('metric-tokens'),
  tokenProgress: document.getElementById('token-progress'),
  tokenProgressFill: document.getElementById('token-progress-fill'),
  activity: document.getElementById('activity'),
  actions: document.querySelector('.actions'),
  start: document.getElementById('start'),
  startEmpty: document.getElementById('start-empty'),
  edit: document.getElementById('edit'),
  pause: document.getElementById('pause'),
  resume: document.getElementById('resume'),
  clear: document.getElementById('clear'),
  refresh: document.getElementById('refresh')
}

const actionLabels = {
  start: '正在打开目标编辑器...',
  edit: '正在打开目标编辑器...',
  pause: '正在暂停目标...',
  resume: '正在继续目标...',
  clear: '正在清除目标...',
  refresh: '正在刷新状态...'
}

function post(type) {
  if (state.pendingAction) return
  state.pendingAction = type
  render()
  window.piPanel.post({ type })
}

function statusLabel(goal) {
  if (!goal) return '暂无目标'
  if (goal.status === 'active') return '执行中'
  if (goal.status === 'paused') return '已暂停'
  if (goal.status === 'budget_limited') return 'Token 预算已用完'
  if (goal.status === 'complete') return '已完成'
  return goal.statusText || goal.status
}

function renderProgress(goal) {
  const budget = Number(goal?.tokenBudget)
  const used = Number(goal?.tokensUsed)
  const hasBudget = Number.isFinite(budget) && budget > 0 && Number.isFinite(used)
  elements.tokenProgress.hidden = !hasBudget
  if (!hasBudget) return

  const percent = Math.max(0, Math.min(100, (used / budget) * 100))
  elements.tokenProgressFill.style.width = `${percent}%`
  elements.tokenProgress.setAttribute('aria-valuenow', String(Math.round(percent)))
  elements.tokenProgress.setAttribute('aria-valuemin', '0')
  elements.tokenProgress.setAttribute('aria-valuemax', '100')
  elements.tokenProgress.dataset.warning = String(percent >= 90)
}

function render() {
  const goal = state.goal
  const hasGoal = Boolean(goal)
  const busy = Boolean(state.editorOpen || state.pendingAction)

  elements.empty.hidden = hasGoal
  elements.details.hidden = !hasGoal
  elements.actions.hidden = !hasGoal
  elements.status.dataset.status = goal?.status || 'empty'
  elements.statusText.textContent = statusLabel(goal)
  elements.activity.hidden = !busy
  elements.activity.textContent = state.editorOpen
    ? '请完成目标编辑后继续。'
    : actionLabels[state.pendingAction] || ''
  elements.refresh.classList.toggle('is-pending', state.pendingAction === 'refresh')

  elements.start.disabled = busy
  elements.startEmpty.disabled = busy
  elements.refresh.disabled = busy

  if (!goal) {
    elements.objective.textContent = ''
    elements.metricIteration.textContent = '-'
    elements.metricElapsed.textContent = '-'
    elements.metricTokens.textContent = '-'
    elements.edit.disabled = true
    elements.pause.disabled = true
    elements.resume.disabled = true
    elements.clear.disabled = true
    renderProgress(undefined)
    return
  }

  elements.objective.textContent = goal.text || ''
  elements.metricIteration.textContent = String(goal.iteration ?? '-')
  elements.metricElapsed.textContent = goal.elapsed || '-'
  elements.metricTokens.textContent = goal.tokens || '-'
  renderProgress(goal)

  elements.edit.disabled = busy
  elements.pause.disabled = busy || goal.status !== 'active'
  elements.pause.hidden = goal.status !== 'active'
  elements.resume.disabled = busy || (goal.status !== 'paused' && goal.status !== 'budget_limited')
  elements.resume.hidden = goal.status === 'active'
  elements.clear.disabled = busy
}

window.piPanel.onMessage((message) => {
  if (!message || typeof message !== 'object') return
  if (message.type !== 'goal-state') return
  state.goal = message.goal
  state.editorOpen = Boolean(message.editorOpen)
  state.pendingAction = undefined
  render()
})

elements.start.addEventListener('click', () => post('start'))
elements.startEmpty.addEventListener('click', () => post('start'))
elements.edit.addEventListener('click', () => post('edit'))
elements.pause.addEventListener('click', () => post('pause'))
elements.resume.addEventListener('click', () => post('resume'))
elements.clear.addEventListener('click', () => post('clear'))
elements.refresh.addEventListener('click', () => post('refresh'))

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey)
    return
  if (event.key.toLowerCase() === 'r' && !elements.refresh.disabled) {
    event.preventDefault()
    post('refresh')
  }
})

render()
window.piPanel.post({ type: 'ready' })
