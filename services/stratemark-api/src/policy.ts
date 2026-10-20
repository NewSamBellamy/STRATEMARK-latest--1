/**
 * Pure request policy for the hosted API — no Worker globals, so it is unit
 * tested in Node. Every rule here exists to keep a server-held key from
 * becoming an open, unmetered proxy.
 */

/**
 * Gemini text model ids the hosted key may call. Image/video/audio models are
 * refused: the hosted app uses real images, and media output is priced far
 * above what the budget meter assumes.
 */
export function allowedModel(model: string): boolean {
  return /^gemini-[a-z0-9.-]{1,80}$/.test(model) && !/image|imagen|veo|tts|audio|live|embedding/.test(model);
}

/**
 * Browser origins allowed to call the API. `ALLOWED_ORIGINS` is a comma list;
 * an entry may be a full origin or a `*.example.com` host wildcard. Local dev
 * origins are allowed only when `ALLOW_LOCALHOST` is "true".
 *
 * Origin is a browser courtesy, not authentication — a script can forge it.
 * The daily caps below are what actually bound spend.
 */
export function allowedOrigin(origin: string | null, allowList: string, allowLocalhost: boolean): boolean {
  if (!origin) return false;
  let url: URL;
  try { url = new URL(origin); } catch { return false; }
  if (allowLocalhost && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return true;
  if (url.protocol !== 'https:') return false;
  return allowList.split(',').map((s) => s.trim()).filter(Boolean).some((entry) => {
    const wildcard = entry.replace(/^https:[/][/]/, '');
    if (wildcard.startsWith('*.')) {
      const base = wildcard.slice(2).toLowerCase();
      return url.hostname.toLowerCase().endsWith(`.${base}`);
    }
    try { return new URL(entry).origin === url.origin; } catch { return false; }
  });
}

/** A URL the page/asset readers may fetch: public https only, no credentials, no odd ports. */
export function safePublicUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || /^\[|^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  if (/(?:^|\.)(?:localhost|local|internal|test|invalid|home|lan|corp)$/.test(host)) return null;
  url.hash = '';
  return url;
}

/** True for IPv4 addresses that are not on the public internet. */
export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || !parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return true;
  const [a, b, c] = parts as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) ||
    (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

// ---- Dollar budget ---------------------------------------------------------

/**
 * Conservative Gemini prices (USD per 1M tokens), the HIGHEST current list
 * price in each family (ai.google.dev/gemini-api/docs/pricing, checked
 * 2026-10-10, including the 2027 Flash increase). Free allowances are ignored.
 * The meter may stop early; it must never stop late.
 */
export const PRICE_PER_M = {
  lite: { input: 0.30, output: 2.50 },
  flash: { input: 1.50, output: 7.50 },
  pro: { input: 4.00, output: 18.00 },
} as const;
/** Search grounding: $35 per 1,000 grounded prompts (2.5) or $14 per 1,000 queries (3.x) — take the higher. */
export const GROUNDED_PROMPT_USD = 0.035;
export const SEARCH_QUERY_USD = 0.014;

export function priceFamily(model: string): keyof typeof PRICE_PER_M {
  if (/lite/.test(model)) return 'lite';
  if (/flash/.test(model)) return 'flash';
  return 'pro'; // unknown models are charged at the most expensive rate
}

export interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  toolUsePromptTokenCount?: number;
}

/** Cost of one finished call, in micro-dollars (integer, so the ledger never drifts). */
export function callCostMicros(model: string, usage: GeminiUsage | undefined, grounded: boolean, searchQueries: number): number {
  const p = PRICE_PER_M[priceFamily(model)];
  const input = (usage?.promptTokenCount ?? 0) + (usage?.toolUsePromptTokenCount ?? 0);
  const output = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
  const tokens = input * p.input + output * p.output; // USD per 1M tokens x tokens = micro-dollars
  const search = grounded ? Math.max(GROUNDED_PROMPT_USD, SEARCH_QUERY_USD * Math.max(1, searchQueries)) * 1_000_000 : 0;
  return Math.ceil(tokens + search);
}

/**
 * Held before a call so concurrent calls can't jointly overshoot: the worst
 * plausible cost of one request (a long grounded prompt with a long answer).
 * Input is held at one token per character (no tokenizer does worse on text; a request can only be text, see
 * gemini-request.ts) and the answer at the most the forwarded request allows (answer and thinking together).
 */
export function reserveMicros(model: string, grounded: boolean, bodyChars: number, outputTokens = 16_000): number {
  const p = PRICE_PER_M[priceFamily(model)];
  const inputTokens = bodyChars + 20_000; // + grounding context Google adds
  // A grounded call can issue many searches; twelve is held (a real call is billed what it did, when it settles).
  const search = grounded ? Math.max(GROUNDED_PROMPT_USD, SEARCH_QUERY_USD * 12) * 1_000_000 : 0;
  return Math.ceil(inputTokens * p.input + outputTokens * p.output + search);
}

/** Largest budget a deployment may configure, in dollars: past it a value is a typo (a stray zero, or "1e308"), not a budget. */
export const MAX_BUDGET_USD = 10_000;

export interface BudgetSetting {
  /** The budget in dollars: what was configured, the default when nothing was, or 0 when what was configured is not usable. */
  usd: number;
  /** Why the configured value is not usable (never the value itself), or null. */
  problem: string | null;
}

const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * A budget from configuration, in dollars. Unset or empty is the default, and zero is the kill switch (every hosted call is
 * refused). Anything else that is set must be a decimal number up to MAX_BUDGET_USD and at least a micro-dollar. A value
 * that is not is a misconfiguration and fails CLOSED: the budget is 0 and `problem` says why. A budget is a spending
 * ceiling, so a typo must never open it. It used to fall back to the default ("-1" and "abc" quietly meant $100) and
 * "1e308" became Infinity once priced in micro-dollars, which is no ceiling at all (red team R2-W6).
 */
export function readBudgetUsd(raw: string | undefined, fallback: number): BudgetSetting {
  const text = (raw ?? '').trim();
  if (!text) return { usd: fallback, problem: null };
  const n = DECIMAL.test(text) ? Number(text) : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || n > MAX_BUDGET_USD) return { usd: 0, problem: `is not a number from 0 to ${MAX_BUDGET_USD} dollars` };
  if (n > 0 && Math.round(n * 1_000_000) < 1) return { usd: 0, problem: 'is smaller than a millionth of a dollar' };
  return { usd: n, problem: null };
}

export function parseBudgetUsd(raw: string | undefined, fallback: number): number {
  return readBudgetUsd(raw, fallback).usd;
}

/**
 * Most visitors one day's ledger will track: past it, a new visitor is refused rather than the ledger growing without bound.
 * A slot belongs to a visitor who has spent or holds something. One that spent nothing (Google rejected the call, the call
 * never reached it) takes none, so a flood of addresses whose requests cost nothing cannot fill the ledger and lock every
 * genuine visitor out for the day (red team R2-W3).
 */
export const MAX_LEDGER_VISITORS = 5_000;

export interface LedgerDay {
  day: string;
  spentMicros: number;
  heldMicros: number;
  visitors: Record<string, number>; // micro-dollars spent + held per visitor
}

/** One finished day, kept so growth is visible when deciding to raise the budget. */
export interface DaySummary { day: string; spentUsd: number; visitors: number }

/** Roll a finished ledger day into the history (newest first, bounded). */
export function rollHistory(history: readonly DaySummary[], finished: LedgerDay, keep = 60): DaySummary[] {
  if (!finished.day) return [...history];
  const summary: DaySummary = {
    day: finished.day,
    spentUsd: Math.round(finished.spentMicros / 10_000) / 100,
    visitors: Object.keys(finished.visitors).length,
  };
  return [summary, ...history.filter((h) => h.day !== finished.day)].slice(0, keep);
}

export type ReserveResult = { ok: true; ledger: LedgerDay } | { ok: false; reason: 'global' | 'visitor'; ledger: LedgerDay };

/**
 * What a visitor has spent and holds today. Only an entry of the visitor's own counts: "constructor", "toString" and
 * "__proto__" are on every plain object through Object.prototype, so reading them straight off the ledger returned a
 * function (and `in` said the visitor was known), and the per-visitor cap never applied to a visitor of that name.
 */
function spentBy(visitors: Record<string, number>, ip: string): number {
  return Object.prototype.hasOwnProperty.call(visitors, ip) ? visitors[ip]! : 0;
}

/**
 * A copy of the ledger's visitors with this one's entry set, or removed when it is nothing (no spend, no hold). Built with
 * fromEntries, which defines own properties, so "__proto__" is an entry like any other.
 */
function withVisitor(visitors: Record<string, number>, ip: string, value: number): Record<string, number> {
  const others = Object.entries(visitors).filter(([key]) => key !== ip);
  return Object.fromEntries(value > 0 ? [...others, [ip, value]] : others);
}

/**
 * Pure ledger step: may this call proceed under the global and per-visitor daily budgets? A request's day is read before it
 * is sent, so one can arrive after midnight carrying the day that ended. It is accounted to the day in progress (the
 * result's ledger says which); it used to REPLACE the newer ledger with an empty older one, and a spent $4 became $0
 * (red team R2-W4).
 */
export function tryReserve(ledger: LedgerDay, day: string, ip: string, amount: number, budgetMicros: number, visitorBudgetMicros: number): ReserveResult {
  const today = ledger.day > day ? ledger.day : day;
  const current: LedgerDay = ledger.day === today ? ledger : { day: today, spentMicros: 0, heldMicros: 0, visitors: {} };
  if (current.spentMicros + current.heldMicros + amount > budgetMicros) return { ok: false, reason: 'global', ledger: current };
  let visitors = current.visitors;
  const mine = spentBy(visitors, ip);
  if (!Object.prototype.hasOwnProperty.call(visitors, ip) && Object.keys(visitors).length >= MAX_LEDGER_VISITORS) {
    // Before a new visitor is refused, take back the slots of visitors who spent nothing (a ledger written before they were
    // dropped can still hold them). Visitors who spent or hold something keep their slot and their cap.
    visitors = Object.fromEntries(Object.entries(visitors).filter(([, value]) => value > 0));
    if (Object.keys(visitors).length >= MAX_LEDGER_VISITORS) return { ok: false, reason: 'global', ledger: current };
  }
  if (mine + amount > visitorBudgetMicros) return { ok: false, reason: 'visitor', ledger: current };
  return {
    ok: true,
    ledger: { ...current, heldMicros: current.heldMicros + amount, visitors: withVisitor(visitors, ip, mine + amount) },
  };
}

/** Pure ledger step: swap a hold for the call's actual cost (0 if Google didn't bill it). */
export function settle(ledger: LedgerDay, day: string, ip: string, held: number, actual: number): LedgerDay {
  if (ledger.day !== day) {
    // The call straddled UTC midnight. Its hold was on the day that ended, so there is nothing to release; its real cost is
    // charged to the day that has begun, added to that day's ledger. (It used to REPLACE the ledger with one holding only
    // this call, wiping the day's spend and visitors: a call held open across midnight bought a second budget.)
    if (ledger.day > day) {
      return { ...ledger, spentMicros: ledger.spentMicros + actual, visitors: withVisitor(ledger.visitors, ip, spentBy(ledger.visitors, ip) + actual) };
    }
    return { day, spentMicros: actual, heldMicros: 0, visitors: withVisitor({}, ip, actual) };
  }
  const mine = Math.max(0, spentBy(ledger.visitors, ip) - held + actual);
  return {
    ...ledger,
    spentMicros: ledger.spentMicros + actual,
    heldMicros: Math.max(0, ledger.heldMicros - held),
    visitors: withVisitor(ledger.visitors, ip, mine),
  };
}

