/**
 * Which websites research is touching right now, for the status bar's Details.
 * The engine reports each site as it searches, reads or finds a source there;
 * this keeps the most recent ones and groups them by site. Nothing here is a
 * forecast: "how much is left" is the deck's own count of unfilled figures.
 */
import { useEffect, useRef, useState } from 'react';
import type { SourceActivity } from '@mi/contracts';
import { useRepository } from '@/lib/repository/RepositoryProvider';

const KEEP = 120;
const POLL_MS = 2000;

export interface SiteRow {
  domain: string;
  /** What research most recently did there. */
  kind: SourceActivity['kind'];
  count: number;
  company: string | null;
  lastAt: string;
}

/** The newest `max` distinct sites, newest first, with how many times each was touched. */
export function groupSites(items: readonly SourceActivity[], max = 12): SiteRow[] {
  const bySite = new Map<string, SiteRow>();
  for (const item of items) {
    const row = bySite.get(item.domain);
    if (row) {
      row.count += 1;
      if (item.at >= row.lastAt) { row.kind = item.kind; row.company = item.company; row.lastAt = item.at; }
    } else {
      bySite.set(item.domain, { domain: item.domain, kind: item.kind, count: 1, company: item.company, lastAt: item.at });
    }
  }
  return [...bySite.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, max);
}

export const KIND_VERB: Record<SourceActivity['kind'], string> = { searched: 'searched', read: 'read', found: 'source found' };

/** Polls the engine for recent site activity while `active`. Absent engine support yields `supported: false`. */
export function useSourceActivity(active: boolean): { items: SourceActivity[]; supported: boolean } {
  const repo = useRepository();
  const supported = typeof repo.listSourceActivity === 'function';
  const [items, setItems] = useState<SourceActivity[]>([]);
  const last = useRef(0);
  useEffect(() => {
    if (!active || !supported) return;
    let live = true;
    const tick = async () => {
      try {
        const out = await repo.listSourceActivity!(last.current);
        if (!live) return;
        last.current = out.lastId;
        if (out.items.length) setItems((prev) => [...prev, ...out.items].slice(-KEEP));
      } catch { /* a missed poll is just a quieter log */ }
    };
    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => { live = false; clearInterval(t); };
  }, [active, supported, repo]);
  return { items, supported };
}
