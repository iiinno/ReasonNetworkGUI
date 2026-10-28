import "./style.css";

import {
  agentAddress,
  agentRepo,
  escapeHtml,
  formatClock,
  formatDateTime,
  formatRelative,
  statusLabel,
  truncate,
} from "./format";
import { invoke } from "./tauri";
import type {
  AgentDirectory,
  AgentSession,
  Dashboard,
  DesktopState,
  Notice,
  Panel,
  Selection,
  SessionDetail,
  SessionSummary,
  SourceState,
} from "./types";

type IconName =
  | "agents"
  | "sessions"
  | "serve"
  | "inbox"
  | "moon"
  | "sun"
  | "refresh"
  | "search"
  | "menu"
  | "send"
  | "alert"
  | "empty"
  | "network";

const icons: Record<IconName, string> = {
  agents:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="3"/><path d="M5.5 20v-2.2a4.5 4.5 0 0 1 4.5-4.5h4a4.5 4.5 0 0 1 4.5 4.5V20"/><path d="M4 7.5h2M18 7.5h2"/></svg>',
  sessions:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h14v15H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  serve:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 7 4 5-4 5M12 17h7"/></svg>',
  inbox:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="m4 6 8 7 8-7"/></svg>',
  moon:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.5A8 8 0 0 1 8.5 4 8 8 0 1 0 20 15.5Z"/></svg>',
  sun:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  refresh:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5"/><path d="M18.3 16A8 8 0 1 1 20 12"/></svg>',
  search:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>',
  menu:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  send:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 16 8-16 8 3-8-3-8Z"/><path d="M7 12h13"/></svg>',
  alert:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5M12 17.3v.2"/></svg>',
  empty:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v13H4z"/><path d="M8 7V4h8v3M8 12h8"/></svg>',
  network:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="12" cy="18" r="2.2"/><path d="m7.8 7.2 3 8.7M16.2 7.2l-3 8.7M8.2 6h7.6"/></svg>',
};

const panels: Panel[] = ["agents", "sessions", "serve", "inbox"];
const POLL_INTERVAL_MS = 5_000;
const maxDraftLength = 50_000;
const sessionCache = new Map<string, SessionDetail>();
const sessionErrors = new Map<string, string>();
const drafts = new Map<string, string>();

let refreshInFlight = false;
let detailRequest = 0;
let loadedSessionPath: string | null = null;
let loadingSessionPath: string | null = null;
let noticeTimer: number | null = null;
let pendingSend: { address: string; message: string } | null = null;

const app = requiredElement<HTMLDivElement>("#app");

const state: DesktopState = {
  dashboard: null,
  selection: null,
  sessionDetail: null,
  panel: "agents",
  filter: "",
  composerDraft: "",
  loading: true,
  sessionLoading: false,
  sending: false,
  notice: null,
  theme: readTheme(),
};

applyTheme(state.theme);
renderShell();
bindEvents();
void refreshDashboard();
window.setInterval(() => {
  if (document.visibilityState === "visible") {
    void refreshDashboard();
  }
}, POLL_INTERVAL_MS);

function renderShell(): void {
  app.innerHTML = `
    <div class="app-shell">
      <nav class="rail" aria-label="メインナビゲーション">
        <div class="rail-brand" aria-label="Reason Network">
          ${icon("network")}
        </div>
        ${railButton("agents", "Agents", "agents")}
        ${railButton("sessions", "Codex sessions", "sessions")}
        ${railButton("serve", "Serve log", "serve")}
        ${railButton("inbox", "Inbox", "inbox")}
        <div class="rail-spacer"></div>
        <button class="rail-button" id="theme-toggle" type="button" title="テーマを切り替え">
          ${icon("moon")}
        </button>
      </nav>

      <aside class="sidebar" id="sidebar">
        <header class="sidebar-header">
          <p class="eyebrow">Reason Network</p>
          <h1 class="sidebar-title" id="sidebar-title">Agents</h1>
          <p class="sidebar-subtitle" id="sidebar-subtitle">ローカルネットワークを読み込み中</p>
        </header>
        <div class="sidebar-toolbar">
          <label class="search-box" aria-label="一覧を絞り込む">
            ${icon("search")}
            <input id="filter-input" type="search" autocomplete="off" placeholder="名前・repo・作業で絞り込み" />
          </label>
        </div>
        <div class="sidebar-list" id="sidebar-list"></div>
      </aside>

      <main class="main">
        <header class="main-header">
          <button class="icon-button mobile-only" id="sidebar-toggle" type="button" title="一覧を開く">
            ${icon("menu")}
          </button>
          <div class="main-heading">
            <h2 class="main-title" id="main-title">Reason Network</h2>
            <p class="main-subtitle" id="main-subtitle">ローカルの観測データを準備しています</p>
          </div>
          <div class="header-actions">
            <button class="header-button" id="refresh-button" type="button">
              ${icon("refresh")}
              <span>更新</span>
            </button>
          </div>
        </header>
        <div class="main-scroll" id="main-scroll">
          <div class="main-content" id="main-content">
            ${loadingPanel()}
          </div>
        </div>
      </main>

      <footer class="statusbar">
        <div class="statusbar-group" id="statusbar-sources"></div>
        <div class="statusbar-separator"></div>
        <div class="statusbar-group" id="statusbar-identity">local</div>
        <div class="statusbar-spacer"></div>
        <div class="statusbar-group" id="statusbar-updated">未更新</div>
      </footer>

      <div id="toast-root" aria-live="polite"></div>
    </div>

    <dialog class="dialog" id="send-dialog">
      <div class="dialog-body">
        <div class="dialog-kicker">Reason Network send</div>
        <h2 class="dialog-title">この内容を送信しますか？</h2>
        <p class="dialog-copy" id="dialog-copy"></p>
        <div class="dialog-message" id="dialog-message"></div>
      </div>
      <div class="dialog-footer">
        <button class="secondary-button" id="dialog-cancel" type="button">キャンセル</button>
        <button class="primary-button" id="dialog-confirm" type="button">
          ${icon("send")}
          送信する
        </button>
      </div>
    </dialog>
  `;

  applyTheme(state.theme);
}

function railButton(panel: Panel, label: string, iconName: IconName): string {
  return `
    <button class="rail-button" type="button" data-panel="${panel}" title="${label}" aria-label="${label}">
      ${icon(iconName)}
    </button>
  `;
}

function icon(name: IconName): string {
  return icons[name];
}

function bindEvents(): void {
  app.addEventListener("click", handleClick);
  app.addEventListener("input", handleInput);
  app.addEventListener("keydown", handleKeydown);
}

function handleClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const panelButton = target.closest<HTMLElement>("[data-panel]");
  if (panelButton?.dataset.panel && isPanel(panelButton.dataset.panel)) {
    setPanel(panelButton.dataset.panel);
    return;
  }

  const selectButton = target.closest<HTMLElement>("[data-select-kind]");
  if (selectButton?.dataset.selectKind && selectButton.dataset.selectKey) {
    const kind = selectButton.dataset.selectKind;
    const key = selectButton.dataset.selectKey;
    if (kind === "agent" || kind === "session") {
      setSelection({ kind, key });
    }
    return;
  }

  const statusButton = target.closest<HTMLElement>("[data-status-panel]");
  if (statusButton?.dataset.statusPanel && isPanel(statusButton.dataset.statusPanel)) {
    setPanel(statusButton.dataset.statusPanel);
    return;
  }

  if (target.closest("#refresh-button")) {
    void refreshDashboard(true);
    return;
  }
  if (target.closest("#theme-toggle")) {
    const nextTheme = state.theme === "dark" ? "light" : "dark";
    state.theme = nextTheme;
    applyTheme(nextTheme);
    writeTheme(nextTheme);
    return;
  }
  if (target.closest("#sidebar-toggle")) {
    document.querySelector("#sidebar")?.classList.toggle("is-open");
    return;
  }
  if (target.closest("#send-button")) {
    openSendDialog();
    return;
  }
  if (target.closest("#dialog-cancel")) {
    closeSendDialog();
    return;
  }
  if (target.closest("#dialog-confirm")) {
    void confirmSend();
  }
}

function handleInput(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
    return;
  }
  if (target.id === "filter-input") {
    state.filter = target.value;
    renderSidebar();
  }
  if (target.id === "message-input") {
    state.composerDraft = target.value;
    const selected = selectedAgent();
    if (selected) {
      drafts.set(agentAddress(selected), target.value);
    }
    updateComposerState();
  }
}

function handleKeydown(event: KeyboardEvent): void {
  const target = event.target;
  if (
    event.key === "Enter" &&
    (event.ctrlKey || event.metaKey) &&
    target instanceof HTMLTextAreaElement &&
    target.id === "message-input"
  ) {
    event.preventDefault();
    openSendDialog();
  }
}

function setPanel(panel: Panel): void {
  if (state.panel === panel && state.selection) {
    closeMobileSidebar();
    return;
  }
  saveCurrentDraft();
  state.panel = panel;
  state.filter = "";
  const filter = document.querySelector<HTMLInputElement>("#filter-input");
  if (filter) filter.value = "";

  if (panel === "agents") {
    const first = agents()[0];
    if (first) {
      setSelection({ kind: "agent", key: agentAddress(first) }, false);
    } else {
      state.selection = { kind: "agents" };
    }
  } else if (panel === "sessions") {
    const first = sessions()[0];
    if (first) {
      setSelection({ kind: "session", key: first.path }, false);
    } else {
      state.selection = { kind: "sessions" };
    }
  } else if (panel === "serve") {
    state.selection = { kind: "serve" };
  } else {
    state.selection = { kind: "inbox" };
  }

  hideRailActiveExcept(panel);
  renderSidebar();
  renderMain(true);
  closeMobileSidebar();
  ensureSelectedSessionDetail();
}

function setSelection(selection: Selection, refreshView = true): void {
  if (selection.kind !== "agent") {
    saveCurrentDraft();
  }
  const previous = state.selection;
  state.selection = selection;

  if (selection.kind === "agent") {
    const agent = selectedAgent();
    if (agent && (previous?.kind !== "agent" || previous.key !== selection.key)) {
      state.composerDraft = drafts.get(agentAddress(agent)) ?? "";
    }
  } else if (selection.kind === "session") {
    state.composerDraft = "";
  }

  if (refreshView) {
    renderSidebar();
    renderMain(true);
  }
  ensureSelectedSessionDetail();
  closeMobileSidebar();
}

async function refreshDashboard(manual = false): Promise<void> {
  if (refreshInFlight) return;
  refreshInFlight = true;
  const refresh = document.querySelector("#refresh-button");
  refresh?.classList.add("is-spinning");

  try {
    const dashboard = await invoke<Dashboard>("get_dashboard");
    state.dashboard = dashboard;
    reconcileSelection();
    renderStatusbar();
    renderSidebar();
    if (!(document.activeElement instanceof HTMLElement && document.activeElement.id === "message-input")) {
      renderMain();
    }
    ensureSelectedSessionDetail();
    if (manual) {
      showNotice("info", "ローカルデータを更新しました。");
    }
  } catch (error) {
    showNotice("error", errorMessage(error));
  } finally {
    state.loading = false;
    refreshInFlight = false;
    refresh?.classList.remove("is-spinning");
    if (!state.dashboard) {
      renderMain(true);
    }
  }
}

function reconcileSelection(): void {
  const directory = agents();
  const codexSessions = sessions();
  const selection = state.selection;

  if (!selection) {
    const firstAgent = directory[0];
    const firstSession = codexSessions[0];
    if (firstAgent) {
      state.panel = "agents";
      state.selection = { kind: "agent", key: agentAddress(firstAgent) };
    } else if (firstSession) {
      state.panel = "sessions";
      state.selection = { kind: "session", key: firstSession.path };
    } else {
      state.selection = { kind: "agents" };
    }
    return;
  }

  if (selection.kind === "agent") {
    if (!directory.some((agent) => agentAddress(agent) === selection.key)) {
      const firstAgent = directory[0];
      state.selection = firstAgent
        ? { kind: "agent", key: agentAddress(firstAgent) }
        : { kind: "agents" };
    }
    return;
  }

  if (selection.kind === "agents") {
    const firstAgent = directory[0];
    if (firstAgent) {
      state.selection = { kind: "agent", key: agentAddress(firstAgent) };
    }
    return;
  }

  if (selection.kind === "session") {
    if (!codexSessions.some((session) => session.path === selection.key)) {
      const firstSession = codexSessions[0];
      state.selection = firstSession
        ? { kind: "session", key: firstSession.path }
        : { kind: "sessions" };
    }
    return;
  }

  if (selection.kind === "sessions") {
    const firstSession = codexSessions[0];
    if (firstSession) {
      state.selection = { kind: "session", key: firstSession.path };
    }
  }
}

function renderSidebar(): void {
  if (!state.dashboard) {
    setSidebarText("Agents", "ローカルネットワークを読み込み中");
    return;
  }

  const filterBox = document.querySelector<HTMLElement>(".sidebar-toolbar");
  if (filterBox) {
    filterBox.style.display = state.panel === "agents" || state.panel === "sessions" ? "flex" : "none";
  }
  const filterInput = document.querySelector<HTMLInputElement>("#filter-input");
  if (filterInput) {
    filterInput.placeholder =
      state.panel === "agents" ? "名前・repo・作業で絞り込み" : "タイトル・cwd で絞り込み";
  }

  hideRailActiveExcept(state.panel);
  if (state.panel === "agents") {
    renderAgentSidebar();
  } else if (state.panel === "sessions") {
    renderSessionSidebar();
  } else if (state.panel === "serve") {
    const source = state.dashboard.serveLog;
    setSidebarText("Serve", "常駐 Codex のログ");
    const list = element("#sidebar-list");
    list.innerHTML =
      source.state === "ok"
        ? `<div class="sidebar-note"><strong>${source.data.split(/\r?\n/).length} 行</strong>~\\muse-reason\\serve.log</div>`
        : `<div class="sidebar-note"><strong>読み取り失敗</strong>${escapeHtml(source.error)}</div>`;
  } else {
    const source = state.dashboard.inbox;
    setSidebarText("Inbox", "ユーザー宛メッセージ");
    const list = element("#sidebar-list");
    list.innerHTML =
      source.state === "ok"
        ? `<div class="sidebar-note"><strong>${source.data.split(/\r?\n/).length} 行</strong>reason.exe network inbox の出力</div>`
        : `<div class="sidebar-note"><strong>取得失敗</strong>${escapeHtml(source.error)}</div>`;
  }
}

function renderAgentSidebar(): void {
  const source = state.dashboard?.agents;
  if (!source) return;
  setSidebarText(
    "Agents",
    source.state === "ok"
      ? `${source.data.team ?? "ネットワーク"} · ${source.data.person}/${source.data.machine}`
      : "who --json を取得できません",
  );

  const list = element("#sidebar-list");
  if (source.state === "error") {
    list.innerHTML = `<div class="sidebar-note"><strong>取得失敗</strong>${escapeHtml(source.error)}</div>`;
    return;
  }

  const query = state.filter.trim().toLowerCase();
  const items = [...source.data.sessions]
    .filter((agent) => {
      if (!query) return true;
      return [
        agent.address,
        agent.name,
        agent.person,
        agent.machine,
        agent.agent,
        agent.repo,
        agent.branch,
        agent.doing,
      ].some((value) => value?.toLowerCase().includes(query));
    })
    .sort(compareAgents);

  if (items.length === 0) {
    list.innerHTML = `<div class="sidebar-note"><strong>該当なし</strong>${
      source.data.sessions.length === 0 ? "接続中のセッションはありません。" : "絞り込み条件を変えてください。"
    }</div>`;
    return;
  }

  const groups = new Map<string, AgentSession[]>();
  for (const agent of items) {
    const key = agent.person || "unknown";
    const group = groups.get(key) ?? [];
    group.push(agent);
    groups.set(key, group);
  }

  list.innerHTML = [...groups.entries()]
    .map(
      ([person, agentsInGroup]) => `
        <div class="section-label">
          <span>${escapeHtml(person)}</span>
          <span class="count-pill">${agentsInGroup.length}</span>
        </div>
        ${agentsInGroup.map(agentRow).join("")}
      `,
    )
    .join("");
}

function agentRow(agent: AgentSession): string {
  const key = agentAddress(agent);
  const selected = state.selection?.kind === "agent" && state.selection.key === key;
  const detail = [agentRepo(agent), agent.doing].filter(Boolean).join(" · ") || statusLabel(agent.status);
  return `
    <button
      class="list-row${selected ? " is-selected" : ""}"
      type="button"
      data-select-kind="agent"
      data-select-key="${escapeHtml(key)}"
    >
      <span class="status-dot ${statusClass(agent.status)}"></span>
      <span class="list-main">
        <span class="list-title">${escapeHtml(agent.name || key)}</span>
        <span class="list-detail">${escapeHtml(truncate(detail, 56))}</span>
      </span>
      <span class="list-meta">${escapeHtml(agent.agent || statusLabel(agent.status))}</span>
    </button>
  `;
}

function renderSessionSidebar(): void {
  const source = state.dashboard?.sessions;
  if (!source) return;
  setSidebarText(
    "Codex",
    source.state === "ok" ? `${source.data.length} 件の新しいセッション` : "sessions を取得できません",
  );

  const list = element("#sidebar-list");
  if (source.state === "error") {
    list.innerHTML = `<div class="sidebar-note"><strong>取得失敗</strong>${escapeHtml(source.error)}</div>`;
    return;
  }

  const query = state.filter.trim().toLowerCase();
  const items = source.data.filter((session) => {
    if (!query) return true;
    return session.title.toLowerCase().includes(query) || session.cwd.toLowerCase().includes(query);
  });

  if (items.length === 0) {
    list.innerHTML = `<div class="sidebar-note"><strong>${
      source.data.length === 0 ? "セッションなし" : "該当なし"
    }</strong>${source.data.length === 0 ? "新しい rollout ファイルはありません。" : "絞り込み条件を変えてください。"}</div>`;
    return;
  }

  list.innerHTML = `
    <div class="section-label"><span>最近のセッション</span><span class="count-pill">${items.length}</span></div>
    ${items.map(sessionRow).join("")}
  `;
}

function sessionRow(session: SessionSummary): string {
  const selected = state.selection?.kind === "session" && state.selection.key === session.path;
  return `
    <button
      class="list-row${selected ? " is-selected" : ""}"
      type="button"
      data-select-kind="session"
      data-select-key="${escapeHtml(session.path)}"
    >
      <span class="status-dot is-idle"></span>
      <span class="list-main">
        <span class="list-title">${escapeHtml(session.title)}</span>
        <span class="list-detail">${escapeHtml(truncate(baseName(session.cwd), 48))}</span>
      </span>
      <span class="list-meta">${escapeHtml(formatDateTime(session.updatedAt))}</span>
    </button>
  `;
}

function renderMain(force = false): void {
  if (
    !force &&
    document.activeElement instanceof HTMLElement &&
    document.activeElement.id === "message-input"
  ) {
    return;
  }
  if (!state.dashboard) {
    element("#main-title").textContent = "Reason Network";
    element("#main-subtitle").textContent = "ローカルの観測データを準備しています";
    element("#main-content").innerHTML = loadingPanel();
    return;
  }

  const view = renderSelectionView();
  element("#main-title").textContent = view.title;
  element("#main-subtitle").textContent = view.subtitle;
  element("#main-content").innerHTML = view.html;
  updateComposerState();
}

function renderSelectionView(): { title: string; subtitle: string; html: string } {
  const selection = state.selection;
  if (!selection) {
    return {
      title: "Reason Network",
      subtitle: "表示するデータを選択してください",
      html: emptyPanel("まだ選択がありません", "左の一覧からエージェントまたは Codex セッションを選んでください。"),
    };
  }
  switch (selection.kind) {
    case "agents":
      return renderAgentView();
    case "agent":
      return renderAgentView();
    case "sessions":
      return renderSessionsHome();
    case "session":
      return renderSessionView();
    case "serve":
      return renderServeView();
    case "inbox":
      return renderInboxView();
  }
}

function renderSessionsHome(): { title: string; subtitle: string; html: string } {
  const source = state.dashboard?.sessions;
  if (!source) {
    return { title: "Codex", subtitle: "読み込み中", html: loadingPanel() };
  }
  if (source.state === "error") {
    return {
      title: "Codex sessions",
      subtitle: "%USERPROFILE%\\.codex\\sessions",
      html: sourceErrorPanel(source.error, "Codex セッションを取得できませんでした。"),
    };
  }
  return {
    title: "Codex sessions",
    subtitle: "%USERPROFILE%\\.codex\\sessions",
    html: emptyPanel("セッションがありません", "新しい rollout-*.jsonl が見つかりませんでした。"),
  };
}

function renderAgentView(): { title: string; subtitle: string; html: string } {
  const source = state.dashboard?.agents;
  if (!source) {
    return { title: "Agents", subtitle: "読み込み中", html: loadingPanel() };
  }
  if (source.state === "error") {
    return {
      title: "Agents",
      subtitle: "reason.exe network who --json",
      html: sourceErrorPanel(source.error, "Reason CLI の実行結果を取得できませんでした。"),
    };
  }

  const agent = selectedAgent();
  if (!agent) {
    return {
      title: "Agents",
      subtitle: source.data.team ?? "Reason Network",
      html: emptyPanel(
        "表示中のエージェントがいません",
        "who --json は成功しましたが、セッション一覧が空です。",
      ),
    };
  }

  const address = agentAddress(agent);
  const status = statusLabel(agent.status);
  const doing = agent.doing?.trim() || "現在の作業内容は報告されていません。";
  const since = agent.since ? `${formatDateTime(agent.since)} から` : "開始時刻不明";

  return {
    title: address,
    subtitle: `${agent.person || "person 不明"} · ${agent.machine || "machine 不明"} · ${agent.agent || "agent 不明"}`,
    html: `
      <div class="chip-row">
        <span class="chip"><span class="status-dot ${statusClass(agent.status)}"></span><strong>${escapeHtml(status)}</strong></span>
        <span class="chip">${escapeHtml(agentRepo(agent))}</span>
        ${agent.tier ? `<span class="chip">tier <strong>${escapeHtml(agent.tier)}</strong></span>` : ""}
        ${agent.worker ? '<span class="chip is-accent">worker</span>' : ""}
      </div>

      <div class="detail-grid">
        <section class="detail-card is-wide">
          <div class="detail-label">Doing</div>
          <div class="detail-value">${escapeHtml(doing)}</div>
        </section>
        <section class="detail-card">
          <div class="detail-label">Last activity</div>
          <div class="detail-value">${escapeHtml(since)}<br><span class="detail-value is-muted">${escapeHtml(formatRelative(agent.since))}</span></div>
        </section>
        <section class="detail-card">
          <div class="detail-label">Address</div>
          <div class="detail-value mono">${escapeHtml(address)}</div>
        </section>
        <section class="detail-card">
          <div class="detail-label">Repository</div>
          <div class="detail-value mono">${escapeHtml(agentRepo(agent))}</div>
        </section>
        <section class="detail-card">
          <div class="detail-label">Machine</div>
          <div class="detail-value">${escapeHtml(agent.machine || "不明")}</div>
        </section>
      </div>

      <section class="composer" aria-label="メッセージ送信">
        <div class="composer-header">
          <span>Send to <span class="mono">${escapeHtml(address)}</span></span>
          <span>Ctrl + Enter で確認</span>
        </div>
        <textarea
          id="message-input"
          maxlength="${maxDraftLength}"
          spellcheck="true"
          placeholder="送信するメッセージを入力"
        >${escapeHtml(state.composerDraft)}</textarea>
        <div class="composer-footer">
          <span class="composer-hint">送信前に必ず確認ダイアログを表示します。テスト送信は行いません。</span>
          <div class="statusbar-group">
            <span class="composer-hint" id="composer-count">0 / ${maxDraftLength.toLocaleString("ja")}</span>
            <button class="primary-button" id="send-button" type="button"${state.sending ? " disabled" : ""}>
              ${icon("send")}
              ${state.sending ? "送信中" : "確認して送信"}
            </button>
          </div>
        </div>
      </section>
    `,
  };
}

function renderSessionView(): { title: string; subtitle: string; html: string } {
  const selection = state.selection;
  if (selection?.kind !== "session") {
    return { title: "Codex", subtitle: "セッション未選択", html: emptyPanel("セッション未選択", "一覧から会話を選んでください。") };
  }
  const summary = sessions().find((session) => session.path === selection.key);
  if (!summary) {
    return { title: "Codex", subtitle: "セッションが見つかりません", html: emptyPanel("セッションなし", "更新して一覧を再取得してください。") };
  }

  const error = sessionErrors.get(summary.path);
  const detail =
    loadedSessionPath === summary.path && state.sessionDetail?.id === summary.id
      ? state.sessionDetail
      : null;
  const chips = `
    <div class="chip-row">
      <span class="chip">id <strong>${escapeHtml(shortId(summary.id))}</strong></span>
      <span class="chip">${escapeHtml(formatDateTime(summary.updatedAt))}</span>
      ${detail ? `<span class="chip"><strong>${detail.messages.length}</strong> messages</span>` : ""}
    </div>
  `;

  if (state.sessionLoading && loadedSessionPath !== summary.path) {
    return {
      title: summary.title,
      subtitle: summary.cwd || summary.path,
      html: `${chips}<div class="detail-card is-wide">${loadingPanel()}</div>`,
    };
  }
  if (error && !detail) {
    return {
      title: summary.title,
      subtitle: summary.cwd || summary.path,
      html: `${chips}${sourceErrorPanel(error, "rollout JSONL を読み取れませんでした。")}`,
    };
  }
  if (!detail) {
    return {
      title: summary.title,
      subtitle: summary.cwd || summary.path,
      html: `${chips}<div class="detail-card is-wide">${loadingPanel()}</div>`,
    };
  }
  if (detail.messages.length === 0) {
    return {
      title: summary.title,
      subtitle: summary.cwd || summary.path,
      html: `${chips}${emptyPanel("会話テキストがありません", "この rollout には user / assistant の表示対象メッセージがありません。")}`,
    };
  }

  return {
    title: summary.title,
    subtitle: summary.cwd || summary.path,
    html: `
      ${chips}
      <div class="conversation">
        ${detail.messages
          .map(
            (message) => `
              <article class="message ${message.role === "user" ? "is-user" : "is-assistant"}">
                <div class="message-author">${message.role === "user" ? "You" : "Codex"}</div>
                <pre class="message-body">${escapeHtml(message.text)}</pre>
              </article>
            `,
          )
          .join("")}
      </div>
    `,
  };
}

function renderServeView(): { title: string; subtitle: string; html: string } {
  const source = state.dashboard?.serveLog;
  if (!source) {
    return { title: "Serve log", subtitle: "読み込み中", html: loadingPanel() };
  }
  if (source.state === "error") {
    return {
      title: "Serve log",
      subtitle: "~\\muse-reason\\serve.log",
      html: sourceErrorPanel(source.error, "serve.log の末尾を表示できませんでした。"),
    };
  }
  return {
    title: "Serve log",
    subtitle: "~\\muse-reason\\serve.log",
    html: terminalPanel(
      "serve.log",
      source.data,
      "ANSI エスケープを除去し、UTF-16LE / UTF-8 を自動判定して末尾を表示しています。",
    ),
  };
}

function renderInboxView(): { title: string; subtitle: string; html: string } {
  const source = state.dashboard?.inbox;
  if (!source) {
    return { title: "Inbox", subtitle: "読み込み中", html: loadingPanel() };
  }
  if (source.state === "error") {
    return {
      title: "Inbox",
      subtitle: "reason.exe network inbox",
      html: sourceErrorPanel(source.error, "ユーザー宛メッセージを取得できませんでした。"),
    };
  }
  return {
    title: "Inbox",
    subtitle: "reason.exe network inbox",
    html: terminalPanel("network inbox", source.data, "Reason CLI の受信出力をそのまま表示しています。"),
  };
}

function terminalPanel(title: string, text: string, note: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return `
    <div class="chip-row">
      <span class="chip"><strong>${lines.length}</strong> lines</span>
      <span class="chip">${escapeHtml(note)}</span>
    </div>
    <section class="terminal-shell">
      <div class="terminal-top">
        <span class="terminal-light"></span>
        <span class="terminal-title">${escapeHtml(title)}</span>
      </div>
      <pre class="terminal-body">${lines.map(terminalLine).join("")}</pre>
    </section>
  `;
}

function terminalLine(line: string): string {
  if (!line) return '<span class="terminal-line"> </span>';
  const event =
    line.includes("takes work") ||
    line.includes("listening on") ||
    line.includes("registered") ||
    line.includes("net:");
  const answer = line.includes("✓") || line.includes("→") || line.includes("OK");
  const marker = line.startsWith("===");
  const className = marker
    ? "terminal-line is-marker"
    : event
      ? "terminal-line is-event"
      : answer
        ? "terminal-line is-answer"
        : "terminal-line";
  return `<span class="${className}">${escapeHtml(line)}</span>`;
}

function renderStatusbar(): void {
  if (!state.dashboard) return;
  const sources = element("#statusbar-sources");
  sources.innerHTML = [
    sourceIndicator("Agents", state.dashboard.agents, "agents"),
    sourceIndicator("Serve", state.dashboard.serveLog, "serve"),
    sourceIndicator("Inbox", state.dashboard.inbox, "inbox"),
    sourceIndicator("Sessions", state.dashboard.sessions, "sessions"),
  ].join("");

  const directory = agentsDirectory();
  const identity = directory
    ? `${directory.team ?? "network"} · ${directory.person}/${directory.machine}`
    : "Reason Network · local";
  element("#statusbar-identity").textContent = identity;
  element("#statusbar-updated").textContent = `${formatClock(state.dashboard.generatedAt)} 更新 · 5 秒ポーリング`;
}

function sourceIndicator<T>(label: string, source: SourceState<T>, panel: Panel): string {
  const ok = source.state === "ok";
  const title = ok ? `${label}: OK` : `${label}: ${source.error}`;
  return `
    <button class="source-indicator" type="button" data-status-panel="${panel}" title="${escapeHtml(title)}">
      <span class="status-dot ${ok ? "is-ok" : "is-error"}"></span>
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function updateComposerState(): void {
  const input = document.querySelector<HTMLTextAreaElement>("#message-input");
  if (!input) return;
  const count = document.querySelector<HTMLElement>("#composer-count");
  const send = document.querySelector<HTMLButtonElement>("#send-button");
  if (count) count.textContent = `${state.composerDraft.length.toLocaleString("ja")} / ${maxDraftLength.toLocaleString("ja")}`;
  if (send) send.disabled = state.sending || state.composerDraft.trim().length === 0;
}

function openSendDialog(): void {
  const agent = selectedAgent();
  const message = state.composerDraft.trim();
  if (!agent || !message) {
    showNotice("error", "送信先とメッセージを確認してください。");
    return;
  }
  const dialog = document.querySelector<HTMLDialogElement>("#send-dialog");
  if (!dialog) return;
  pendingSend = { address: agentAddress(agent), message };
  element("#dialog-copy").textContent = `${agentAddress(agent)} に次のメッセージを送ります。`;
  element("#dialog-message").textContent = message;
  dialog.showModal();
}

function closeSendDialog(): void {
  const dialog = document.querySelector<HTMLDialogElement>("#send-dialog");
  if (dialog?.open) dialog.close();
  pendingSend = null;
}

async function confirmSend(): Promise<void> {
  if (!pendingSend) return;
  const request = pendingSend;
  closeSendDialog();
  state.sending = true;
  renderMain(true);
  try {
    const output = await invoke<string>("send_message", {
      address: request.address,
      message: request.message,
    });
    drafts.set(request.address, "");
    const currentAgent = selectedAgent();
    if (currentAgent && agentAddress(currentAgent) === request.address) {
      state.composerDraft = "";
    }
    showNotice("success", output.trim() || "送信しました。");
    await refreshDashboard();
  } catch (error) {
    showNotice("error", errorMessage(error));
  } finally {
    state.sending = false;
    renderMain(true);
  }
}

async function ensureSelectedSessionDetail(): Promise<void> {
  const selection = state.selection;
  if (selection?.kind !== "session") return;
  const summary = sessions().find((session) => session.path === selection.key);
  if (!summary) return;

  const cached = sessionCache.get(summary.path);
  if (cached && cached.updatedAt === summary.updatedAt) {
    loadedSessionPath = summary.path;
    state.sessionDetail = cached;
    state.sessionLoading = false;
    renderMain();
    return;
  }

  if (state.sessionLoading && loadingSessionPath === summary.path) return;
  await loadSessionDetail(summary);
}

async function loadSessionDetail(summary: SessionSummary): Promise<void> {
  const request = ++detailRequest;
  state.sessionLoading = true;
  loadingSessionPath = summary.path;
  sessionErrors.delete(summary.path);
  if (loadedSessionPath !== summary.path) {
    state.sessionDetail = null;
  }
  renderMain(true);

  try {
    const detail = await invoke<SessionDetail>("get_session", { path: summary.path });
    if (request !== detailRequest || !isCurrentSession(summary.path)) return;
    sessionCache.set(summary.path, detail);
    loadedSessionPath = summary.path;
    loadingSessionPath = null;
    state.sessionDetail = detail;
    state.sessionLoading = false;
    renderMain(true);
    scrollConversationToBottom();
  } catch (error) {
    if (request !== detailRequest || !isCurrentSession(summary.path)) return;
    sessionErrors.set(summary.path, errorMessage(error));
    loadingSessionPath = null;
    state.sessionLoading = false;
    renderMain(true);
  }
}

function scrollConversationToBottom(): void {
  const scroll = document.querySelector<HTMLElement>("#main-scroll");
  if (scroll) {
    requestAnimationFrame(() => {
      scroll.scrollTop = scroll.scrollHeight;
    });
  }
}

function isCurrentSession(path: string): boolean {
  return state.selection?.kind === "session" && state.selection.key === path;
}

function showNotice(tone: Notice["tone"], message: string): void {
  state.notice = { tone, message };
  const root = document.querySelector<HTMLElement>("#toast-root");
  if (!root) return;
  root.innerHTML = `<div class="toast is-${tone}">${escapeHtml(message)}</div>`;
  if (noticeTimer !== null) window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    root.innerHTML = "";
    state.notice = null;
    noticeTimer = null;
  }, 4_500);
}

function agentsDirectory(): AgentDirectory | null {
  const source = state.dashboard?.agents;
  return source?.state === "ok" ? source.data : null;
}

function agents(): AgentSession[] {
  return agentsDirectory()?.sessions ?? [];
}

function sessions(): SessionSummary[] {
  const source = state.dashboard?.sessions;
  return source?.state === "ok" ? source.data : [];
}

function selectedAgent(): AgentSession | null {
  const selection = state.selection;
  if (selection?.kind !== "agent") return null;
  return agents().find((agent) => agentAddress(agent) === selection.key) ?? null;
}

function saveCurrentDraft(): void {
  const agent = selectedAgent();
  if (agent) {
    drafts.set(agentAddress(agent), state.composerDraft);
  }
}

function compareAgents(left: AgentSession, right: AgentSession): number {
  const rank = (agent: AgentSession): number => {
    const status = agent.status.toLowerCase();
    if (status === "busy") return 0;
    if (status === "idle") return 1;
    if (status === "offline") return 3;
    return 2;
  };
  return rank(left) - rank(right) || left.name.localeCompare(right.name, "ja");
}

function statusClass(status: string): string {
  const value = status.toLowerCase();
  if (value === "busy") return "is-busy";
  if (value === "idle") return "is-idle";
  if (value === "offline") return "is-offline";
  return "";
}

function setSidebarText(title: string, subtitle: string): void {
  element("#sidebar-title").textContent = title;
  element("#sidebar-subtitle").textContent = subtitle;
}

function hideRailActiveExcept(panel: Panel): void {
  document.querySelectorAll<HTMLElement>("[data-panel]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.panel === panel);
  });
}

function closeMobileSidebar(): void {
  document.querySelector("#sidebar")?.classList.remove("is-open");
}

function loadingPanel(): string {
  return `
    <div class="loading-lines" aria-label="読み込み中">
      <div class="loading-line"></div>
      <div class="loading-line"></div>
      <div class="loading-line"></div>
      <div class="loading-line"></div>
    </div>
  `;
}

function sourceErrorPanel(error: string, context: string): string {
  return `
    <section class="source-error">
      <div class="state-icon">${icon("alert")}</div>
      <h3 class="state-title">取得できませんでした</h3>
      <p class="state-copy">${escapeHtml(context)}</p>
      <p class="state-copy mono">${escapeHtml(error)}</p>
    </section>
  `;
}

function emptyPanel(title: string, copy: string): string {
  return `
    <section class="empty-state">
      <div>
        <div class="state-icon">${icon("empty")}</div>
        <h3 class="state-title">${escapeHtml(title)}</h3>
        <p class="state-copy">${escapeHtml(copy)}</p>
      </div>
    </section>
  `;
}

function applyTheme(theme: "dark" | "light"): void {
  document.documentElement.dataset.theme = theme;
  const toggle = document.querySelector<HTMLButtonElement>("#theme-toggle");
  if (toggle) {
    toggle.innerHTML = theme === "dark" ? icon("moon") : icon("sun");
    toggle.title = theme === "dark" ? "ライトテーマに切り替え" : "ダークテーマに切り替え";
  }
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) {
    meta.content = getComputedStyle(document.documentElement)
      .getPropertyValue("--background-primary")
      .trim();
  }
}

function readTheme(): "dark" | "light" {
  try {
    return localStorage.getItem("reason-network-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function writeTheme(theme: "dark" | "light"): void {
  try {
    localStorage.setItem("reason-network-theme", theme);
  } catch {
    // Theme persistence is optional when WebView storage is unavailable.
  }
}

function element(selector: string): HTMLElement {
  const value = document.querySelector<HTMLElement>(selector);
  if (!value) throw new Error(`Missing element: ${selector}`);
  return value;
}

function requiredElement<T extends Element>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing element: ${selector}`);
  return value;
}

function isPanel(value: string): value is Panel {
  return panels.includes(value as Panel);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

function baseName(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).at(-1) ?? path;
}

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value;
}
