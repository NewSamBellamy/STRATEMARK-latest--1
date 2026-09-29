/**
 * Usage meter + cost transparency + the spending cap.
 *
 * Trust is the product: the user's key does real billable work (grounded
 * search and structuring), so the app shows exactly what it
 * has been asked to spend — locally counted, nothing leaves the browser —
 * and lets the user set a hard monthly cap. Over the cap the app drops into
 * LOW POWER MODE: autonomous spending (hunts, warm loops,
 * scheduled briefings) pauses; deliberate manual actions still work so the
 * user is never locked out of their own research.
 *
 * Costs are ESTIMATES from published list prices (the UI says so): grounded
 * calls carry the Google-Search-grounding fee and structuring is cheap flash
 * tokens. Historical image calls remain in the local meter for an honest
 * total. Actual billing truth lives in the user's
 * Google AI Studio console.
 */
const KEY = 'mi.usage.v1';
const MONTH_KEY = 'mi.usage.month.v1';
const CONTROLS_KEY = 'mi.costctl.v1';

/** Documented free-tier daily request cap. */
export const DAILY_REQUEST_CAP = 1500;
/** Measured cost of one ~10-company deck, after batching the tier review. */
export const REQUESTS_PER_DECK = 27;

/** Estimated $ per call, from published list prices (2026-08). */
export const EST_COST_USD = {
  ground: 0.04, // flash tokens + Google Search grounding fee
  structure: 0.002, // flash-lite structuring tokens
  image: 0.02, // one Nano Banana 2 Lite (gemini-3.1-flash-lite-image) generation
} as const;

export type CallKind = keyof typeof EST_COST_USD;

export interface UsageDay {
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
  grounded: number;
  structure: number;
  image: number;
  decks: number;
}

export interface UsageMonth {
  /** Local calendar month, YYYY-MM. */
  month: string;
  grounded: number;
  structure: number;
  image: number;
}

const today = (): string => new Date().toISOString().slice(0, 10);
const thisMonth = (): string => new Date().toISOString().slice(0, 7);

function readDay(): UsageDay {
  const fresh: UsageDay = { day: today(), grounded: 0, structure: 0, image: 0, decks: 0 };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const parsed = JSON.parse(raw) as UsageDay;
    // A new day resets the window, matching how the quota actually behaves.
    return parsed.day === fresh.day ? { ...fresh, ...parsed } : fresh;
  } catch {
    return fresh;
  }
}

function readMonth(): UsageMonth {
  const fresh: UsageMonth = { month: thisMonth(), grounded: 0, structure: 0, image: 0 };
  try {
    const raw = localStorage.getItem(MONTH_KEY);
    if (!raw) return fresh;
    const parsed = JSON.parse(raw) as UsageMonth;
    return parsed.month === fresh.month ? { ...fresh, ...parsed } : fresh;
  } catch {
    return fresh;
  }
}

function write(k: string, v: unknown): void {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode — meter is session-only, never a hard failure */
  }
}

/** Record one outbound model request. */
export function recordCall(kind: 'ground' | 'structure' | 'image'): void {
  const d = readDay();
  const m = readMonth();
  if (kind === 'ground') {
    d.grounded += 1;
    m.grounded += 1;
  } else if (kind === 'image') {
    d.image += 1;
    m.image += 1;
  } else {
    d.structure += 1;
    m.structure += 1;
  }
  write(KEY, d);
  write(MONTH_KEY, m);
  notify();
}

/** Record a completed deck build (for a human-scale "decks today" number). */
export function recordDeck(): void {
  const d = readDay();
  d.decks += 1;
  write(KEY, d);
  notify();
}

export interface UsageSummary extends UsageDay {
  total: number;
  remaining: number;
  /** Whole decks the remaining budget can still cover. */
  decksLeft: number;
  percentUsed: number;
}

export function getUsage(): UsageSummary {
  const u = readDay();
  const total = u.grounded + u.structure;
  const remaining = Math.max(0, DAILY_REQUEST_CAP - total);
  return {
    ...u,
    total,
    remaining,
    decksLeft: Math.floor(remaining / REQUESTS_PER_DECK),
    percentUsed: Math.min(100, Math.round((total / DAILY_REQUEST_CAP) * 100)),
  };
}

export interface SpendSummary extends UsageMonth {
  /** Estimated month-to-date spend in USD, by published list prices. */
  estUsd: number;
  estByKind: { ground: number; structure: number; image: number };
}

export function getSpend(): SpendSummary {
  const m = readMonth();
  const estByKind = {
    ground: m.grounded * EST_COST_USD.ground,
    structure: m.structure * EST_COST_USD.structure,
    image: m.image * EST_COST_USD.image,
  };
  return {
    ...m,
    estByKind,
    estUsd: estByKind.ground + estByKind.structure + estByKind.image,
  };
}

// ---------------------------------------------------------------------------
// Cost controls — the user's hands on the throttle.
// ---------------------------------------------------------------------------

export interface CostControls {
  /** Monthly estimated-spend cap in USD; null = no cap. */
  monthlyCapUsd: number | null;
}

const DEFAULT_CONTROLS: CostControls = { monthlyCapUsd: null };

export function getCostControls(): CostControls {
  try {
    const raw = localStorage.getItem(CONTROLS_KEY);
    if (!raw) return DEFAULT_CONTROLS;
    return { ...DEFAULT_CONTROLS, ...(JSON.parse(raw) as Partial<CostControls>) };
  } catch {
    return DEFAULT_CONTROLS;
  }
}

export function setCostControls(patch: Partial<CostControls>): void {
  write(CONTROLS_KEY, { ...getCostControls(), ...patch });
  notify();
}

/**
 * LOW POWER MODE: true once estimated month-to-date spend meets the cap.
 * Autonomous spenders (hunts, warm loops, scheduled briefings) check
 * this before every call; deliberate manual actions stay available.
 */
export function isLowPower(): boolean {
  const cap = getCostControls().monthlyCapUsd;
  if (cap == null || cap <= 0) return false;
  return getSpend().estUsd >= cap;
}

// --- tiny subscription so the UI can live-update without a store dependency ---
const listeners = new Set<() => void>();
function notify(): void {
  for (const l of listeners) l();
}
export function subscribeUsage(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
