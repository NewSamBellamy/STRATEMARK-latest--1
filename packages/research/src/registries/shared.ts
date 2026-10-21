/** Small pure helpers shared by the registry adapters. */

const TWO_LEVEL_SLD = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'ltd', 'plc']);

/** Host from a URL or bare host; lower-case, no www., no port/path. */
export function hostOf(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    return host.includes('.') ? host : null;
  } catch {
    return null;
  }
}

/** Registrable domain (handles co.uk-style suffixes heuristically). */
export function registrableDomain(input: string | null | undefined): string | null {
  const host = hostOf(input);
  if (!host) return null;
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const sld = parts[parts.length - 2]!;
  const tld = parts[parts.length - 1]!;
  if (tld.length === 2 && TWO_LEVEL_SLD.has(sld)) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

export function sameRegistrableDomain(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = registrableDomain(a);
  const db = registrableDomain(b);
  return !!da && !!db && da === db;
}

const LEGAL_SUFFIX = new Set([
  'as', 'asa', 'ans', 'da', 'sa', 'sas', 'sarl', 'sasu', 'eurl', 'snc', 'se', 'ab', 'oy', 'gmbh', 'ag', 'bv', 'nv',
  'ltd', 'limited', 'llc', 'inc', 'incorporated', 'corp', 'corporation', 'plc', 'co', 'company',
]);

/** Legal-suffix-insensitive, diacritic-insensitive name tokens. */
export function nameTokens(raw: string): string[] {
  const folded = raw
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .replace(/œ/g, 'oe')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return folded.split(' ').filter((t) => t && !LEGAL_SUFFIX.has(t));
}

export function normalizedName(raw: string): string {
  return nameTokens(raw).join(' ');
}

export function exactNameMatch(a: string, b: string): boolean {
  const na = normalizedName(a);
  return na.length >= 2 && na === normalizedName(b);
}

/** Token Jaccard similarity in [0,1]. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

export async function fetchJson(
  url: string,
  ctx: { fetchImpl: typeof fetch; signal?: AbortSignal },
): Promise<unknown> {
  const res = await ctx.fetchImpl(url, { signal: ctx.signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
