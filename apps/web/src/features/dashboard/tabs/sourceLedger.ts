/**
 * The source ledger: every link the app really holds behind a company's
 * figures, news, people, funding and history, collected into one deduplicated
 * list. Nothing is invented: a date is only the story's own reported date, a
 * tier is only the class the citation already carries (else "unrated"), and a
 * source with no usable http(s) URL is dropped.
 */
import { publisherOf, usableCitations, type Citation, type CompanyMetric, type DashboardTab } from '@mi/contracts';
import { sourceStrength, SOURCE_STRENGTH_ORDER, type SourceStrength } from './tabHelpers';

export interface LedgerSource {
  url: string;
  /** Publisher name (or host) the citation carries. */
  publisher: string;
  /** Link text: the article title when one is known, else the publisher. */
  title: string;
  strength: SourceStrength;
  /** The story's own reported date, when a source states it. Never a collection date. */
  date: string | null;
  /** What in the app leans on it: Figures, News, People, Funding, History, … */
  uses: string[];
}

/** The slice of a stored dashboard section the ledger reads (all optional, all untrusted). */
export interface LedgerSection {
  content: unknown;
  citations?: Citation[];
}

export interface LedgerInput {
  metrics?: readonly CompanyMetric[];
  sections?: Partial<Record<DashboardTab, LedgerSection | null | undefined>>;
  /** Citations from retained research records, as `[label, citations]`. */
  retained?: ReadonlyArray<{ label: string; citations: readonly Citation[] | undefined }>;
}

const SECTION_LABEL: Partial<Record<DashboardTab, string>> = {
  overview: 'Overview',
  team_org: 'People',
  products_roadmap: 'Products',
  history: 'History',
  live_intel: 'News',
  mission_governance: 'Governance',
};

const USE_ORDER = ['Figures', 'News', 'People', 'Funding', 'History', 'Overview', 'Products', 'Governance'];

const records = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [];
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** "Google Search report for X · anthropic.com" -> "anthropic.com". */
function cleanPublisher(raw: string): string {
  return raw.split(' · ').pop()!.trim() || raw;
}

export function buildSourceLedger(input: LedgerInput): LedgerSource[] {
  const byUrl = new Map<string, LedgerSource>();
  const add = (use: string, c: Citation, extra?: { publisher?: string; title?: string; date?: string }) => {
    const [ok] = usableCitations([c]);
    if (!ok) return;
    const publisher = cleanPublisher(extra?.publisher || publisherOf(ok.url, ok.title));
    const strength = sourceStrength(ok.credibility);
    const prev = byUrl.get(ok.url);
    if (!prev) {
      byUrl.set(ok.url, {
        url: ok.url,
        publisher,
        title: extra?.title || publisher,
        strength,
        date: extra?.date || null,
        uses: [use],
      });
      return;
    }
    if (!prev.uses.includes(use)) prev.uses.push(use);
    // Keep the strongest class any citation of this URL carries; unrated never outranks a rating.
    if (SOURCE_STRENGTH_ORDER.indexOf(strength) < SOURCE_STRENGTH_ORDER.indexOf(prev.strength)) prev.strength = strength;
    if (!prev.date && extra?.date) prev.date = extra.date;
    if (extra?.title && prev.title === prev.publisher) prev.title = extra.title;
  };
  const bare = (url: unknown): Citation | null => (text(url) ? { title: '', url: text(url) } : null);

  for (const m of input.metrics ?? []) {
    for (const c of m.citations ?? []) add('Figures', c);
  }

  for (const [tab, section] of Object.entries(input.sections ?? {}) as [DashboardTab, LedgerSection | null | undefined][]) {
    if (!section) continue;
    const label = SECTION_LABEL[tab];
    if (!label) continue;
    for (const c of section.citations ?? []) add(label, c);
    const content = (section.content ?? {}) as Record<string, unknown>;
    if (tab === 'live_intel') {
      for (const item of records(content.items)) {
        const cite = bare(item.url);
        if (!cite) continue;
        add('News', cite, {
          publisher: text(item.publisher) || undefined,
          title: text(item.title) || undefined,
          date: text(item.publishedDate) || undefined,
        });
      }
    } else if (tab === 'team_org') {
      for (const node of records(content.nodes)) {
        const cite = bare(node.sourceUrl);
        if (cite) add('People', cite);
      }
    } else if (tab === 'mission_governance') {
      for (const round of records(content.fundingRounds)) {
        const cite = bare(round.sourceUrl);
        if (cite) add('Funding', cite, { date: text(round.date) || undefined });
      }
    } else if (tab === 'history') {
      for (const row of [...records(content.timeline), ...records(content.quotes)]) {
        const cite = bare(row.sourceUrl);
        if (cite) add('History', cite, { title: text(row.sourceTitle) || undefined });
      }
    }
  }

  for (const r of input.retained ?? []) {
    for (const c of r.citations ?? []) add(r.label, c);
  }

  return [...byUrl.values()].map((s) => ({
    ...s,
    uses: [...s.uses].sort((a, b) => {
      const ai = USE_ORDER.indexOf(a), bi = USE_ORDER.indexOf(b);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    }),
  }));
}

/** Group by publisher, biggest group first; ties alphabetical. */
export function groupByPublisher(sources: readonly LedgerSource[]): { publisher: string; items: LedgerSource[] }[] {
  const map = new Map<string, LedgerSource[]>();
  for (const s of sources) {
    const list = map.get(s.publisher) ?? [];
    list.push(s);
    map.set(s.publisher, list);
  }
  return [...map.entries()]
    .map(([publisher, items]) => ({ publisher, items }))
    .sort((a, b) => b.items.length - a.items.length || a.publisher.localeCompare(b.publisher));
}
