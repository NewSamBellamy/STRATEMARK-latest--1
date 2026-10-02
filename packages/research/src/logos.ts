/**
 * Logo resolution — done ONCE at research time, not per render.
 *
 * Three audit findings converge on this module (docs/AUDIT-2026-07-29.md):
 *  · 2.2 — probing logo sources per card at render time cost 66 external
 *    requests to open a 24-card deck, with staggered pop-in and layout churn.
 *  · 3.1 — Wikidata → Wikimedia Commons serves true **vector SVG** logos for
 *    real companies (verified: Anthropic, Palantir), which removes the
 *    blur-vs-postage-stamp tradeoff entirely.
 *  · 3.3 — Commons rate-limits rapid sequential requests (observed HTTP 429),
 *    so resolution has to be paced and cached, which is impossible to do well
 *    from inside a render loop.
 *
 * So: resolve during the research pass, store the winning URL on the company,
 * and let the UI simply render it. Everything here is free and keyless — it
 * spends no Gemini quota.
 */
import { createRateLimiter, sleep } from './util';

/** Where a logo came from, for provenance and debugging. */
export type LogoSource = 'curated' | 'wikidata' | 'favicon' | 'none';

export interface ResolvedLogo {
  url: string | null;
  source: LogoSource;
}

const WD_API = 'https://www.wikidata.org/w/api.php';
const COMMONS_FILEPATH = 'https://commons.wikimedia.org/wiki/Special:FilePath';

/**
 * Carefully curated official-site fallbacks for names that commonly arrive as
 * aliases or parenthetical research labels. Unknown names still use their
 * researched website and the normal Wikidata path; never guess a domain from
 * arbitrary company text.
 */
const COMPANY_DOMAIN_ALIASES: Array<{
  domain: string;
  aliases: string[];
  wikidataName: string;
  logoUrl?: string;
}> = [
  { domain: 'openai.com', aliases: ['openai', 'openai inc'], wikidataName: 'OpenAI' },
  { domain: 'anthropic.com', aliases: ['anthropic', 'anthropic pbc'], wikidataName: 'Anthropic' },
  {
    domain: 'deepmind.google',
    aliases: ['deepmind', 'google deepmind'],
    wikidataName: 'Google DeepMind',
  },
  {
    domain: 'meta.com',
    aliases: ['meta', 'meta platforms', 'meta platforms inc', 'meta ai'],
    wikidataName: 'Meta Platforms',
    // Verified Meta mark from the P8972 Wikidata record / Commons source.
    logoUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Meta_Platforms_Inc._logo_(cropped).svg',
  },
  { domain: 'x.ai', aliases: ['xai'], wikidataName: 'xAI' },
  { domain: 'mistral.ai', aliases: ['mistral', 'mistral ai'], wikidataName: 'Mistral AI' },
  { domain: 'cohere.com', aliases: ['cohere'], wikidataName: 'Cohere' },
  { domain: 'deepseek.com', aliases: ['deepseek', 'deepseek ai'], wikidataName: 'DeepSeek' },
  { domain: 'moonshot.ai', aliases: ['moonshot', 'moonshot ai'], wikidataName: 'Moonshot AI' },
  {
    domain: 'ssi.inc',
    aliases: ['safe superintelligence', 'safe superintelligence inc'],
    wikidataName: 'Safe Superintelligence Inc.',
  },
  { domain: 'minimax.io', aliases: ['minimax', 'minimax group', 'minimax group inc'], wikidataName: 'MiniMax Group' },
  { domain: 'z.ai', aliases: ['z ai', 'zhipu ai'], wikidataName: 'Zhipu AI' },
];

function normalizeCompanyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/** Resolve a known company alias to its official website domain, if curated. */
export function knownCompanyDomain(name: string): string | null {
  const normalized = normalizeCompanyName(name);
  const match = COMPANY_DOMAIN_ALIASES.find(({ aliases }) =>
    aliases.some((alias) => normalized === alias || normalized.startsWith(`${alias} `)),
  );
  return match?.domain ?? null;
}

/** A reviewed brand asset for a known company, otherwise null. */
export function knownCompanyLogoUrl(name: string): string | null {
  const normalized = normalizeCompanyName(name);
  const match = COMPANY_DOMAIN_ALIASES.find(({ aliases }) =>
    aliases.some((alias) => normalized === alias || normalized.startsWith(`${alias} `)),
  );
  return match?.logoUrl ?? null;
}

/** Prefer the legal/primary company name over parenthetical product aliases. */
function wikidataSearchName(name: string): string {
  const normalized = normalizeCompanyName(name);
  const alias = COMPANY_DOMAIN_ALIASES.find(({ aliases }) =>
    aliases.some((value) => normalized === value || normalized.startsWith(`${value} `)),
  );
  if (alias) return alias.wikidataName;
  const primaryName = name.split('(')[0]?.trim() ?? name;
  return primaryName.replace(/[\s,]+(?:inc\.?|llc|ltd\.?|pbc|corp\.?|corporation)$/i, '').trim() || name;
}

/** Wikimedia asks for polite clients; pace ourselves well under their limits. */
const wikiLimiter = createRateLimiter(30);

/** Process-lifetime cache: a market re-run shouldn't re-ask for known logos. */
const cache = new Map<string, ResolvedLogo>();

type FetchLike = typeof fetch;

async function wdJson(url: string, doFetch: FetchLike, signal?: AbortSignal): Promise<unknown | null> {
  await wikiLimiter.acquire(signal);
  try {
    const res = await doFetch(url, { signal, headers: { accept: 'application/json' } });
    if (res.status === 429) {
      // Back off once, then give up — a logo is never worth stalling a deck.
      await sleep(1500, signal);
      const retry = await doFetch(url, { signal, headers: { accept: 'application/json' } });
      return retry.ok ? await retry.json() : null;
    }
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * Find a company's logo on Wikidata (property P154 → a file on Commons).
 * `origin=*` is required for these APIs to be readable cross-origin from the browser.
 */
async function fromWikidata(
  name: string,
  doFetch: FetchLike,
  signal?: AbortSignal,
): Promise<string | null> {
  const searchName = wikidataSearchName(name);
  const search = (await wdJson(
    `${WD_API}?action=wbsearchentities&search=${encodeURIComponent(searchName)}&language=en&format=json&type=item&limit=5&origin=*`,
    doFetch,
    signal,
  )) as { search?: { id?: string; label?: string }[] } | null;
  const wanted = normalizeCompanyName(searchName);
  const entity = search?.search?.find((item) => normalizeCompanyName(item.label ?? '') === wanted);
  const qid = entity?.id;
  if (!qid) return null;

  // P154 is the canonical logo field. Some entities (including Meta) instead
  // publish only P8972, so fall back to an explicitly-small logo or icon before
  // considering P2910. Keep each lookup lazy to avoid extra requests for the
  // much more common P154 case.
  let files: string[] = [];
  for (const property of ['P154', 'P8972', 'P2910']) {
    const claims = (await wdJson(
      `${WD_API}?action=wbgetclaims&entity=${encodeURIComponent(qid)}&property=${property}&format=json&origin=*`,
      doFetch,
      signal,
    )) as { claims?: { mainsnak?: { datavalue?: { value?: unknown } } }[] } | null;
    files = (claims?.claims ?? [])
      .map((claim) => claim.mainsnak?.datavalue?.value)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    if (files.length) break;
  }
  if (files.length === 0) return null;

  // Prefer vector art — it's sharp at any size, which is the whole point.
  const file = files.find((f) => /\.svg$/i.test(f)) ?? files[0]!;
  const filePath = `${COMMONS_FILEPATH}/${encodeURIComponent(file.replace(/ /g, '_'))}`;

  // Special:FilePath is a 302 to upload.wikimedia.org. Resolve it now so every
  // future image load skips the redirect, and store the stable CDN URL.
  // Best-effort: the redirector works fine as a fallback.
  try {
    await wikiLimiter.acquire(signal);
    const res = await doFetch(filePath, { signal, redirect: 'follow' });
    if (res.ok && res.url && /upload\.wikimedia\.org/.test(res.url)) return res.url;
  } catch {
    /* keep the redirector */
  }
  return filePath;
}

/**
 * Google's favicon service at a usable size. Deliberately WITHOUT
 * `fallback_opts`, so a domain with no icon 404s honestly instead of returning
 * a generic globe that would poison both the card and colour extraction.
 */
export function faviconUrl(domain: string | null, size = 256): string | null {
  if (!domain) return null;
  return `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&url=https://${domain}&size=${size}`;
}

/**
 * Resolve the best available logo for a company.
 * Order: Wikidata/Commons (vector where possible) → favicon service → nothing
 * (the UI then draws its designed lettermark plate, which is an honest ending).
 */
export async function resolveLogo(
  args: { name: string; domain: string | null },
  opts: { fetchImpl?: FetchLike; signal?: AbortSignal; force?: boolean } = {},
): Promise<ResolvedLogo> {
  const domain = args.domain ?? knownCompanyDomain(args.name);
  const key = `${args.name.toLowerCase()}|${domain ?? ''}`;
  const hit = opts.force ? undefined : cache.get(key);
  if (hit) return hit;

  const curated = knownCompanyLogoUrl(args.name);
  if (curated) {
    const resolved = { url: curated, source: 'curated' as const };
    cache.set(key, resolved);
    return resolved;
  }

  const doFetch = opts.fetchImpl ?? fetch;
  let resolved: ResolvedLogo = { url: null, source: 'none' };

  const wd = await fromWikidata(args.name, doFetch, opts.signal).catch(() => null);
  if (wd) {
    resolved = { url: wd, source: 'wikidata' };
  } else {
    const fav = faviconUrl(domain);
    if (fav) resolved = { url: fav, source: 'favicon' };
  }

  cache.set(key, resolved);
  return resolved;
}
