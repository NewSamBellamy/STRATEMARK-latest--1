/**
 * LeaderGrid — the human face of the org chart.
 *
 * A row of framed portrait cards above the reporting-lines graph: headshot,
 * name, role. Hover reveals the person's sourced background; click opens the
 * full profile with grounded dig-deeper.
 *
 * Headshot honesty: photos come from Wikipedia's public REST API and are used
 * ONLY when the article summary actually mentions the company — a mismatched
 * photo of a same-named stranger is worse than initials. No match → clean
 * initials tile. Never fabricated, never guessed.
 */
import { useEffect, useState } from 'react';
import type { OrgNode } from '@mi/contracts';
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

const GROUP_RING: Record<OrgNode['group'], string> = {
  exec: 'ring-indigo-400/60',
  ai: 'ring-cyan-400/60',
  product: 'ring-emerald-400/60',
  design: 'ring-pink-400/60',
  other: 'ring-slate-300/60',
};

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

function LeaderCard({
  person,
  companyName,
  onOpen,
}: {
  person: OrgNode;
  companyName: string;
  onOpen: () => void;
}) {
  const shot = useWikiHeadshot(person.name, companyName);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group/leader relative flex w-[104px] shrink-0 flex-col items-center gap-1.5 rounded-xl border border-transparent p-2 text-center transition-colors hover:border-border hover:bg-surface-2"
    >
      <span
        className={cn(
          'grid h-14 w-14 place-items-center overflow-hidden rounded-full bg-primary/10 ring-2 ring-offset-2 ring-offset-surface',
          GROUP_RING[person.group],
        )}
      >
        {shot ? (
          <img
            src={shot.thumb}
            alt={person.name}
            title={photoCredit(shot)}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="font-display text-base font-semibold text-primary-ink">
            {initialsOf(person.name)}
          </span>
        )}
      </span>
      <span className="w-full truncate text-[12px] font-semibold leading-tight text-content">
        {person.name}
      </span>
      <span className="w-full truncate text-[10.5px] leading-tight text-muted">{person.role}</span>

      {/* Hover profile — the sourced background, in place. */}
      {/* Left-aligned (not centered): a centered popover on a card near the
          screen's left edge clipped half of every line off-screen. */}
      <span className="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden w-60 max-w-[70vw] rounded-lg border border-border bg-surface p-3 text-left shadow-card group-hover/leader:block">
        <span className="block text-[12px] font-semibold text-content">{person.name}</span>
        <span className="block text-[11px] text-muted">{person.role}</span>
        <span className="mt-1.5 block text-[11px] leading-relaxed text-content/85">
          {person.bio?.trim() ||
            'No sourced background yet — click to open the profile and research them.'}
        </span>
        <span className="mt-1.5 block text-[10px] font-medium text-primary-ink">
          Click for full profile & grounded research →
        </span>
      </span>
    </button>
  );
}

export function LeaderGrid({
  nodes,
  companyName,
  onOpenPerson,
}: {
  nodes: OrgNode[];
  companyName: string;
  onOpenPerson: (id: string) => void;
}) {
  // Exec row first, then everyone else in stored order.
  const ordered = [...nodes].sort((a, b) =>
    a.group === b.group ? 0 : a.group === 'exec' ? -1 : b.group === 'exec' ? 1 : 0,
  );
  if (ordered.length === 0) return null;
  return (
    <div className="panel mb-4 overflow-visible p-3">
      <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-widest text-muted">
        Leadership · {ordered.length} people
      </p>
      <div className="flex flex-wrap gap-1">
        {ordered.map((p) => (
          <LeaderCard
            key={p.id}
            person={p}
            companyName={companyName}
            onOpen={() => onOpenPerson(p.id)}
          />
        ))}
      </div>
    </div>
  );
}
