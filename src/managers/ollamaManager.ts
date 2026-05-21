import * as http from 'http';
import * as vscode from 'vscode';
import { exec, spawn, ChildProcess } from 'child_process';

export type ModelStatus = 'not_installed' | 'not_running' | 'pulling' | 'running' | 'error';

export interface ModelInfo {
  name: string;
  size?: string;
  status: ModelStatus;
  pullProgress?: number; // 0-100
}

export class OllamaManager {
  private ollamaProcess: ChildProcess | null = null;
  private _onStatusChange = new vscode.EventEmitter<ModelInfo>();
  readonly onStatusChange = this._onStatusChange.event;

  constructor(private readonly ollamaPort: number) {}

  get baseUrl(): string {
    return `http://localhost:${this.ollamaPort}`;
  }

  /** Check if Ollama daemon is reachable */
  async isOllamaRunning(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`${this.baseUrl}/api/tags`, (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      });
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
  }

  /** Check if Ollama CLI is installed */
  async isOllamaInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      exec('ollama --version', (err) => resolve(!err));
    });
  }

  /** List locally available models */
  async listLocalModels(): Promise<string[]> {
    return new Promise((resolve) => {
      const req = http.get(`${this.baseUrl}/api/tags`, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const names = (parsed.models || []).map((m: { name: string }) => m.name);
            resolve(names);
          } catch {
            resolve([]);
          }
        });
      });
      req.on('error', () => resolve([]));
    });
  }

  /** Check if a specific model exists locally */
  async isModelAvailable(modelName: string): Promise<boolean> {
    const models = await this.listLocalModels();
    return models.some((m) => m.startsWith(modelName));
  }

  /** Try to start Ollama daemon (if it's installed but not running) */
  async startOllamaDaemon(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('ollama', ['serve'], {
        detached: true,
        stdio: 'ignore',
      });
      this.ollamaProcess = proc;
      proc.unref();

      // Give it 3 seconds to come up
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        if (await this.isOllamaRunning()) {
          clearInterval(interval);
          resolve(true);
        } else if (attempts >= 6) {
          clearInterval(interval);
          resolve(false);
        }
      }, 500);

      proc.on('error', () => { clearInterval(interval); resolve(false); });
    });
  }

  /**
   * Pull a model via the Ollama API with streaming progress.
   * Emits status events with pullProgress 0–100.
   */
  async pullModel(modelName: string): Promise<boolean> {
    this._onStatusChange.fire({ name: modelName, status: 'pulling', pullProgress: 0 });

    return new Promise((resolve) => {
      const body = JSON.stringify({ name: modelName });
      const options = {
        hostname: 'localhost',
        port: this.ollamaPort,
        path: '/api/pull',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = http.request(options, (res) => {
        let buffer = '';
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          // Ollama streams newline-delimited JSON
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const obj = JSON.parse(line);
              if (obj.total && obj.completed) {
                const pct = Math.round((obj.completed / obj.total) * 100);
                this._onStatusChange.fire({ name: modelName, status: 'pulling', pullProgress: pct });
              }
              if (obj.status === 'success') {
                this._onStatusChange.fire({ name: modelName, status: 'running', pullProgress: 100 });
              }
            } catch { /* ignore parse errors */ }
          }
        });

        res.on('end', async () => {
          const ok = await this.isModelAvailable(modelName);
          this._onStatusChange.fire({ name: modelName, status: ok ? 'running' : 'error' });
          resolve(ok);
        });
      });

      req.on('error', () => {
        this._onStatusChange.fire({ name: modelName, status: 'error' });
        resolve(false);
      });

      req.write(body);
      req.end();
    });
  }

  /** Full setup flow: ensure Ollama is running + model is available */
  async ensureModelReady(modelName: string): Promise<{ ok: boolean; message: string }> {
    const installed = await this.isOllamaInstalled();
    if (!installed) {
      return {
        ok: false,
        message: 'Ollama is not installed. Visit https://ollama.com to install it, then try again.',
      };
    }

    let running = await this.isOllamaRunning();
    if (!running) {
      const started = await this.startOllamaDaemon();
      if (!started) {
        return { ok: false, message: 'Could not start Ollama. Try running `ollama serve` in a terminal.' };
      }
      running = true;
    }

    const available = await this.isModelAvailable(modelName);
    if (!available) {
      const pulled = await this.pullModel(modelName);
      if (!pulled) {
        return { ok: false, message: `Failed to pull model "${modelName}". Check your internet connection.` };
      }
    } else {
      this._onStatusChange.fire({ name: modelName, status: 'running' });
    }

    return { ok: true, message: `${modelName} is ready.` };
  }

  dispose(): void {
    this._onStatusChange.dispose();
  }
}
