import * as vscode from 'vscode';

export interface PanelState {
  modelName: string;
  modelStatus: 'idle' | 'not_installed' | 'not_running' | 'pulling' | 'running' | 'error';
  pullProgress: number;
  proxyPort: number;
  ollamaPort: number;
  apiKey: string;
  proxyRunning: boolean;
  logs: string[];
  availableModels: string[];
}

/** Build the full webview HTML for the LLM Runner dashboard */
export function buildWebviewHtml(
  webview: vscode.Webview,
  state: PanelState
): string {
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';`;

  const statusColor: Record<string, string> = {
    idle: '#6b7280',
    not_installed: '#ef4444',
    not_running: '#f59e0b',
    pulling: '#3b82f6',
    running: '#22c55e',
    error: '#ef4444',
  };

  const statusLabel: Record<string, string> = {
    idle: 'Idle',
    not_installed: 'Ollama Not Installed',
    not_running: 'Ollama Not Running',
    pulling: `Pulling… ${state.pullProgress}%`,
    running: 'Running',
    error: 'Error',
  };

  const logLines = state.logs
    .slice(-60)
    .map((l) => `<div class="log-line">${escHtml(l)}</div>`)
    .join('');

  const modelOptions = [...new Set(['llama3', 'llama3:8b', 'llama3:70b', 'mistral', 'gemma3', ...state.availableModels])]
    .map((m) => `<option value="${m}" ${m === state.modelName ? 'selected' : ''}>${m}</option>`)
    .join('');

  const progressBar =
    state.modelStatus === 'pulling'
      ? `<div class="progress-track"><div class="progress-fill" style="width:${state.pullProgress}%"></div></div>`
      : '';

  const startDisabled = state.modelStatus === 'running' || state.modelStatus === 'pulling';
  const stopDisabled = state.modelStatus !== 'running';

  const exampleCode = `// OpenAI SDK — drop-in compatible
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:${state.proxyPort}/v1',
  apiKey: '${state.apiKey}',
});

const response = await client.chat.completions.create({
  model: '${state.modelName}',
  messages: [{ role: 'user', content: 'Hello!' }],
});

console.log(response.choices[0].message.content);`;

  const curlCode = `curl http://localhost:${state.proxyPort}/v1/chat/completions \\
  -H "Authorization: Bearer ${state.apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${state.modelName}",
    "messages": [{"role":"user","content":"Hello!"}]
  }'`;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<title>LLM Local Runner</title>
<style>
  :root {
    --bg: #0f1117;
    --surface: #1a1d27;
    --border: #2a2d3e;
    --accent: #7c6af7;
    --accent2: #4ade80;
    --text: #e2e8f0;
    --muted: #64748b;
    --danger: #ef4444;
    --warn: #f59e0b;
    --radius: 10px;
    --mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--vscode-font-family, system-ui, sans-serif);
    font-size: 13px;
    line-height: 1.5;
    padding: 0;
    height: 100vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* ── Header ─────────────────────────────────────────── */
  .header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 20px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .logo {
    width: 28px; height: 28px;
    background: linear-gradient(135deg, var(--accent), #a78bfa);
    border-radius: 7px;
    display: flex; align-items: center; justify-content: center;
    font-size: 15px;
  }
  .header-title { font-size: 14px; font-weight: 600; letter-spacing: -.3px; }
  .header-sub { font-size: 11px; color: var(--muted); margin-left: auto; }

  /* ── Main layout ─────────────────────────────────────── */
  .layout {
    display: flex;
    flex: 1;
    overflow: hidden;
  }
  .sidebar {
    width: 260px;
    flex-shrink: 0;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding: 16px;
    gap: 16px;
  }
  .main {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* ── Cards ───────────────────────────────────────────── */
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px;
  }
  .card-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .8px;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 12px;
  }

  /* ── Status badge ────────────────────────────────────── */
  .status-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  .dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .dot.pulse { animation: pulse 1.5s infinite; }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: .35; }
  }
  .status-text { font-size: 12px; font-weight: 500; }

  /* ── Progress bar ────────────────────────────────────── */
  .progress-track {
    height: 4px;
    background: var(--border);
    border-radius: 99px;
    overflow: hidden;
    margin-top: 8px;
  }
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), #a78bfa);
    border-radius: 99px;
    transition: width .3s ease;
  }

  /* ── Form elements ───────────────────────────────────── */
  select, input[type="number"] {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    padding: 6px 8px;
    font-size: 12px;
    outline: none;
    appearance: none;
    margin-bottom: 8px;
  }
  select:focus, input:focus { border-color: var(--accent); }
  label { font-size: 11px; color: var(--muted); display: block; margin-bottom: 3px; }

  /* ── Buttons ─────────────────────────────────────────── */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 7px 14px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    border: none;
    cursor: pointer;
    transition: opacity .15s, transform .1s;
    white-space: nowrap;
  }
  .btn:active { transform: scale(.97); }
  .btn:disabled { opacity: .4; cursor: not-allowed; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-primary:hover:not(:disabled) { opacity: .85; }
  .btn-success { background: #16a34a; color: #fff; }
  .btn-success:hover:not(:disabled) { opacity: .85; }
  .btn-danger  { background: #7f1d1d; color: #fca5a5; border: 1px solid #b91c1c; }
  .btn-danger:hover:not(:disabled) { background: #991b1b; }
  .btn-ghost {
    background: transparent;
    color: var(--muted);
    border: 1px solid var(--border);
  }
  .btn-ghost:hover { border-color: var(--accent); color: var(--text); }
  .btn-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }

  /* ── API Key section ─────────────────────────────────── */
  .key-box {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 10px;
    margin-bottom: 8px;
  }
  .key-text {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--accent2);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: all;
  }
  .copy-btn {
    padding: 3px 8px;
    font-size: 10px;
    font-weight: 600;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--muted);
    cursor: pointer;
    flex-shrink: 0;
    transition: all .15s;
  }
  .copy-btn:hover { border-color: var(--accent2); color: var(--accent2); }
  .copy-btn.copied { background: #14532d; color: var(--accent2); border-color: #16a34a; }

  /* ── Code block ──────────────────────────────────────── */
  .tabs { display: flex; gap: 2px; margin-bottom: -1px; }
  .tab {
    padding: 5px 12px;
    font-size: 11px;
    font-weight: 600;
    border-radius: 6px 6px 0 0;
    border: 1px solid transparent;
    cursor: pointer;
    color: var(--muted);
    background: transparent;
  }
  .tab.active {
    color: var(--text);
    background: var(--surface);
    border-color: var(--border);
    border-bottom-color: var(--surface);
  }
  .code-wrap {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 0 var(--radius) var(--radius) var(--radius);
    position: relative;
  }
  pre {
    font-family: var(--mono);
    font-size: 11.5px;
    line-height: 1.65;
    padding: 14px;
    overflow-x: auto;
    color: #c4b5fd;
    white-space: pre;
  }
  .code-copy {
    position: absolute;
    top: 8px; right: 8px;
  }

  /* ── Logs ────────────────────────────────────────────── */
  .log-box {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px;
    height: 140px;
    overflow-y: auto;
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--muted);
  }
  .log-line { padding: 1px 0; }
  .log-line:last-child { color: var(--text); }

  /* ── Info chips ──────────────────────────────────────── */
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
  .chip {
    padding: 3px 9px;
    border-radius: 99px;
    font-size: 10px;
    font-weight: 600;
    border: 1px solid var(--border);
    color: var(--muted);
  }
  .chip.green { border-color: #16a34a; color: #4ade80; background: #052e16; }
  .chip.blue  { border-color: #1d4ed8; color: #93c5fd; background: #0c1a4d; }

  /* ── Install tip ─────────────────────────────────────── */
  .tip {
    background: #1c1204;
    border: 1px solid #78350f;
    border-radius: 7px;
    padding: 10px 12px;
    font-size: 11.5px;
    color: #fcd34d;
    line-height: 1.6;
  }
  .tip a { color: #fbbf24; }

  /* ── Scrollbar ───────────────────────────────────────── */
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
</style>
</head>
<body>

<!-- Header -->
<div class="header">
  <div class="logo">🤖</div>
  <span class="header-title">LLM Local Runner</span>
  <span class="header-sub">Powered by Ollama</span>
</div>

<div class="layout">

  <!-- Sidebar -->
  <div class="sidebar">

    <!-- Model Status -->
    <div class="card">
      <div class="card-title">Model Status</div>
      <div class="status-row">
        <div class="dot ${state.modelStatus === 'pulling' || state.modelStatus === 'running' ? 'pulse' : ''}"
             style="background:${statusColor[state.modelStatus] ?? '#6b7280'}"></div>
        <span class="status-text">${statusLabel[state.modelStatus] ?? 'Unknown'}</span>
      </div>
      ${progressBar}
    </div>

    <!-- Model Selector -->
    <div class="card">
      <div class="card-title">Model</div>
      <label>Select Model</label>
      <select id="modelSelect" onchange="onModelChange(this.value)">
        ${modelOptions}
      </select>
      <div class="btn-row">
        <button class="btn btn-success" id="startBtn" ${startDisabled ? 'disabled' : ''}
                onclick="sendCmd('start')">▶ Start</button>
        <button class="btn btn-danger" id="stopBtn" ${stopDisabled ? 'disabled' : ''}
                onclick="sendCmd('stop')">■ Stop</button>
      </div>
    </div>

    <!-- Ports -->
    <div class="card">
      <div class="card-title">Ports</div>
      <label>Proxy Port (your app uses this)</label>
      <div class="key-box">
        <span class="key-text" style="color:var(--accent)">localhost:${state.proxyPort}</span>
        <span class="chip ${state.proxyRunning ? 'green' : ''}">${state.proxyRunning ? '● live' : '○ offline'}</span>
      </div>
      <label>Ollama Port (internal)</label>
      <div class="key-box">
        <span class="key-text" style="color:var(--muted)">localhost:${state.ollamaPort}</span>
      </div>
    </div>

    ${
      state.modelStatus === 'not_installed'
        ? `<div class="tip">
            ⚠️ <strong>Ollama not found.</strong><br>
            Install it from <a href="https://ollama.com">ollama.com</a>, then click Start again.
           </div>`
        : ''
    }

  </div>

  <!-- Main -->
  <div class="main">

    <!-- API Key -->
    <div class="card">
      <div class="card-title">Your Local API Key</div>
      <div class="key-box">
        <span class="key-text" id="apiKeyText">${state.apiKey}</span>
        <button class="copy-btn" id="copyKeyBtn" onclick="copyKey()">Copy</button>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <button class="btn btn-ghost" onclick="sendCmd('regenerateKey')" style="font-size:11px">
          ↻ Regenerate Key
        </button>
        <span style="font-size:10.5px;color:var(--muted)">Used as <code style="color:var(--accent)">Authorization: Bearer &lt;key&gt;</code></span>
      </div>
    </div>

    <!-- Usage examples -->
    <div class="card">
      <div class="card-title">Usage Examples</div>
      <div class="tabs">
        <button class="tab active" id="tab-node" onclick="switchTab('node')">Node / OpenAI SDK</button>
        <button class="tab" id="tab-curl" onclick="switchTab('curl')">cURL</button>
        <button class="tab" id="tab-python" onclick="switchTab('python')">Python</button>
      </div>
      <div class="code-wrap">
        <pre id="code-node">${escHtml(exampleCode)}</pre>
        <pre id="code-curl" style="display:none">${escHtml(curlCode)}</pre>
        <pre id="code-python" style="display:none">${escHtml(buildPythonExample(state))}</pre>
        <button class="copy-btn code-copy" id="codeCopyBtn" onclick="copyCode()">Copy</button>
      </div>
    </div>

    <!-- Logs -->
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <span class="card-title" style="margin-bottom:0">Proxy Logs</span>
        <button class="btn btn-ghost" style="padding:3px 8px;font-size:10px" onclick="sendCmd('clearLogs')">Clear</button>
      </div>
      <div class="log-box" id="logBox">${logLines || '<div class="log-line" style="color:#374151">No activity yet…</div>'}</div>
    </div>

  </div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  let activeTab = 'node';

  function sendCmd(cmd, payload) {
    vscode.postMessage({ command: cmd, payload });
  }

  function onModelChange(model) {
    sendCmd('setModel', model);
  }

  function copyKey() {
    const key = document.getElementById('apiKeyText').textContent;
    navigator.clipboard.writeText(key).then(() => {
      const btn = document.getElementById('copyKeyBtn');
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800);
    });
  }

  function switchTab(tab) {
    activeTab = tab;
    ['node','curl','python'].forEach(t => {
      document.getElementById('code-' + t).style.display = t === tab ? 'block' : 'none';
      document.getElementById('tab-' + t).classList.toggle('active', t === tab);
    });
  }

  function copyCode() {
    const code = document.getElementById('code-' + activeTab).textContent;
    navigator.clipboard.writeText(code).then(() => {
      const btn = document.getElementById('codeCopyBtn');
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800);
    });
  }

  // Scroll logs to bottom
  const logBox = document.getElementById('logBox');
  if (logBox) logBox.scrollTop = logBox.scrollHeight;

  // Handle state updates from extension
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.command === 'reload') {
      vscode.setState(msg.state);
      location.reload(); // full re-render with new state
    }
  });
</script>
</body>
</html>`;
}

function buildPythonExample(state: PanelState): string {
  return `# Python — httpx or openai package
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:${state.proxyPort}/v1",
    api_key="${state.apiKey}",
)

response = client.chat.completions.create(
    model="${state.modelName}",
    messages=[{"role": "user", "content": "Hello!"}],
)

print(response.choices[0].message.content)`;
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
