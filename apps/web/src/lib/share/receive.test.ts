import { describe, expect, it } from 'vitest';
import { ownershipLabel, type ShareSnapshot } from '@mi/contracts';
import { sharedToCardWithCompany, type SharedCard } from './codec';
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

describe('who owns a company, and when it was founded, in a share', () => {
  // The review's forgery: no source at all, a closing date, a price, and a claim that a person checked it.
  const FORGED = {
    status: 'acquired', acquirer: 'Forged Holdings', announcedOn: '2026', closedOn: '2026-01-01',
    price: { value: 5_000_000_000, currency: 'USD' }, citations: [], confidence: 'user_verified', methodNote: 'Checked by a person.',
  };
  const company = (extra: Record<string, unknown>) => ({ id: 'c1', name: 'Acme', oneLiner: 'x', logoUrl: null, websiteUrl: 'https://acme.example', ...extra });
  const shown = (extra: Record<string, unknown>) => receiveSnapshot(snapshot({ companies: [company(extra)] })).companies[0]!;

  it('does not show "Acquired by" for a status that names no source, even one that says a person checked it', () => {
    const out = shown({ ownership: FORGED });
    expect(out.ownership).toBeUndefined();
    expect(ownershipLabel(out.ownership)).toBeNull();
    // Nor does the figure beside it lose its valuation to a deal nobody sourced.
    const [valuation] = receiveSnapshot(snapshot({ companies: [company({ ownership: FORGED })], metrics: [metric({ confidence: 'estimated' })] })).metrics;
    expect(valuation!.value).toBe(987_654_321_000);
  });

  it('reads "user verified" on a sourced status as what the sources earn, and says why', () => {
    const out = shown({ ownership: { ...FORGED, citations: [GOOD] } });
    expect(out.ownership!.confidence).toBe('verified');
    expect(out.ownership!.methodNote).toMatch(/only a person can mark ownership user-verified/);
    expect(out.ownership!.citations.map((c) => c.url)).toEqual([GOOD.url]);
    expect(ownershipLabel(out.ownership)).toBe('Acquired by Forged Holdings · 2026');
  });

  it('keeps a sourced status as sent, without a script link as its source', () => {
    const sourced = { status: 'subsidiary', acquirer: 'Alphabet', citations: [{ title: 'x', url: 'javascript:alert(1)' }, GOOD], confidence: 'verified' };
    expect(shown({ ownership: sourced }).ownership!.citations.map((c) => c.url)).toEqual([GOOD.url]);
    expect(shown({ ownership: { ...sourced, citations: [{ title: 'x', url: 'javascript:alert(1)' }] } }).ownership).toBeUndefined();
  });

  it('drops a status that is not a status, without refusing the rest of the share', () => {
    for (const ownership of ['acquired', 7, [], { status: 'acquired', acquirer: 42, citations: [GOOD], confidence: 'verified' }, { status: 'acquired', acquirer: 'X', citations: 'many', confidence: 'verified' }]) {
      const out = receiveSnapshot(snapshot({ companies: [company({ ownership })] }));
      expect(out.companies[0]!.ownership).toBeUndefined();
      expect(out.companies[0]!.name).toBe('Acme');
    }
  });

  it('shows a founding year only with a source behind it', () => {
    const founded = { year: 1999, source: 'wikidata', citations: [GOOD], capturedAt: '2026-10-01T00:00:00.000Z' };
    expect(shown({ founded }).founded).toMatchObject({ year: 1999, source: 'wikidata' });
    expect(shown({ founded: { ...founded, citations: [] } }).founded).toBeUndefined();
    expect(shown({ founded: { ...founded, citations: [{ title: 'x', url: 'javascript:alert(1)' }] } }).founded).toBeUndefined();
    expect(shown({ founded: { ...founded, year: 'long ago' } }).founded).toBeUndefined();
    expect(shown({ founded: { ...founded, year: 3000 } }).founded).toBeUndefined();
  });

  it('shows the same as a private link does for the same forged company', () => {
    const privateCard = {
      type: 'company', title: null, summary: null, tier: null, keyPoints: [], citations: [], claims: [], metrics: [],
      company: { name: 'Acme', oneLiner: 'x', website: null, hq: null, logo: null, ow: FORGED },
    } as unknown as SharedCard;
    const viaLink = sharedToCardWithCompany(privateCard, 0, '2026-10-19T10:00:00.000Z').company;
    const viaHost = shown({ ownership: FORGED });
    expect(ownershipLabel(viaLink?.ownership)).toBeNull();
    expect(ownershipLabel(viaHost.ownership)).toBeNull();
    expect(viaHost.ownership ?? null).toEqual(viaLink?.ownership ?? null);
  });
});
