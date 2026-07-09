const state = {
  clicks: 0,
  lastAction: undefined,
  lastResult: undefined,
  updatedAt: undefined,
  segment: "草稿",
  toggled: false,
};

const elements = {
  status: document.getElementById("status"),
  clicks: document.getElementById("clicks"),
  lastAction: document.getElementById("last-action"),
  lastResult: document.getElementById("last-result"),
  refresh: document.getElementById("refresh"),
  toggle: document.getElementById("toggle"),
  menuButton: document.getElementById("menu-button"),
  menu: document.getElementById("menu"),
  segments: Array.from(document.querySelectorAll("[data-segment]")),
};

function post(action, value) {
  window.piPanel.post({ type: "button", action, value });
}

function render() {
  elements.clicks.textContent = String(state.clicks);
  elements.lastAction.textContent = state.lastAction || "-";
  elements.lastResult.textContent = state.lastResult || "-";
  elements.status.textContent = state.updatedAt ? `已更新 ${new Date(state.updatedAt).toLocaleTimeString()}` : "就绪";

  elements.toggle.setAttribute("aria-pressed", String(state.toggled));
  elements.toggle.textContent = state.toggled ? "切换开启" : "切换关闭";

  for (const button of elements.segments) {
    button.classList.toggle("active", button.dataset.segment === state.segment);
  }
}

function closeMenu() {
  elements.menu.hidden = true;
  elements.menuButton.setAttribute("aria-expanded", "false");
}

function toggleMenu() {
  const isOpen = !elements.menu.hidden;
  elements.menu.hidden = isOpen;
  elements.menuButton.setAttribute("aria-expanded", String(!isOpen));
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
  if (message.type !== "extension-requests-state") return;

  state.clicks = Number(message.clicks || 0);
  state.lastAction = message.lastAction;
  state.lastResult = message.lastResult;
  state.updatedAt = message.updatedAt;
  render();
});

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("button") : null;
  if (!target || target.disabled) return;

  if (target === elements.menuButton) {
    toggleMenu();
    return;
  }

  const segment = target.dataset.segment;
  if (segment) {
    state.segment = segment;
    render();
    post("segment", segment);
    return;
  }

  if (target === elements.toggle) {
    state.toggled = !state.toggled;
    render();
    post("toggle", state.toggled ? "on" : "off");
    return;
  }

  const action = target.dataset.action;
  if (!action) return;
  closeMenu();
  post(action, target.dataset.value);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});

elements.refresh.addEventListener("click", () => window.piPanel.post({ type: "refresh" }));

render();
window.piPanel.post({ type: "ready" });
