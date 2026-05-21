import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export type InstallProgress = (message: string) => void;

/** Resolve ollama binary when not yet on PATH (common right after install). */
export async function resolveOllamaPath(): Promise<string | null> {
  if (await commandExists('ollama')) return 'ollama';

  const candidates: string[] = [];
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    candidates.push(path.join(local, 'Programs', 'Ollama', 'ollama.exe'));
  } else {
    candidates.push(
      '/usr/local/bin/ollama',
      '/opt/homebrew/bin/ollama',
      path.join(os.homedir(), '.ollama', 'bin', 'ollama'),
    );
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    const check = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
    await execAsync(check, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function runCommand(
  command: string,
  args: string[],
  onLog: InstallProgress
): Promise<number> {
  return new Promise((resolve) => {
    onLog(`$ ${command} ${args.join(' ')}`);
    const proc = spawn(command, args, {
      shell: process.platform === 'win32',
      env: { ...process.env },
    });

    proc.stdout?.on('data', (d: Buffer) => {
      d.toString().split('\n').filter(Boolean).forEach((l) => onLog(l.trim()));
    });
    proc.stderr?.on('data', (d: Buffer) => {
      d.toString().split('\n').filter(Boolean).forEach((l) => onLog(l.trim()));
    });
    proc.on('close', (code) => resolve(code ?? 1));
    proc.on('error', () => resolve(1));
  });
}

async function waitForOllama(onLog: InstallProgress, maxMs = 600_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await resolveOllamaPath()) {
      onLog('✓ Ollama is ready.');
      return true;
    }
    onLog('Waiting for Ollama to finish installing…');
    await sleep(3000);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Install Ollama automatically (first-time setup).
 * Progress is streamed via onLog — no VS Code modals.
 */
export async function installOllama(onLog: InstallProgress): Promise<boolean> {
  if (await resolveOllamaPath()) {
    onLog('Ollama is already installed.');
    return true;
  }

  onLog('First-time setup: installing Ollama (this may take a few minutes)…');

  const platform = process.platform;

  if (platform === 'darwin') {
    if (await commandExists('brew')) {
      onLog('Installing via Homebrew…');
      const code = await runCommand('brew', ['install', 'ollama'], onLog);
      if (code === 0 && (await waitForOllama(onLog, 120_000))) return true;
    }
    onLog('Running Ollama install script…');
    const code = await runCommand('sh', ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'], onLog);
    if (code === 0 && (await waitForOllama(onLog))) return true;
  } else if (platform === 'linux') {
    onLog('Running Ollama install script…');
    const code = await runCommand('sh', ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'], onLog);
    if (code === 0 && (await waitForOllama(onLog))) return true;
  } else if (platform === 'win32') {
    if (await commandExists('winget')) {
      onLog('Installing via winget…');
      const code = await runCommand('winget', [
        'install', '-e', '--id', 'Ollama.Ollama',
        '--accept-package-agreements', '--accept-source-agreements',
      ], onLog);
      if (code === 0 && (await waitForOllama(onLog, 300_000))) return true;
    }
    onLog('Opening Ollama download page — complete the installer, then click Start again.');
    await openDownloadPage();
    return false;
  } else {
    onLog(`Unsupported platform: ${platform}. Install Ollama from https://ollama.com`);
    return false;
  }

  onLog('Install did not finish in time. Click Start to retry.');
  return false;
}

async function openDownloadPage(): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download'));
}
