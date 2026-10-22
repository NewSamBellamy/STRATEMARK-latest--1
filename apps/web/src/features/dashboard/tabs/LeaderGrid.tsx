/**
 * Verified headshots for people on the dashboard: the lookup, its caches and
 * the small `WikiAvatar` used across the tabs. (The team page's leadership row
 * itself now lives in OrgBoard as its first section.)
 *
 * Headshot honesty: photos come from Wikipedia's public REST API and are used
 * ONLY when the article summary actually mentions the company — a mismatched
 * photo of a same-named stranger is worse than initials. No match → clean
 * initials tile. Never fabricated, never guessed.
 */
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { fetchWikidataHeadshot } from '@/lib/media/wikidataHeadshot';
import { loadPersisted, makeLimiter, savePersisted } from '@/lib/media/headshotCache';
import { LruCache, fetchWithTimeout } from '@/lib/media/lookupCache';

export interface Headshot {
  thumb: string;
  sourceUrl: string;
}

const headshotCache = new LruCache<string, Headshot | null>(500);
const inflightHeadshots = new Map<string, Promise<Headshot | null>>();
const limit = makeLimiter(3);

/**
 * The fetch for one headshot resolution: every request is time-bounded, and a
 * request that fails (network, timeout, 429/5xx) marks the resolution
 * incomplete, so its miss is never remembered as "this person has no photo".
 */
function trackedFetch(): { f: typeof fetch; failed: () => boolean } {
  let failed = false;
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const res = await fetchWithTimeout(input, init);
      if (res.status === 429 || res.status >= 500) failed = true;
      return res;
    } catch (err) {
      failed = true;
      throw err;
    }
  }) as typeof fetch;
  return { f, failed: () => failed };
}

interface WikiSummary {
  thumbnail?: { source?: string };
  extract?: string;
  description?: string;
  content_urls?: { desktop?: { page?: string } };
}

/**
 * Article summaries by title, for the session. A 404 is a fact about the title
 * ("no such article") and is remembered, so the same missing name isn't asked
 * for again by every avatar and retry; a network/429/5xx failure is not, and
 * is retried next time.
 */
const summaryCache = new LruCache<string, WikiSummary | null>(500);

/** Fetch a Wikipedia article summary by exact title; null on any failure. */
async function wikiSummary(f: typeof fetch, title: string): Promise<WikiSummary | null> {
  if (summaryCache.has(title)) return summaryCache.get(title) ?? null;
  try {
    const res = await f(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers: { accept: 'application/json' } },
    );
    if (res.status === 404) summaryCache.set(title, null);
    if (!res.ok) return null;
    const summary = (await res.json()) as WikiSummary;
    summaryCache.set(title, summary);
    return summary;
  } catch {
    return null;
  }
}

/**
 * The verification gate: a photo is used ONLY when the article demonstrably
 * matches BOTH the person (their surname appears in the title) and the company
 * (the summary mentions it). A same-named stranger's photo is worse than
 * initials — never guessed, never "close enough".
 */
function verifiedShot(
  summary: WikiSummary | null,
  articleTitle: string,
  personName: string,
  companyName: string,
): Headshot | null {
  if (!summary?.thumbnail?.source) return null;
  const surname = personName.trim().split(/\s+/).pop()?.toLowerCase() ?? '';
  if (surname && !articleTitle.toLowerCase().includes(surname)) return null;
  const text = `${summary.extract ?? ''} ${summary.description ?? ''}`.toLowerCase();
  if (!text.includes(companyName.toLowerCase())) return null;
  return {
    thumb: summary.thumbnail.source,
    sourceUrl: summary.content_urls?.desktop?.page ?? '',
  };
}

/**
 * Honest headshot with RETRY: (1) direct article lookup by name; (2) when that
 * misses — wrong title, disambiguation page, no company mention — a Wikipedia
 * search for "{name} {company}" finds the real article title and the summary
 * is re-fetched and re-verified. Both attempts pass the same verification
 * gate; only a confirmed match ever renders. Results (including misses) cache,
 * except a miss from a lookup that failed part-way — that one is retried.
 */
function fetchWikiHeadshot(personName: string, companyName: string): Promise<Headshot | null> {
  const key = `${personName}::${companyName}`;
  if (headshotCache.has(key)) return Promise.resolve(headshotCache.get(key) ?? null);
  const persisted = loadPersisted<Headshot>(key);
  if (persisted.hit) {
    headshotCache.set(key, persisted.value);
    return Promise.resolve(persisted.value);
  }
  // One person usually appears several times on a tab (leadership grid, org
  // chart, board list) and every avatar mounts at once — share the lookup.
  const pending = inflightHeadshots.get(key);
  if (pending) return pending;
  const lookup = limit(async () => {
    const { f, failed } = trackedFetch();
    const shot = await resolveHeadshot(f, personName, companyName);
    if (shot || !failed()) {
      headshotCache.set(key, shot);
      savePersisted(key, shot);
    }
    return shot;
  }).finally(() => inflightHeadshots.delete(key));
  inflightHeadshots.set(key, lookup);
  return lookup;
}

async function resolveHeadshot(f: typeof fetch, personName: string, companyName: string): Promise<Headshot | null> {

  // Attempt 1: the article usually lives at the person's exact name.
  const direct = verifiedShot(
    await wikiSummary(f, personName),
    personName,
    personName,
    companyName,
  );
  if (direct) return direct;

  // Attempt 2: search Wikipedia for the person IN their company context —
  // finds "Name (executive)"-style titles and articles the direct miss hides.
  try {
    const res = await f(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=3&format=json&origin=*&srsearch=${encodeURIComponent(
        `${personName} ${companyName}`,
      )}`,
      { headers: { accept: 'application/json' } },
    );
    if (res.ok) {
      const data = (await res.json()) as {
        query?: { search?: Array<{ title?: string }> };
      };
      for (const hit of data.query?.search ?? []) {
        const title = hit.title?.trim();
        if (!title) continue;
        const shot = verifiedShot(await wikiSummary(f, title), title, personName, companyName);
        if (shot) return shot;
      }
    }
  } catch {
    // fall through to the honest miss
  }

  // Attempt 3: Wikidata — a human tied to the company by employer/position
  // claims, with a Commons portrait (P18). Namesakes elsewhere are rejected.
  const wd = await fetchWikidataHeadshot(personName, companyName, [], f);
  return wd ? { thumb: wd.thumb, sourceUrl: wd.sourceUrl } : null;
}

/** Shared hook: resolve the verified headshot for a person at a company. */
export function useWikiHeadshot(name: string, companyName: string): Headshot | null {
  const key = `${name}::${companyName}`;
  // The face is remembered WITH whose face it is: an avatar reused for another
  // person (a list re-filtered, re-sorted or re-keyed) must never keep showing
  // the previous person's photo while the new lookup runs.
  const [shot, setShot] = useState<{ key: string; shot: Headshot | null } | null>(null);
  useEffect(() => {
    let live = true;
    void fetchWikiHeadshot(name, companyName).then((s) => {
      if (live) setShot({ key: `${name}::${companyName}`, shot: s });
    });
    return () => {
      live = false;
    };
  }, [name, companyName]);
  return shot?.key === key ? shot.shot : null;
}

export function photoCredit(shot: Headshot): string {
  return /wikipedia.org/.test(shot.sourceUrl) ? 'Photo: Wikipedia' : 'Photo: Wikimedia Commons';
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

/**
 * Reusable honest-headshot avatar: Wikipedia photo when the article verifiably
 * matches the person AND company, initials otherwise. Shared by the leadership
 * grid and the board/investor treatment.
 */
export function WikiAvatar({
  name,
  companyName,
  size = 'md',
  ringClass = 'ring-slate-300/60',
}: {
  name: string;
  companyName: string;
  size?: 'sm' | 'md';
  ringClass?: string;
}) {
  const shot = useWikiHeadshot(name, companyName);
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden rounded-full bg-primary/10 ring-2 ring-offset-2 ring-offset-surface',
        size === 'sm' ? 'h-10 w-10' : 'h-14 w-14',
        ringClass,
      )}
    >
      {shot ? (
        <img
          src={shot.thumb}
          alt={name}
          title={photoCredit(shot)}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <span
          className={cn(
            'font-display font-semibold text-primary-ink',
            size === 'sm' ? 'text-sm' : 'text-base',
          )}
        >
          {initialsOf(name)}
        </span>
      )}
    </span>
  );
}
