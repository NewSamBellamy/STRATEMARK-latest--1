/**
 * Pure helpers shared by the dashboard tabs (org chart, timeline, products,
 * live intel, research). No React, no data fabrication: every function only
 * regroups, filters or labels what research already retained.
 */
import type { OrgNode } from '@mi/contracts';

// ── Org chart ───────────────────────────────────────────────────────────────

export interface OrgTreeNode {
  person: OrgNode;
  depth: number;
  children: OrgTreeNode[];
  /** Total people beneath this node (all levels). */
  descendants: number;
}

/**
 * Build the reporting forest from a flat list. Tolerant by design: a missing
 * parent makes the person a root (never dropped), and a cycle is broken at the
 * point it would loop (never infinite). Input order is preserved among siblings.
 */
export function buildOrgTree(nodes: OrgNode[]): OrgTreeNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, OrgNode[]>();
  const roots: OrgNode[] = [];
  const reaches = (start: string, target: string): boolean => {
    const seen = new Set<string>();
    let cur: string | null = start;
    while (cur && !seen.has(cur)) {
      if (cur === target) return true;
      seen.add(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
    return false;
  };
  for (const n of nodes) {
    const parentOk = n.parentId && n.parentId !== n.id && byId.has(n.parentId);
    // A parent chain that leads back to this person is a cycle: treat as root.
    if (parentOk && !reaches(n.parentId as string, n.id)) {
      const list = childrenOf.get(n.parentId as string) ?? [];
      list.push(n);
      childrenOf.set(n.parentId as string, list);
    } else {
      roots.push(n);
    }
  }
  const build = (p: OrgNode, depth: number): OrgTreeNode => {
    const children = (childrenOf.get(p.id) ?? []).map((c) => build(c, depth + 1));
    return {
      person: p,
      depth,
      children,
      descendants: children.reduce((s, c) => s + 1 + c.descendants, 0),
    };
  };
  return roots.map((r) => build(r, 0));
}

/** Keep the people a predicate matches, plus their ancestors (so context survives). */
export function filterOrgTree(
  forest: OrgTreeNode[],
  keep: (p: OrgNode) => boolean,
): OrgTreeNode[] {
  const walk = (n: OrgTreeNode): OrgTreeNode | null => {
    const children = n.children.map(walk).filter((c): c is OrgTreeNode => c !== null);
    if (!keep(n.person) && children.length === 0) return null;
    return {
      ...n,
      children,
      descendants: children.reduce((s, c) => s + 1 + c.descendants, 0),
    };
  };
  return forest.map(walk).filter((n): n is OrgTreeNode => n !== null);
}

export function orgInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function countByGroup(nodes: OrgNode[]): Record<OrgNode['group'], number> {
  const out: Record<OrgNode['group'], number> = { exec: 0, ai: 0, product: 0, design: 0, other: 0 };
  for (const n of nodes) out[n.group] += 1;
  return out;
}

// ── Timeline ────────────────────────────────────────────────────────────────

export type EventKind = 'funding' | 'product' | 'leadership' | 'corporate' | 'other';

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  funding: 'Funding',
  product: 'Product',
  leadership: 'Leadership',
  corporate: 'Corporate',
  other: 'Other',
};

/**
 * A reading aid, not a fact: classifies an event from the words in its own
 * title/detail so the reader can filter. Ambiguous text is "other".
 */
export function classifyEvent(title: string, detail = ''): EventKind {
  const t = `${title} ${detail}`.toLowerCase();
  if (/\b(series [a-z]|seed round|funding|raises|raised|valuation|ipo|spac|tender offer|investment|invests?|round)\b/.test(t)) return 'funding';
  if (/\b(launch(es|ed)?|releas(es|ed)?|unveil(s|ed)?|introduc(es|ed)|debut(s|ed)?|ships?|shipped|beta)\b/.test(t)) return 'product';
  if (/\b(ceo|cto|cfo|coo|chair(man|woman)?|president|appoint(s|ed)?|hires?d?|steps? down|resign(s|ed)?|joins?|joined|succeed(s|ed)?)\b/.test(t)) return 'leadership';
  if (/\b(found(ed|ing)|incorporat(ed|ion)|acqui(res|red|sition)|merg(es|ed|er)|spin-?off|partnership|headquarter|relocat(es|ed)|expands?|expansion|lawsuit|settle(s|d|ment)|regulat\w*)\b/.test(t)) return 'corporate';
  return 'other';
}

/** First plausible 4-digit year in a free-form date ("2024 Mar", "Q3 2021", "1998"). */
export function parseEventYear(date: string): number | null {
  const m = /\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/.exec(date);
  return m ? Number(m[1]) : null;
}

export interface YearGroup<T> {
  /** null means the research gave no usable year. */
  year: number | null;
  label: string;
  items: T[];
}

/** Group by year, newest year first, undated last; item order within a year is kept. */
export function groupByYear<T extends { date: string }>(items: T[]): YearGroup<T>[] {
  const map = new Map<number | null, T[]>();
  for (const it of items) {
    const y = parseEventYear(it.date);
    const list = map.get(y) ?? [];
    list.push(it);
    map.set(y, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : b - a))
    .map(([year, list]) => ({ year, label: year === null ? 'Undated' : String(year), items: list }));
}

// ── Sources ─────────────────────────────────────────────────────────────────

/** Display host for a URL ("www." stripped); null when it is not a URL. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** Group citations by publisher host, biggest group first; unparseable URLs are dropped. */
export function groupByHost<T extends { url: string }>(
  items: T[],
): { host: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const host = hostOf(it.url);
    if (!host) continue;
    const list = map.get(host) ?? [];
    list.push(it);
    map.set(host, list);
  }
  return [...map.entries()]
    .map(([host, list]) => ({ host, items: list }))
    .sort((a, b) => b.items.length - a.items.length || a.host.localeCompare(b.host));
}

// ── Recency ─────────────────────────────────────────────────────────────────

export type RecencyBucket = 'week' | 'month' | 'quarter' | 'older' | 'undated';

export const RECENCY_LABEL: Record<RecencyBucket, string> = {
  week: 'Past 7 days',
  month: 'Past 30 days',
  quarter: 'Past 90 days',
  older: 'Older',
  undated: 'No reported date',
};

/** Bucket by the REPORTED date only; a missing/unparseable date is "undated", never "recent". */
export function recencyBucket(reported: string | null | undefined, now = Date.now()): RecencyBucket {
  if (!reported) return 'undated';
  const t = Date.parse(reported);
  if (Number.isNaN(t)) return 'undated';
  const days = (now - t) / 86_400_000;
  if (days <= 7) return 'week';
  if (days <= 30) return 'month';
  if (days <= 90) return 'quarter';
  return 'older';
}

/** Case-insensitive all-terms match; an empty query matches everything. */
export function matchesQuery(haystack: string, query: string): boolean {
  const terms = query.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
  if (terms.length === 0) return true;
  const h = haystack.toLowerCase();
  return terms.every((t) => h.includes(t));
}

// -- Source strength ----------------------------------------------------------
export type SourceStrength = 'primary' | 'press' | 'industry' | 'community' | 'unrated';

export const SOURCE_STRENGTH_LABEL: Record<SourceStrength, string> = {
  primary: 'Company & filings',
  press: 'Independent press',
  industry: 'Industry sites',
  community: 'Community',
  unrated: 'Unrated',
};

/** Strongest first: the order a reader should weigh sources in. */
export const SOURCE_STRENGTH_ORDER: SourceStrength[] = ['primary', 'press', 'industry', 'community', 'unrated'];

const STRENGTH_OF: Record<string, SourceStrength> = {
  primary: 'primary',
  reputable_secondary: 'press',
  industry: 'industry',
  user_generated: 'community',
};

/** How strong a source is by the class the citation already carries; never guessed. */
export function sourceStrength(credibility: string | undefined): SourceStrength {
  return (credibility && STRENGTH_OF[credibility]) || 'unrated';
}

/** Sources per strength class, only the classes that occur, strongest first. */
export function strengthMix(items: ReadonlyArray<{ strength: SourceStrength }>): Array<{ strength: SourceStrength; count: number }> {
  const counts = new Map<SourceStrength, number>();
  for (const item of items) counts.set(item.strength, (counts.get(item.strength) ?? 0) + 1);
  return SOURCE_STRENGTH_ORDER.filter((strength) => counts.has(strength)).map((strength) => ({ strength, count: counts.get(strength)! }));
}

const SEARCH_REPORT = /^Google Search reports \(original page not retrieved\):\s*[“"]?([\s\S]*?)[”"]?\s*$/;

/**
 * A claim the pipeline could only source from Google's search answer arrives as
 * "Google Search reports (original page not retrieved): “…”". Said on every
 * card, that wrapper buries the claim; this returns the claim itself and a flag
 * so the card can show one small "Search-reported" marker instead.
 */
export function splitSearchReport(text: string): { text: string; searchReported: boolean } {
  const match = SEARCH_REPORT.exec(text.trim());
  return match && match[1] ? { text: match[1].trim(), searchReported: true } : { text, searchReported: false };
}
