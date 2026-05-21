# 🤖 LLM Local Runner — VS Code / Cursor Extension

Run any LLM locally with a single click, get an OpenAI-compatible API key, and use it in any localhost project.

---

## Features

| Feature | Detail |
|---|---|
| **One-click model start** | Pulls & starts LLaMA 3 (or any Ollama model) automatically |
| **Auto API Key** | Generates a persistent `Bearer` token on first launch |
| **OpenAI-compatible proxy** | Drop your existing OpenAI code in — no changes needed |
| **Live dashboard** | Status, logs, copy-paste code snippets |
| **Multiple models** | llama3, mistral, gemma3, llama3:70b, and more |

---

## Prerequisites

Install **Ollama** (free, runs locally):

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows  →  download from https://ollama.com/download
```

---

## Quick Start

1. Install this extension in VS Code / Cursor
2. Open the dashboard: **Cmd+Shift+P → "LLM Runner: Open Dashboard"**
3. Select a model (default: `llama3`) and click **▶ Start**
4. The extension will:
   - Detect or start Ollama
   - Pull the model if not already local
   - Start the API proxy on `localhost:11435`
   - Show your API key

---

## Using the API Key

### Node.js (OpenAI SDK — zero changes)

```js
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:11435/v1',
  apiKey: 'llmr-your-key-here',  // from the dashboard
});

const res = await client.chat.completions.create({
  model: 'llama3',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

### Python

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:11435/v1",
    api_key="llmr-your-key-here",
)

res = client.chat.completions.create(
    model="llama3",
    messages=[{"role": "user", "content": "Hello!"}],
)
```

### cURL

```bash
curl http://localhost:11435/v1/chat/completions \
  -H "Authorization: Bearer llmr-your-key-here" \
  -H "Content-Type: application/json" \
  -d '{"model":"llama3","messages":[{"role":"user","content":"Hello!"}]}'
```

---

## Route Translation

The proxy maps OpenAI routes to Ollama automatically:

| Your request | Forwarded to |
|---|---|
| `POST /v1/chat/completions` | `POST /api/chat` |
| `POST /v1/completions` | `POST /api/generate` |
| `GET /v1/models` | `GET /api/tags` |
| `POST /v1/embeddings` | `POST /api/embeddings` |

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `llmRunner.proxyPort` | `11435` | Port your app connects to |
| `llmRunner.ollamaPort` | `11434` | Ollama's internal port |
| `llmRunner.defaultModel` | `llama3` | Model loaded on start |
| `llmRunner.autoStart` | `false` | Start model when VS Code opens |

---

## Supported Models

Any model available on [ollama.com/library](https://ollama.com/library):

```
llama3       llama3:8b    llama3:70b
mistral      gemma3       phi3
codellama    deepseek-r1  qwen2
```

---

## Build & Install Locally

```bash
npm install
npm run compile
npx vsce package        # produces llm-local-runner-0.1.0.vsix
```

Then in VS Code: **Extensions → ⋯ → Install from VSIX**

Press **F5** in this repo to launch an Extension Development Host (requires `npm run compile` or `npm run watch`).

---

## Project Structure

Standard VS Code extension layout:

```
ollama_extension/
├── .vscode/                 # Debug & build tasks for extension dev
│   ├── launch.json          # F5 → Run Extension
│   ├── tasks.json           # TypeScript compile / watch
│   └── extensions.json
├── src/
│   ├── extension.ts         # activate / deactivate, commands, webview host
│   ├── managers/
│   │   ├── apiKeyManager.ts # persistent Bearer token in globalState
│   │   └── ollamaManager.ts # Ollama install, pull, daemon lifecycle
│   ├── server/
│   │   └── proxyServer.ts   # OpenAI-compatible HTTP proxy
│   └── webview/
│       └── panel.ts         # dashboard HTML + PanelState
├── out/                     # compiled JS (gitignored)
├── package.json             # extension manifest & contributes.*
├── tsconfig.json
├── .vscodeignore            # files excluded from .vsix package
├── CHANGELOG.md
├── LICENSE                   # MIT — required for marketplace / vsce
├── package.json              # extension manifest (commands, settings, engine)
└── README.md
```

---

## Architecture

```
Your App
   │  Authorization: Bearer <key>
   ▼
localhost:11435  ←── Proxy Server (Node http)
   │  validates key, translates routes
   ▼
localhost:11434  ←── Ollama daemon
   │
   ▼
LLaMA 3 / Mistral / etc (running on your GPU/CPU)
```

---

Built by [Xirvo](https://xirvo.co) · [MIT License](LICENSE)
