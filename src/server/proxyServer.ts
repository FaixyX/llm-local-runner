import * as http from 'http';
import * as vscode from 'vscode';
import { ApiKeyManager } from '../managers/apiKeyManager';

export class ProxyServer {
  private server: http.Server | null = null;
  private _onLog = new vscode.EventEmitter<string>();
  readonly onLog = this._onLog.event;

  constructor(
    private readonly proxyPort: number,
    private readonly ollamaPort: number,
    private readonly keyManager: ApiKeyManager
  ) {}

  get isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isRunning) { resolve(); return; }

      this.server = http.createServer((req, res) => {
        // ── CORS ──────────────────────────────────────────────────────────
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
          res.writeHead(204); res.end(); return;
        }

        // ── Health check (no auth required) ──────────────────────────────
        if (req.url === '/health' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', proxy: true }));
          return;
        }

        // ── API Key validation ────────────────────────────────────────────
        const authHeader = req.headers['authorization'] ?? '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

        if (!this.keyManager.validate(token)) {
          this._onLog.fire(`[401] ${req.method} ${req.url} — invalid API key`);
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid or missing API key. Set Authorization: Bearer <your-key>' }));
          return;
        }

        // ── Route translation  ────────────────────────────────────────────
        // Supports both OpenAI-style (/v1/*) and native Ollama (/api/*) paths
        const url = req.url ?? '/';
        const ollamaPath = this.translatePath(url);

        this._onLog.fire(`[proxy] ${req.method} ${url} → ${ollamaPath}`);

        // ── Forward to Ollama ─────────────────────────────────────────────
        const proxyOptions: http.RequestOptions = {
          hostname: 'localhost',
          port: this.ollamaPort,
          path: ollamaPath,
          method: req.method,
          headers: {
            ...req.headers,
            host: `localhost:${this.ollamaPort}`,
          },
        };

        const proxyReq = http.request(proxyOptions, (proxyRes) => {
          res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
          this._onLog.fire(`[error] Ollama unreachable: ${err.message}`);
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Ollama is not running. Start it from the LLM Runner panel.' }));
          }
        });

        req.pipe(proxyReq);
      });

      this.server.listen(this.proxyPort, '127.0.0.1', () => {
        this._onLog.fire(`[proxy] Listening on http://localhost:${this.proxyPort}`);
        resolve();
      });

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${this.proxyPort} is already in use. Change llmRunner.proxyPort in settings.`));
        } else {
          reject(err);
        }
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) { resolve(); return; }
      this.server.close(() => {
        this.server = null;
        this._onLog.fire('[proxy] Stopped.');
        resolve();
      });
    });
  }

  /**
   * Translate OpenAI-compatible paths to Ollama API paths.
   * Allows clients using the OpenAI SDK to work without any changes.
   *
   * /v1/chat/completions  → /api/chat
   * /v1/completions       → /api/generate
   * /v1/models            → /api/tags
   * /v1/embeddings        → /api/embeddings
   * /api/*                → /api/* (pass through)
   */
  private translatePath(url: string): string {
    const map: Record<string, string> = {
      '/v1/chat/completions': '/api/chat',
      '/v1/completions': '/api/generate',
      '/v1/models': '/api/tags',
      '/v1/embeddings': '/api/embeddings',
    };
    return map[url] ?? url;
  }

  dispose(): void {
    this.stop();
    this._onLog.dispose();
  }
}
