import { describe, expect, it } from 'vitest';
import type { ShareSnapshot } from '@mi/contracts';
import { SNAPSHOT_LIMITS, receiveSnapshot, snapshotWithinLimits } from './receive';

const GOOD = { title: 'Annual report', url: 'https://www.reuters.com/markets/acme-results', credibility: 'reputable_secondary' as const };
const metric = (over: Record<string, unknown> = {}) => ({
  id: 'm1', companyId: 'c1', metricType: 'valuation', value: 987_654_321_000, unit: 'USD', confidence: 'estimated', source: null, citations: [],
  asOf: '2026-10-01', ...over,
});
function snapshot(over: Record<string, unknown> = {}): ShareSnapshot {
  return {
    v: 1, kind: 'deck', focusCardId: null, sharedAt: '2026-10-19T10:00:00.000Z',
    markets: [{ id: 'mk', name: 'Meal kits' }], decks: [{ id: 'd1' }],
    companies: [{ id: 'c1', name: 'Acme', logoUrl: 'https://logo.example/acme.png', websiteUrl: 'https://acme.example', oneLiner: 'x' }],
    metrics: [], cards: [{ id: 'k1', cardType: 'company', title: 'Acme', citations: [] }], viceClaims: [], dashboards: {}, ...over,
  } as unknown as ShareSnapshot;
}
const metricsOf = (s: ShareSnapshot) => receiveSnapshot(s).metrics;

describe('a figure in a shared snapshot is only as verified as its sources make it', () => {
  it('never honours "user verified": no person here checked anything', () => {
    const [m] = metricsOf(snapshot({ metrics: [metric({ confidence: 'user_verified' })] }));
    expect(m!.confidence).not.toBe('user_verified');
    expect(m!.confidence).toBe('estimated'); // no source, so not even "verified"
  });

  it('keeps a sourced figure as sourced, and drops an unsourced "verified" to an estimate', () => {
    const [sourced] = metricsOf(snapshot({ metrics: [metric({ confidence: 'verified', citations: [GOOD], source: GOOD.url })] }));
    expect(sourced!.confidence).toBe('verified');
    expect(sourced!.citations[0]!.url).toBe(GOOD.url);
    const [bare] = metricsOf(snapshot({ metrics: [metric({ confidence: 'verified', metricType: 'employees', value: 48_000 })] }));
    expect(bare!.confidence).toBe('estimated');
    const [human] = metricsOf(snapshot({ metrics: [metric({ confidence: 'user_verified', citations: [GOOD], source: GOOD.url })] }));
    expect(human!.confidence).toBe('verified'); // what its source earns, not what the sender claimed
  });

  it('cannot attach a script link as a source', () => {
    const [m] = metricsOf(snapshot({ metrics: [metric({ confidence: 'verified', citations: [{ title: 'x', url: 'javascript:alert(1)' }, GOOD] })] }));
    expect(m!.citations.map((c) => c.url)).toEqual([GOOD.url]);
    const [none] = metricsOf(snapshot({ metrics: [metric({ confidence: 'verified', citations: [{ title: 'x', url: 'javascript:alert(1)' }] })] }));
    expect(none!.confidence).toBe('estimated');
  });

  it('drops a figure that is not a real, non-negative number, and gives an unknown figure no number', () => {
    const kept = metricsOf(snapshot({ metrics: [metric({ value: -5 }), metric({ id: 'm2', value: '12' }), metric({ id: 'm3', value: null, confidence: 'unknown' }), metric({ id: 'm4', value: 7, confidence: 'unknown' })] }));
    expect(kept.map((m) => m.id)).toEqual(['m3', 'm4']);
    expect(kept.find((m) => m.id === 'm4')!.value).toBeNull();
  });
});

describe('what else a stranger could put in a share', () => {
  it('drops an allegation with no clickable source', () => {
    const claim = (id: string, sourceUrl: unknown) => ({ id, cardId: 'k1', claimText: 'Something.', sourceTitle: 's', sourceUrl, capturedAt: '2026-10-01T00:00:00.000Z' });
    const claims = receiveSnapshot(snapshot({ viceClaims: [claim('a', ''), claim('b', 'javascript:alert(1)'), claim('c', null), claim('d', 'https://user:pw@x.example/'), claim('e', 'https://www.reuters.com/x')] })).viceClaims;
    expect(claims.map((c) => c.id)).toEqual(['e']);
  });

  it('keeps only web addresses on cards and companies', () => {
    const out = receiveSnapshot(snapshot({
      companies: [{ id: 'c1', name: 'Acme', logoUrl: 'javascript:alert(1)', websiteUrl: 'data:text/html,x' }, { id: 'c2', name: 'Beta', logoUrl: 'https://logo.example/b.png', websiteUrl: 'https://beta.example' }],
      cards: [{ id: 'k1', cardType: 'culture', title: null, citations: [{ title: 'x', url: 'javascript:alert(1)' }, GOOD] }],
    }));
    expect(out.companies.map((c) => [c.logoUrl, c.websiteUrl])).toEqual([[null, null], ['https://logo.example/b.png', 'https://beta.example']]);
    expect(out.cards[0]!.citations.map((c) => c.url)).toEqual([GOOD.url]);
  });

  it('never offers to load another site inside the page', () => {
    const out = receiveSnapshot(snapshot({ dashboards: { c1: {
      live_landing: { lastRefreshedAt: 'x', content: { url: 'https://attacker.example', embeddable: true, screenshotUrl: null } },
      overview: { lastRefreshedAt: 'x', content: { markdown: 'hello' } },
    } } }));
    expect(out.dashboards.c1!.live_landing!.content).toMatchObject({ url: 'https://attacker.example', embeddable: false });
    expect(out.dashboards.c1!.overview!.content).toEqual({ markdown: 'hello' });
  });

  it('does not change the snapshot it was given', () => {
    const input = snapshot({ metrics: [metric({ confidence: 'user_verified' })] });
    const before = JSON.stringify(input);
    receiveSnapshot(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('how big a snapshot a visitor will build', () => {
  const rows = (n: number) => Array.from({ length: n }, (_unused, i) => ({ id: `x${i}` }));
  it('opens a real deck and refuses a hostile one', () => {
    expect(snapshotWithinLimits(snapshot({ companies: rows(20), cards: rows(24), metrics: rows(400) }))).toBe(true);
    expect(snapshotWithinLimits(snapshot({ companies: rows(SNAPSHOT_LIMITS.companies + 1) }))).toBe(false);
    expect(snapshotWithinLimits(snapshot({ cards: rows(SNAPSHOT_LIMITS.cards + 1) }))).toBe(false);
    expect(snapshotWithinLimits(snapshot({ metrics: rows(SNAPSHOT_LIMITS.metrics + 1) }))).toBe(false);
    expect(snapshotWithinLimits(snapshot({ viceClaims: rows(SNAPSHOT_LIMITS.viceClaims + 1) }))).toBe(false);
    expect(snapshotWithinLimits(snapshot({ dashboards: Object.fromEntries(rows(SNAPSHOT_LIMITS.dashboardCompanies + 1).map((r) => [r.id, {}])) }))).toBe(false);
  });
});
