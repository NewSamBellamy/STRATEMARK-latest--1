/**
 * A page's own publication/update date, read from the raw HTML before it is
 * stripped. It is an UPPER BOUND on how old a figure on the page can be, and
 * nothing more: callers must never write it into an `asOf`.
 *
 * Linear scans only (indexOf and character loops, no backtracking regexes) over
 * the first 512 KB.
 */
const SCAN_LIMIT = 512 * 1024;
const MAX_TAG = 4000;
const MAX_JSONLD = 200_000;
const DAY_MS = 86_400_000;
const META_NAMES = new Set(['article:modified_time', 'article:published_time', 'og:updated_time', 'pubdate', 'dc.date', 'date']);

function isSpace(code: number): boolean { return code === 32 || code === 9 || code === 10 || code === 13 || code === 12; }

/** YYYY-MM-DD from an ISO-like string; null unless it is a real calendar day. */
function isoDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (s.length < 10) return null;
  const digit = (i: number) => { const c = s.charCodeAt(i); return c >= 48 && c <= 57; };
  for (const i of [0, 1, 2, 3, 5, 6, 8, 9]) if (!digit(i)) return null;
  if (s[4] !== '-' || s[7] !== '-') return null;
  if (s.length > 10 && s[10] !== 'T' && s[10] !== ' ') return null;
  const y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return s.slice(0, 10);
}

/** Attributes of one tag (the text after the tag name), lower-cased names. */
function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  const n = tag.length;
  while (i < n) {
    while (i < n && (isSpace(tag.charCodeAt(i)) || tag[i] === '/')) i++;
    const start = i;
    while (i < n && !isSpace(tag.charCodeAt(i)) && tag[i] !== '=' && tag[i] !== '/') i++;
    const name = tag.slice(start, i).toLowerCase();
    while (i < n && isSpace(tag.charCodeAt(i))) i++;
    let value = '';
    if (tag[i] === '=') {
      i++;
      while (i < n && isSpace(tag.charCodeAt(i))) i++;
      const quote = tag[i];
      if (quote === '"' || quote === "'") {
        const end = tag.indexOf(quote, i + 1);
        const stop = end === -1 ? n : end;
        value = tag.slice(i + 1, stop);
        i = stop + 1;
      } else {
        const from = i;
        while (i < n && !isSpace(tag.charCodeAt(i))) i++;
        value = tag.slice(from, i);
      }
    }
    if (name && !out.has(name)) out.set(name, value);
  }
  return out;
}

function jsonLdDates(node: unknown, out: string[], depth = 0, budget = { n: 2000 }): void {
  if (depth > 8 || budget.n-- <= 0 || !node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const item of node) jsonLdDates(item, out, depth + 1, budget); return; }
  const rec = node as Record<string, unknown>;
  for (const key of ['datePublished', 'dateModified']) {
    const day = isoDay(rec[key]);
    if (day) out.push(day);
  }
  for (const value of Object.values(rec)) if (value && typeof value === 'object') jsonLdDates(value, out, depth + 1, budget);
}

function urlDay(url: string): string | null {
  let path: string;
  try { path = new URL(url).pathname; } catch { return null; }
  const parts = path.split('/');
  const num = (s: string | undefined, len: number) => (s && s.length === len && [...s].every(c => c >= '0' && c <= '9') ? Number(s) : null);
  for (let i = 1; i + 1 < parts.length; i++) {
    const y = num(parts[i], 4), m = num(parts[i + 1], 2);
    if (y === null || m === null || m < 1 || m > 12) continue;
    const d = num(parts[i + 2], 2);
    // A bare /YYYY/MM/ gives only the month: take its last day (an upper bound).
    const day = d !== null && d >= 1 ? d : new Date(Date.UTC(y, m, 0)).getUTCDate();
    const found = isoDay(`${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    if (found) return found;
  }
  return null;
}

export function pagePublishedAt(html: string, url: string, retrievedAt: string): string | null {
  const retrieved = Date.parse(retrievedAt);
  if (!Number.isFinite(retrieved)) return null;
  const latest = new Date(retrieved + DAY_MS).toISOString().slice(0, 10);
  const plausible = (day: string | null): day is string => day !== null && day >= '1995-01-01' && day <= latest;
  const later = (days: (string | null)[]): string | null => days.filter(plausible).sort().pop() ?? null;

  const text = html.length > SCAN_LIMIT ? html.slice(0, SCAN_LIMIT) : html;
  const lower = text.toLowerCase();
  const structured: string[] = [];
  const articleTimes: string[] = [];
  let articleDepth = 0;
  let from = 0;
  let nextGt = -2;
  while (from < text.length) {
    const lt = lower.indexOf('<', from);
    if (lt === -1) break;
    if (lower.startsWith('<!--', lt)) {
      const end = lower.indexOf('-->', lt + 4);
      from = end === -1 ? text.length : end + 3;
      continue;
    }
    // Cache the next '>' so many '<' before one distant '>' stay linear.
    if (nextGt < lt) nextGt = lower.indexOf('>', lt + 1);
    if (nextGt === -1) break;
    const gt = nextGt;
    if (gt - lt > MAX_TAG) { from = lt + 1; continue; }
    from = gt + 1;
    const closing = lower[lt + 1] === '/';
    let nameEnd = lt + (closing ? 2 : 1);
    while (nameEnd < gt && !isSpace(lower.charCodeAt(nameEnd)) && lower[nameEnd] !== '/') nameEnd++;
    const name = lower.slice(lt + (closing ? 2 : 1), nameEnd);
    if (name === 'article') { articleDepth = closing ? Math.max(0, articleDepth - 1) : articleDepth + 1; continue; }
    if (closing) continue;
    if (name === 'script' || name === 'style') {
      const end = lower.indexOf(`</${name}`, from);
      const stop = end === -1 ? text.length : end;
      if (name === 'script' && lower.slice(lt, gt).includes('ld+json') && stop - from <= MAX_JSONLD) {
        try { jsonLdDates(JSON.parse(text.slice(from, stop)), structured); } catch { /* malformed block: skip */ }
      }
      from = stop;
      continue;
    }
    if (name === 'meta') {
      const attrs = attributes(text.slice(nameEnd, gt));
      const key = (attrs.get('property') ?? attrs.get('name') ?? attrs.get('itemprop') ?? '').toLowerCase();
      if (META_NAMES.has(key)) { const day = isoDay(attrs.get('content')); if (day) structured.push(day); }
    } else if (name === 'time' && articleDepth > 0) {
      const day = isoDay(attributes(text.slice(nameEnd, gt)).get('datetime'));
      if (day) articleTimes.push(day);
    }
  }
  return later(structured) ?? later(articleTimes) ?? (() => { const day = urlDay(url); return plausible(day) ? day : null; })();
}
