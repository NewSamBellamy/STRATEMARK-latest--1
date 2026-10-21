/**
 * Google AI Studio (Gemini) API key store.
 *
 * The key lives ONLY in the user's browser (localStorage) and is sent only to
 * Google's API. It is never logged or transmitted anywhere else. In the Electron
 * build persistence is exclusively through OS-backed safeStorage (main process).
 */
import { create } from 'zustand';
import { hasHostedApi } from '@/lib/hostedApi';
import { clearGroundingSpent } from '@/lib/usage';

/** A build with the hosted Worker can research without a personal key (free beta). */
const HOSTED = typeof window !== 'undefined' && !window.miSecure && hasHostedApi();

const STORAGE_KEY = 'mi.geminiApiKey';
const MODEL_KEY = 'mi.geminiModel';
const JUDGE_MODEL_KEY = 'mi.geminiJudgeModel';
const QUOTA_KEY = 'mi.quotaPreset';

/** Outbound pacing presets (WS2): the free tier's measured 10/15 RPM ceiling
 * is the latency floor; a paid key can run the same pipeline several times
 * faster. The values land in the Gemini client's proactive rate limiter. */
export const QUOTA_PRESETS = {
  free: { groundedRpm: 10, structureRpm: 15, label: 'Free key (slower, about 10 searches a minute)' },
  paid: { groundedRpm: 60, structureRpm: 120, label: 'Paid key (faster, about 60 searches a minute)' },
} as const;

export type QuotaPreset = keyof typeof QUOTA_PRESETS;

export function readQuotaPreset(): QuotaPreset {
  try {
    return localStorage.getItem(QUOTA_KEY) === 'paid' ? 'paid' : 'free';
  } catch {
    return 'free';
  }
}

/**
 * The pacing a run actually uses. A hosted-beta visitor with no key of their own runs on the Worker's server key (a paid
 * key, bounded by the Worker's dollar caps), so they get the paid pacing; the "free key" default is for someone who pastes a
 * free key of their own, and it throttled every hosted deck to the free tier's 10 searches a minute for no reason.
 */
export function effectiveQuotaPreset(input: { hasUserKey: boolean; hosted: boolean; chosen: QuotaPreset }): QuotaPreset {
  return input.hosted && !input.hasUserKey ? 'paid' : input.chosen;
}

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
  /**
   * Optional judge/verification-model override (LLM as judge): metric
   * verification, batch verify and red-team run on this model instead of the
   * research model. Blank = same as the research model (today's behavior).
   */
  judgeModel: string;
  /** Outbound pacing preset — how fast the pipeline may spend the quota. */
  quotaPreset: QuotaPreset;
  /** Research is available: the user's own key, or the hosted free tier. */
  hasKey: boolean;
  /** No personal key; research runs on Stratemark's hosted key (capped per day). */
  hosted: boolean;
  storageError: string | null;
  setApiKey: (key: string) => Promise<void>;
  setModel: (model: string) => void;
  setJudgeModel: (model: string) => void;
  setQuotaPreset: (preset: QuotaPreset) => void;
  clear: () => Promise<void>;
}

const secure = typeof window !== 'undefined' ? window.miSecure : undefined;
let hydration: Promise<void> = Promise.resolve();
function removePlaintextKeys(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('mi.apiKey');
}

export const useApiKey = create<ApiKeyState>((set) => ({
  apiKey: secure ? '' : readLocal(STORAGE_KEY),
  model: readLocal(MODEL_KEY),
  judgeModel: readLocal(JUDGE_MODEL_KEY),
  quotaPreset: readQuotaPreset(),
  hasKey: (!secure && readLocal(STORAGE_KEY).length > 0) || HOSTED,
  hosted: HOSTED && !(!secure && readLocal(STORAGE_KEY).length > 0),
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
    // The old key's "search quota spent" notice says nothing about the new one.
    clearGroundingSpent();
    set({ apiKey: trimmed, hasKey: trimmed.length > 0 || HOSTED, hosted: !trimmed && HOSTED, storageError: null });
  },
  setModel: (model) => {
    writeLocal(MODEL_KEY, model.trim());
    set({ model: model.trim() });
  },
  setJudgeModel: (model) => {
    writeLocal(JUDGE_MODEL_KEY, model.trim());
    set({ judgeModel: model.trim() });
  },
  setQuotaPreset: (preset) => {
    writeLocal(QUOTA_KEY, preset);
    set({ quotaPreset: preset });
  },
  clear: async () => {
    await hydration;
    if (secure) await secure.setApiKey('');
    removePlaintextKeys();
    set({ apiKey: '', hasKey: HOSTED, hosted: HOSTED, storageError: null });
  },
}));

// In Electron, hydrate the key from the OS keychain on boot (authoritative over
// the localStorage cache).
if (secure) {
  hydration = (async () => {
    let key = await secure.getApiKey();
    // Migrate older plaintext caches only after encrypted persistence succeeds.
    const legacy = sanitizeApiKey(readLocal(STORAGE_KEY));
    if (!key && legacy) {
      await secure.setApiKey(legacy);
      key = legacy;
    }
    removePlaintextKeys();
    useApiKey.setState({ apiKey: key, hasKey: !!key });
  })().catch(() => {
    useApiKey.setState({ storageError: 'Could not open secure key storage. Save your key again after checking your system keyring.' });
  });
}

export const apiKeyReady = hydration;
