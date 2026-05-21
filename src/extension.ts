import * as vscode from 'vscode';
import { ApiKeyManager } from './managers/apiKeyManager';
import { OllamaManager } from './managers/ollamaManager';
import { ProxyServer } from './server/proxyServer';
import { buildWebviewHtml, PanelState } from './webview/panel';

// ─── Module-level singletons ────────────────────────────────────────────────
let panel: vscode.WebviewPanel | undefined;
let keyManager: ApiKeyManager;
let ollamaManager: OllamaManager;
let proxyServer: ProxyServer;

const SETUP_COMPLETE_KEY = 'llmRunner.setupComplete';

// Mutable dashboard state
let state: PanelState = {
  modelName: 'llama3',
  modelStatus: 'idle',
  pullProgress: 0,
  proxyPort: 11435,
  ollamaPort: 11434,
  apiKey: '',
  proxyRunning: false,
  logs: [],
  availableModels: [],
  setupComplete: false,
  firstRunHint: true,
};

let extensionContext: vscode.ExtensionContext;

// ─── Activate ───────────────────────────────────────────────────────────────
export async function activate(context: vscode.ExtensionContext) {
  extensionContext = context;
  state.setupComplete = context.globalState.get<boolean>(SETUP_COMPLETE_KEY, false);
  state.firstRunHint = !state.setupComplete;

  // Read config
  const cfg = vscode.workspace.getConfiguration('llmRunner');
  state.proxyPort = cfg.get<number>('proxyPort', 11435);
  state.ollamaPort = cfg.get<number>('ollamaPort', 11434);
  state.modelName = cfg.get<string>('defaultModel', 'llama3');

  // Init managers
  keyManager = new ApiKeyManager(context);
  ollamaManager = new OllamaManager(state.ollamaPort);
  proxyServer = new ProxyServer(state.proxyPort, state.ollamaPort, keyManager);

  // API key (create on first run)
  state.apiKey = keyManager.getOrCreate();

  // Proxy log forwarding
  proxyServer.onLog((msg) => {
    pushLog(msg);
    refreshPanel();
  });

  // Model status forwarding
  ollamaManager.onStatusChange((info) => {
    state.modelStatus = info.status as PanelState['modelStatus'];
    state.pullProgress = info.pullProgress ?? 0;
    refreshPanel();
  });

  // ── Commands ─────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('llmRunner.openPanel', () => openDashboard(context)),

    vscode.commands.registerCommand('llmRunner.startModel', () => startModel()),

    vscode.commands.registerCommand('llmRunner.stopModel', async () => {
      await proxyServer.stop();
      state.proxyRunning = false;
      state.modelStatus = 'idle';
      pushLog('Proxy stopped.');
      refreshPanel();
    }),

    vscode.commands.registerCommand('llmRunner.regenerateKey', () => {
      state.apiKey = keyManager.regenerate();
      pushLog('API key regenerated — update your projects if needed.');
      refreshPanel();
    }),

    vscode.commands.registerCommand('llmRunner.copyApiKey', async () => {
      await vscode.env.clipboard.writeText(state.apiKey);
      pushLog('API key copied to clipboard.');
      refreshPanel();
    })
  );

  // Auto-start if configured
  if (cfg.get<boolean>('autoStart', false)) {
    await startModel();
  }

  // Always open dashboard on activate
  openDashboard(context);
}

// ─── Deactivate ─────────────────────────────────────────────────────────────
export async function deactivate() {
  await proxyServer.stop();
  ollamaManager.dispose();
}

// ─── Dashboard panel ─────────────────────────────────────────────────────────
function openDashboard(context: vscode.ExtensionContext) {
  if (panel) {
    panel.reveal(vscode.ViewColumn.One);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'llmRunner',
    'LLM Runner',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  panel.onDidDispose(() => { panel = undefined; });

  // Messages from webview
  panel.webview.onDidReceiveMessage(async (msg) => {
    switch (msg.command) {
      case 'start':
        await startModel();
        break;
      case 'stop':
        await vscode.commands.executeCommand('llmRunner.stopModel');
        break;
      case 'regenerateKey':
        await vscode.commands.executeCommand('llmRunner.regenerateKey');
        break;
      case 'setModel':
        state.modelName = msg.payload;
        refreshPanel();
        break;
      case 'clearLogs':
        state.logs = [];
        refreshPanel();
        break;
    }
  });

  // Load available models in background
  ollamaManager.isOllamaRunning().then(async (running) => {
    if (running) {
      state.availableModels = await ollamaManager.listLocalModels();
      refreshPanel();
    }
  });

  refreshPanel();
}

function refreshPanel() {
  if (!panel) return;
  state.proxyRunning = proxyServer.isRunning;
  panel.webview.html = buildWebviewHtml(panel.webview, state);
}

// ─── Start model flow (one click — progress stays in the panel, no modals) ───
async function startModel() {
  const busy = ['running', 'pulling', 'installing'] as const;
  if (busy.includes(state.modelStatus as typeof busy[number])) return;

  pushLog(`Starting ${state.modelName}…`);
  state.modelStatus = state.setupComplete ? 'idle' : 'installing';
  refreshPanel();

  const { ok, message } = await ollamaManager.ensureModelReady(state.modelName, pushLog);

  if (!ok) {
    state.modelStatus = 'error';
    pushLog(`✗ ${message}`);
    refreshPanel();
    return;
  }

  try {
    await proxyServer.start();
    state.proxyRunning = true;
    state.modelStatus = 'running';
    state.setupComplete = true;
    state.firstRunHint = false;
    await extensionContext.globalState.update(SETUP_COMPLETE_KEY, true);

    pushLog(`✓ Ready! Proxy → http://localhost:${state.proxyPort}`);
    pushLog(`✓ API key: ${state.apiKey.slice(0, 12)}…`);
    pushLog('Next time: click Start and you are done.');

    state.availableModels = await ollamaManager.listLocalModels();
    refreshPanel();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    state.modelStatus = 'error';
    pushLog(`✗ Proxy failed: ${msg}`);
    refreshPanel();
  }
}

function pushLog(line: string) {
  const ts = new Date().toLocaleTimeString();
  state.logs.push(`[${ts}] ${line}`);
  if (state.logs.length > 200) state.logs.shift();
}
