const output = document.querySelector('#verification');
const checks = [];
const check = (condition, message) => {
  if (!condition) throw new Error(message);
  checks.push(message);
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const agents = ['alice/codex', 'bob/worker'].map((address, index) => ({
  address, name: address.split('/')[1], person: address.split('/')[0], machine: 'test',
  agent: 'codex', repo: 'C:/fixture', branch: 'main', status: 'busy', since: 1,
  doing: `確認中 ${index}`, worker: false, tier: null,
}));
const summary = { id: 'fixture', path: 'fixture/rollout-test.jsonl', title: '確認用の会話', cwd: 'C:/fixture', updatedAt: 1 };
const detail = { ...summary, messages: Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', text: `日本語の会話 ${index}\n`.repeat(5) })) };
const dashboard = {
  generatedAt: 1,
  agents: { state: 'ok', data: { team: 'fixture', person: 'fixture', machine: 'test', machines: [], sessions: agents } },
  sessions: { state: 'ok', data: [summary] },
  serveLog: { state: 'ok', data: Array.from({ length: 80 }, (_, index) => `日本語ログ ${index}: alice/codex -> bob/worker`).join('\n') },
  inbox: { state: 'ok', data: '新しいメッセージはありません。' },
};
let poll;
let interval;
let sends = 0;
window.setInterval = (callback, milliseconds) => { poll = callback; interval = milliseconds; return 1; };
window.__TAURI_INTERNALS__ = {
  invoke: async (command) => {
    if (command === 'get_dashboard') return structuredClone({ ...dashboard, generatedAt: ++dashboard.generatedAt });
    if (command === 'get_session') return structuredClone({ ...detail, updatedAt: summary.updatedAt });
    sends++;
    throw new Error(`Unexpected command: ${command}`);
  },
};
const refresh = async () => { poll(); await tick(); };
const click = async (selector) => { document.querySelector(selector).click(); await tick(); };

try {
  await import('../src/main.ts');
  await tick();
  check(interval === 5000, '5秒ポーリングを維持');
  const input = document.querySelector('#message-input');
  input.value = '未送信の日本語 draft';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
  input.setSelectionRange(2, 5);
  const content = document.querySelector('#main-content');
  const sidebar = document.querySelector('#sidebar-list');
  let mutations = 0;
  const observer = new MutationObserver((records) => { mutations += records.length; });
  observer.observe(content, { childList: true, subtree: true, attributes: true, characterData: true });
  observer.observe(sidebar, { childList: true, subtree: true, attributes: true, characterData: true });
  await refresh();
  await refresh();
  check(mutations === 0, '同一データの連続ポーリングで本文と一覧のDOM変更なし');
  observer.disconnect();
  agents[0].doing = '作業状態が変化しました';
  const scroll = document.querySelector('#main-scroll');
  scroll.scrollTop = 90;
  const top = scroll.scrollTop;
  await refresh();
  check(document.querySelector('#message-input') === input, '変更時も送信欄のDOMを保持');
  check(document.activeElement === input && input.selectionStart === 2 && input.selectionEnd === 5, '入力フォーカスと選択位置を保持');
  check(input.value === '未送信の日本語 draft' && scroll.scrollTop === top, '入力途中の日本語とスクロールを保持');
  check(content.textContent.includes(agents[0].doing), '変更された作業状態を反映');
  const aliceSelector = '[data-select-key="alice/codex"]';
  const color = getComputedStyle(document.querySelector(`${aliceSelector} .agent-label`)).color;
  check(color === getComputedStyle(document.querySelector('.main-title')).color, '一覧名と詳細ヘッダーの色が一致');
  await click('[data-select-key="bob/worker"]');
  check(document.querySelector('#message-input').value === '', '別エージェントの下書きを分離');
  await click(aliceSelector);
  check(document.querySelector('#message-input').value === '未送信の日本語 draft', 'エージェントへ戻ると下書きを復元');
  await click('[data-panel="serve"]');
  const firstLine = document.querySelector('.terminal-line');
  const terminal = document.querySelector('.terminal-body');
  terminal.scrollTop = 150;
  const terminalTop = terminal.scrollTop;
  dashboard.serveLog.data += '\n新しい日本語ログ: alice/codex -> bob/worker';
  await refresh();
  check(document.querySelector('.terminal-line') === firstLine && terminal.scrollTop === terminalTop, 'ログ追記で既存行とログのスクロールを保持');
  check(getComputedStyle(document.querySelector('.terminal-line .agent-label')).color === color, 'Serveログのアドレス色が一覧と一致');
  await click('[data-panel="sessions"]');
  check(getComputedStyle(document.querySelector('.session-agent .agent-label')).color === color, '作業フォルダーが一致するセッションの色が一致');
  scroll.scrollTop = 130;
  const conversationTop = scroll.scrollTop;
  const firstMessage = document.querySelector('.message');
  summary.updatedAt++;
  detail.messages.push({ role: 'assistant', text: '追加された会話' });
  await refresh();
  check(document.querySelector('.message') === firstMessage && scroll.scrollTop === conversationTop, '会話更新で既存メッセージと閲覧位置を保持');
  check(content.textContent.includes('追加された会話'), '更新された会話を表示');
  const { agentHue } = await import('../src/agent-colors.ts');
  const { agentHue: freshHue } = await import('../src/agent-colors.ts?fresh');
  check(agentHue('alice/codex') === freshHue('alice/codex'), 'モジュール再ロード後も同じアドレスは同じ色相');
  check(sends === 0, '送信コマンドの呼び出しなし（IPCはローカルfixtureのみ）');
  output.textContent = `PASS: ${checks.length} checks`;
  output.style.background = '#245b36';
  output.title = checks.join('\n');
  window.verificationResult = { passed: true, checks };
} catch (error) {
  output.textContent = `FAIL: ${error.message}`;
  output.style.background = '#7e2626';
  window.verificationResult = { passed: false, checks, error: String(error) };
}
