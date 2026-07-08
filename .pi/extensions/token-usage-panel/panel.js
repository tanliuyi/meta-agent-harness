const panelApi = window.piPanel;
const el = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat("en-US");
const int = (value) => nf.format(Math.round(Number(value) || 0));
const k = (value) => `${((Number(value) || 0) / 1000).toFixed(1)}K`;
const money = (value) => (Number(value) > 0 ? `$${Number(value).toFixed(4)}` : "$0");
const pct = (value) => `${(Number(value) || 0).toFixed(1)}%`;
const time = (value) => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

function setText(id, value) {
  el(id).textContent = value;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "'": return "&#39;";
      case '"': return "&quot;";
      default: return char;
    }
  });
}

function barRow(label, value, max, color) {
  const width = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return '<div class="bar__row"><div class="bar__label" title="' + escapeHtml(label) + '">' +
    escapeHtml(label) +
    '</div><div class="bar__track"><div class="bar__fill" style="width:' + width + '%; background:' +
    (color || "var(--accent)") +
    '"></div></div><div class="bar__value">' + k(value) + '</div></div>';
}

function render(state) {
  if (!state || state.type !== "usage-state") return;
  const s = state.stats || {};
  setText("log", state.logFile || "");
  setText("updated", state.updatedAt ? "Updated " + time(state.updatedAt) : "");
  setText("total", k(s.totalTokens));
  setText("requests", int(s.requests) + " requests");
  setText("hitRate", pct(s.cacheHitRate));
  setText("cache", k(s.cacheRead) + " read / " + k(s.cacheWrite) + " write");
  setText("input", k(s.input));
  setText("output", k(s.output));
  setText("cost", money(s.cost?.total));
  setText("cacheReadMini", k(s.cacheRead));
  setText("cacheWriteMini", k(s.cacheWrite));

  const promptTokens = (s.input || 0) + (s.cacheRead || 0) + (s.cacheWrite || 0);
  setText("cacheTotal", k(promptTokens) + " prompt tokens");
  el("cacheBars").innerHTML = [
    barRow("Input", s.input || 0, promptTokens, "var(--blue)"),
    barRow("Cache read", s.cacheRead || 0, promptTokens, "var(--accent)"),
    barRow("Cache write", s.cacheWrite || 0, promptTokens, "var(--amber)")
  ].join("");

  const models = Array.isArray(state.byModel) ? state.byModel : [];
  setText("modelCount", models.length + " models");
  const maxModelTokens = Math.max(0, ...models.map((model) => model.totalTokens || 0));
  el("modelBars").innerHTML = models.length
    ? models.map((model) => barRow(model.key, model.totalTokens || 0, maxModelTokens, "var(--accent)")).join("")
    : '<div class="empty">No model usage yet.</div>';

  const recent = Array.isArray(state.recent) ? state.recent : [];
  setText("recentCount", String(recent.length));
  el("recent").innerHTML = recent.length
    ? recent.map((record) => '<tr><td>' + time(record.timestamp) + '</td><td class="model" title="' + escapeHtml(record.modelKey) + '">' + escapeHtml(record.modelKey) + '</td><td>' + k(record.totalTokens) + '</td><td>' + k(record.input) + '</td><td>' + k(record.output) + '</td><td><span class="pill">' + k(record.cacheRead) + ' / ' + k(record.cacheWrite) + '</span></td><td>' + money(record.cost?.total) + '</td></tr>').join("")
    : '<tr><td colspan="7" class="empty">No requests recorded.</td></tr>';
}

panelApi?.onMessage(render);
el("reset").addEventListener("click", () => panelApi?.post({ type: "reset" }));
