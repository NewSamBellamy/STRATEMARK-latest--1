import { describe, expect, it } from 'vitest';
import { buildDataset } from '@mi/mocks';
import type { CompanyMetric, MetricType } from '@mi/contracts';
import {
  extractTakeaways, formatAsOf, missingCoreTypes, parseOverviewSections, pickKpis, positionRankings,
  rankInDeck, sortMetricRows, splitAttribution, barPercent, type PeerEntry,
} from './dashboardModel';

const seed = buildDataset().metrics[0]!;
const metric = (companyId: string, metricType: MetricType, value: number | null, patch: Partial<CompanyMetric> = {}): CompanyMetric => ({
  ...seed, id: `${companyId}-${metricType}`, companyId, metricType, value,
  confidence: value == null ? 'unknown' : 'verified', passageSupport: null, reportedSupport: null, ...patch,
});
const peer = (id: string, ...metrics: CompanyMetric[]): PeerEntry => ({ companyId: id, name: id.toUpperCase(), metrics });

describe('rankInDeck', () => {
  const entries = [
    peer('a', metric('a', 'valuation', 300)),
    peer('b', metric('b', 'valuation', 900)),
    peer('c', metric('c', 'valuation', null)),
    peer('d', metric('d', 'valuation', 100)),
  ];
  it('ranks only known values and excludes unknown peers rather than ranking them last', () => {
    const r = rankInDeck('a', 'valuation', entries);
    expect(r.rank).toBe(2);
    expect(r.of).toBe(3);
    expect(r.unknownPeers).toBe(1);
    expect(r.points.map((p) => p.companyId)).toEqual(['b', 'a', 'd']);
    expect(r.percentile).toBe(50);
  });
  it('gives no rank when this company is unknown', () => {
    const r = rankInDeck('c', 'valuation', entries);
    expect(r.rank).toBeNull();
    expect(r.percentile).toBeNull();
  });
  it('never imputes a value for a metric nobody has', () => {
    const r = rankInDeck('a', 'users', entries);
    expect(r.points).toEqual([]);
    expect(r.rank).toBeNull();
    expect(r.unknownPeers).toBe(3);
  });
  it('a figure the source check withheld is a gap in the ranking, never a zero or a last place', () => {
    const withheld = metric('c', 'valuation', null, { methodNote: 'No accepted original-backed current fact.' });
    const r = rankInDeck('a', 'valuation', [peer('a', metric('a', 'valuation', 300)), peer('c', withheld)]);
    expect(r.points.map((p) => p.companyId)).toEqual(['a']);
    expect(r.points.some((p) => p.value === 0)).toBe(false);
    expect(r.unknownPeers).toBe(1);
  });
  it('shares the better rank on ties and flags estimates', () => {
    const r = rankInDeck('a', 'valuation', [
      peer('a', metric('a', 'valuation', 5, { confidence: 'estimated' })),
      peer('b', metric('b', 'valuation', 5)),
    ]);
    expect(r.rank).toBe(1);
    expect(r.includesEstimates).toBe(true);
  });
  it('skips scoped populations that are not the same basis', () => {
    const scoped = metric('b', 'users', 10, { passageSupport: { sourceUrl: 'https://x.test', quote: 'monthly active users', asOf: '2026-01-01', basis: 'users', unit: 'count', definition: 'monthly_active_users' } as CompanyMetric['passageSupport'] });
    const r = rankInDeck('a', 'users', [peer('a', metric('a', 'users', 4)), peer('b', scoped)]);
    expect(r.of).toBe(1);
  });
});

describe('positionRankings', () => {
  it('returns only rankable metrics', () => {
    const { ranked, unrankable } = positionRankings('a', [
      peer('a', metric('a', 'valuation', 1), metric('a', 'employees', 10)),
      peer('b', metric('b', 'valuation', 2)),
    ]);
    expect(ranked.map((r) => r.metricType)).toEqual(['valuation']);
    expect(unrankable).toContain('employees');
  });
});

describe('pickKpis / missingCoreTypes', () => {
  it('leads with known figures and pads with labelled gaps up to four', () => {
    const ms = [metric('a', 'employees', 40), metric('a', 'valuation', null), metric('a', 'users', null), metric('a', 'revenue', null), metric('a', 'arr', null)];
    const picked = pickKpis(ms);
    expect(picked[0]!.metricType).toBe('employees');
    expect(picked).toHaveLength(4);
    expect(picked.slice(1).every((m) => m.value === null)).toBe(true);
  });
  it('caps at six known tiles', () => {
    const types: MetricType[] = ['valuation', 'revenue', 'arr', 'funding_total', 'users', 'employees', 'market_share'];
    expect(pickKpis(types.map((t) => metric('a', t, 1)))).toHaveLength(6);
  });
  it('names core gaps that have no row at all', () => {
    expect(missingCoreTypes([metric('a', 'valuation', 1)], 4)).toEqual(['revenue', 'employees', 'users']);
  });
});

describe('formatAsOf', () => {
  it('prefers the source as-of date, then verification, then capture', () => {
    expect(formatAsOf(metric('a', 'employees', 1, { passageSupport: { sourceUrl: 'u', quote: 'q', asOf: '2026-06-30', basis: 'employees', unit: 'count' } as CompanyMetric['passageSupport'] }))).toBe('As of 2026-06-30');
    // Timestamps are built from local times so the expectation holds in any timezone.
    expect(formatAsOf(metric('a', 'employees', 1, { lastVerifiedAt: new Date(2026, 6, 1, 10).toISOString() }))).toBe('Checked 2026-07-01');
    expect(formatAsOf(metric('a', 'employees', 1, { lastVerifiedAt: null, capturedAt: new Date(2026, 4, 2).toISOString() }))).toBe('Captured 2026-05-02');
  });

  it('dates a capture timestamp in the local calendar, not UTC', () => {
    // 11:30pm local on Oct 12 is Oct 13 in UTC anywhere west of Greenwich,
    // and the reader's "Recorded Oct 12" must agree with the dashboard.
    const lateEvening = new Date(2026, 9, 12, 23, 30).toISOString();
    expect(formatAsOf(metric('a', 'employees', 1, { lastVerifiedAt: null, capturedAt: lateEvening }))).toBe('Captured 2026-10-12');
    const earlyMorning = new Date(2026, 9, 12, 0, 30).toISOString();
    expect(formatAsOf(metric('a', 'employees', 1, { lastVerifiedAt: earlyMorning }))).toBe('Checked 2026-10-12');
  });

  it('never shifts a source-stated calendar date by timezone', () => {
    const asOf = (date: string) => formatAsOf(metric('a', 'employees', 1, {
      passageSupport: { sourceUrl: 'u', quote: 'q', asOf: date, basis: 'employees', unit: 'count' } as CompanyMetric['passageSupport'],
    }));
    expect(asOf('2026-01-01')).toBe('As of 2026-01-01');
    expect(asOf('2025-12-31')).toBe('As of 2025-12-31');
  });
});

describe('sortMetricRows', () => {
  const rows = [
    { metric: metric('a', 'valuation', 10), rank: 2 },
    { metric: metric('a', 'employees', null), rank: null },
    { metric: metric('a', 'revenue', 50), rank: 1 },
  ];
  it('sinks unknowns to the bottom in either direction', () => {
    expect(sortMetricRows(rows, 'value', 'desc').map((r) => r.metric.metricType)).toEqual(['revenue', 'valuation', 'employees']);
    expect(sortMetricRows(rows, 'value', 'asc').map((r) => r.metric.metricType)).toEqual(['valuation', 'revenue', 'employees']);
  });
  it('sorts by rank with unranked last', () => {
    expect(sortMetricRows(rows, 'rank', 'asc').map((r) => r.metric.metricType)).toEqual(['revenue', 'valuation', 'employees']);
  });
});

describe('overview parsing', () => {
  const md = [
    '## Source-reported background', 'Acme builds widgets for factories across Europe and Asia. It was founded in 2012.', '[Reuters](https://r.test/a) · [SEC](https://sec.gov/x)', '',
    '## Market position', 'Acme holds a leading share of the European widget market, per analysts.', '[Gartner](https://g.test/b)', '',
    '- Employees: 400 — filing ([SEC](https://sec.gov/x))', '',
  ].join('\n');
  it('parses sections and figure bullets', () => {
    const { sections, figures } = parseOverviewSections(md);
    expect(sections.map((s) => s.title)).toEqual(['Source-reported background', 'Market position']);
    expect(figures).toEqual(['Employees: 400 — filing ([SEC](https://sec.gov/x))']);
  });
  it('splits trailing attribution chips from prose', () => {
    const { text, links } = splitAttribution('Hello world.\n[A](https://a.test) · [B](https://b.test)');
    expect(text).toBe('Hello world.');
    expect(links.map((l) => l.title)).toEqual(['A', 'B']);
  });
  it('extracts one cited takeaway per section', () => {
    const t = extractTakeaways(parseOverviewSections(md).sections);
    expect(t).toHaveLength(2);
    expect(t[0]!.links).toHaveLength(2);
    expect(t[1]!.text).toMatch(/leading share/);
  });
  it('keeps version numbers whole and skips figure dumps', () => {
    const t = extractTakeaways([
      { title: 'Products and services', body: 'The lineup includes Claude Haiku 4.5 as a high-speed small model. It also ships an API.' },
      { title: 'Business figures', body: 'Employees: Unknown - Users: Unknown - Revenue (USD): Unknown' },
    ]);
    expect(t).toHaveLength(1);
    expect(t[0]!.text).toMatch(/^The lineup includes Claude Haiku 4\.5 as a high-speed small model\./);
  });
  it('returns nothing for unstructured text', () => {
    expect(extractTakeaways(parseOverviewSections('just prose').sections)).toEqual([]);
  });
});

describe('barPercent', () => {
  it('scales to the leader and never exceeds bounds', () => {
    expect(barPercent(50, 100)).toBe(50);
    expect(barPercent(0.1, 100)).toBe(2);
    expect(barPercent(5, 0)).toBe(0);
  });
});

describe('extractTakeaways non-answers', () => {
  it('skips a research-status line instead of showing it as a takeaway', () => {
    const sections = [
      { title: 'Source-reported background', body: 'Background unavailable: no source-attributed background was retained.' },
      { title: 'Products and services', body: 'Acme sells industrial widgets to factories across Europe.' },
    ];
    expect(extractTakeaways(sections).map((t) => t.section)).toEqual(['Products and services']);
  });
});
