import * as vscode from 'vscode';
import * as crypto from 'crypto';

const KEY_STORAGE_ID = 'llmRunner.apiKey';

export class ApiKeyManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Returns the stored key, or generates a new one if none exists */
  getOrCreate(): string {
    const existing = this.context.globalState.get<string>(KEY_STORAGE_ID);
    if (existing) return existing;
    return this.regenerate();
  }

  /** Force-creates a brand new key */
  regenerate(): string {
    const key = `llmr-${crypto.randomBytes(20).toString('hex')}`;
    this.context.globalState.update(KEY_STORAGE_ID, key);
    return key;
  }

  /** Returns the current key without creating one */
  get(): string | undefined {
    return this.context.globalState.get<string>(KEY_STORAGE_ID);
  }

  /** Validates an incoming Bearer token */
  validate(token: string): boolean {
    const key = this.get();
    return !!key && token === key;
  }

  /** Wipes the stored key */
  clear(): void {
    this.context.globalState.update(KEY_STORAGE_ID, undefined);
  }
}
