const state = {
  goal: undefined,
  editorOpen: false,
};

const elements = {
  status: document.getElementById("status"),
  empty: document.getElementById("empty"),
  details: document.getElementById("details"),
  objective: document.getElementById("objective"),
  metricStatus: document.getElementById("metric-status"),
  metricIteration: document.getElementById("metric-iteration"),
  metricElapsed: document.getElementById("metric-elapsed"),
  metricTokens: document.getElementById("metric-tokens"),
  commands: document.getElementById("commands"),
  start: document.getElementById("start"),
  startEmpty: document.getElementById("start-empty"),
  edit: document.getElementById("edit"),
  pause: document.getElementById("pause"),
  resume: document.getElementById("resume"),
  clear: document.getElementById("clear"),
  refresh: document.getElementById("refresh"),
};

function post(type) {
  window.piPanel.post({ type });
}

function postEditorAction(type) {
  state.editorOpen = true;
  render();
  post(type);
}

function render() {
  const goal = state.goal;
  const hasGoal = Boolean(goal);
  const editorOpen = Boolean(state.editorOpen);
  elements.empty.hidden = hasGoal;
  elements.details.hidden = !hasGoal;
  elements.start.disabled = editorOpen;
  elements.startEmpty.disabled = editorOpen;

  if (!goal) {
    elements.status.textContent = "No active goal";
    elements.objective.textContent = "";
    elements.metricStatus.textContent = "-";
    elements.metricIteration.textContent = "-";
    elements.metricElapsed.textContent = "-";
    elements.metricTokens.textContent = "-";
    elements.commands.textContent = "";
    elements.edit.disabled = true;
    elements.pause.disabled = true;
    elements.resume.disabled = true;
    elements.clear.disabled = true;
    return;
  }

  elements.status.textContent = goal.statusText || goal.status;
  elements.objective.textContent = goal.text || "";
  elements.metricStatus.textContent = goal.status || "-";
  elements.metricIteration.textContent = String(goal.iteration ?? "-");
  elements.metricElapsed.textContent = goal.elapsed || "-";
  elements.metricTokens.textContent = goal.tokens || "-";
  elements.commands.textContent = goal.commands || "";

  elements.edit.disabled = editorOpen;
  elements.pause.disabled = editorOpen || goal.status !== "active";
  elements.resume.disabled = editorOpen || (goal.status !== "paused" && goal.status !== "budget_limited");
  elements.clear.disabled = editorOpen;
}

window.piPanel.onMessage((message) => {
  if (!message || typeof message !== "object") return;
  if (
    message.type === "pi:webview.theme" ||
    message.type === "pi:webview.visibility" ||
    message.type === "pi:webview.restoreState"
  ) {
    return;
  }
  if (message.type !== "goal-state") return;
  state.goal = message.goal;
  state.editorOpen = Boolean(message.editorOpen);
  render();
});

elements.start.addEventListener("click", () => postEditorAction("start"));
elements.startEmpty.addEventListener("click", () => postEditorAction("start"));
elements.edit.addEventListener("click", () => postEditorAction("edit"));
elements.pause.addEventListener("click", () => post("pause"));
elements.resume.addEventListener("click", () => post("resume"));
elements.clear.addEventListener("click", () => post("clear"));
elements.refresh.addEventListener("click", () => post("refresh"));

render();
post("ready");
