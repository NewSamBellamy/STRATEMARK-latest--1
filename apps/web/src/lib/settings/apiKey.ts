/**
 * Google AI Studio (Gemini) API key store.
 *
 * The key lives ONLY in the user's browser (localStorage) and is sent only to
 * Google's API. It is never logged or transmitted anywhere else. In the Electron
 * build persistence is exclusively through OS-backed safeStorage (main process).
 */
import { create } from 'zustand';
import { isReadOnlyResearch } from './runtime';

const STORAGE_KEY = 'mi.geminiApiKey';
const MODEL_KEY = 'mi.geminiModel';

/**
 * Strip characters that can't legally travel in an HTTP header.
 *
 * The key is sent as `x-goog-api-key`, and headers must be ISO-8859-1. Keys
 * copied out of a web page routinely carry invisible passengers — zero-width
 * spaces, non-breaking spaces, smart quotes, a trailing newline — and ANY of
 * them makes `fetch` throw before the request leaves the browser:
 *   "Failed to read the 'headers' property from 'RequestInit':
 *    String contains non ISO-8859-1 code point"
 * That surfaced as "your key doesn't work" on keys that were perfectly valid.
 */
export function sanitizeApiKey(raw: string): string {
  // Keep printable ASCII only, then trim.
  return raw.replace(/[^\x20-\x7E]/g, '').trim();
}

/** Google AI Studio keys are URL-safe alphanumerics. Used for a friendly warning only. */
export function looksLikeGeminiKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{30,}$/.test(key);
}

function readLocal(key: string): string {
  try {
    const val = localStorage.getItem(key);
    if (val) return val;
    // Fall back to mi.apiKey alias if set
    if (key === STORAGE_KEY) {
      return localStorage.getItem('mi.apiKey') ?? '';
    }
    return '';
  } catch {
    return '';
  }
}
function writeLocal(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* private mode / unavailable — key simply won't persist */
  }
}

interface ApiKeyState {
  apiKey: string;
  /** Optional grounded-model override (defaults handled by the client). */
  model: string;
  hasKey: boolean;
  storageError: string | null;
  setApiKey: (key: string) => Promise<void>;
  setModel: (model: string) => void;
  clear: () => Promise<void>;
}

const secure = !isReadOnlyResearch() && typeof window !== 'undefined' ? window.miSecure : undefined;
let hydration: Promise<void> = Promise.resolve();
function removePlaintextKeys(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('mi.apiKey');
}

export const useApiKey = create<ApiKeyState>((set) => ({
  apiKey: secure || isReadOnlyResearch() ? '' : readLocal(STORAGE_KEY),
  model: isReadOnlyResearch() ? '' : readLocal(MODEL_KEY),
  hasKey: !secure && !isReadOnlyResearch() && readLocal(STORAGE_KEY).length > 0,
  storageError: null,
  setApiKey: async (key) => {
    await hydration;
    const trimmed = sanitizeApiKey(key);
    if (secure) {
      await secure.setApiKey(trimmed);
      removePlaintextKeys();
    } else {
      writeLocal(STORAGE_KEY, trimmed);
      localStorage.removeItem('mi.apiKey');
    }
    set({ apiKey: secure ? '' : trimmed, hasKey: trimmed.length > 0, storageError: null });
  },
  setModel: (model) => {
    writeLocal(MODEL_KEY, model.trim());
    set({ model: model.trim() });
  },
  clear: async () => {
    await hydration;
    if (secure) await secure.setApiKey('');
    removePlaintextKeys();
    set({ apiKey: '', hasKey: false, storageError: null });
  },
}));

// In Electron, hydrate only capability state. Stored key bytes never cross into the renderer.
if (secure) {
  hydration = (async () => {
    let { hasKey } = await secure.getApiKeyStatus();
    // Migrate older plaintext caches only after encrypted persistence succeeds.
    const legacy = sanitizeApiKey(readLocal(STORAGE_KEY));
    if (!hasKey && legacy) {
      await secure.setApiKey(legacy);
      hasKey = true;
    }
    removePlaintextKeys();
    useApiKey.setState({ apiKey: '', hasKey });
  })().catch(() => {
    useApiKey.setState({
      storageError:
        'Could not open secure key storage. Save your key again after checking your system keyring.',
    });
  });
}

export const apiKeyReady = hydration;
