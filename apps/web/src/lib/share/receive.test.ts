import { describe, expect, it } from 'vitest';
import { ownershipLabel, type ShareSnapshot } from '@mi/contracts';
import { sharedToCardWithCompany, type SharedCard } from './codec';
import { MARKDOWN_LIMITS, ROW_LIMITS, SNAPSHOT_LIMITS, receiveSnapshot, snapshotWithinLimits } from './receive';

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

describe('how much markdown a share may carry', () => {
  const overview = (markdown: unknown) => ({ lastRefreshedAt: 'x', content: { markdown } });
  const textOf = (s: ShareSnapshot, company = 'c1') => (s.dashboards[company]!.overview!.content as { markdown: string }).markdown;

  it('cuts one field at its limit and keeps the start of it', () => {
    const out = receiveSnapshot(snapshot({ dashboards: { c1: { overview: overview('*a'.repeat(80_000)) } } }));
    expect(textOf(out)).toHaveLength(MARKDOWN_LIMITS.field);
    expect(textOf(out).startsWith('*a*a*a')).toBe(true);
  });

  it('spends one allowance across the whole snapshot, in the order the companies come', () => {
    const page = 'x'.repeat(MARKDOWN_LIMITS.field);
    const ids = Array.from({ length: 300 }, (_unused, i) => `co${i}`);
    const out = receiveSnapshot(snapshot({ dashboards: Object.fromEntries(ids.map((id) => [id, { overview: overview(page) }])) }));
    const lengths = ids.map((id) => textOf(out, id).length);
    expect(lengths.reduce((total, length) => total + length, 0)).toBeLessThanOrEqual(MARKDOWN_LIMITS.total);
    expect(lengths[0]).toBe(MARKDOWN_LIMITS.field);
    expect(lengths[299]).toBe(0);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
  });

  it('covers every field a tab shows as markdown', () => {
    const big = 'y'.repeat(MARKDOWN_LIMITS.field * 2);
    const out = receiveSnapshot(snapshot({ dashboards: { c1: {
      research: { lastRefreshedAt: 'x', content: { markdown: big } },
      history: { lastRefreshedAt: 'x', content: { founderStory: big, timeline: [], quotes: [] } },
      mission_governance: { lastRefreshedAt: 'x', content: { mission: big, ethos: big, governanceStructure: big, board: [] } },
    } } }));
    const tabs = out.dashboards.c1!;
    expect((tabs.research!.content as { markdown: string }).markdown).toHaveLength(MARKDOWN_LIMITS.field);
    expect((tabs.history!.content as { founderStory: string }).founderStory).toHaveLength(MARKDOWN_LIMITS.field);
    for (const field of ['mission', 'ethos', 'governanceStructure']) expect((tabs.mission_governance!.content as Record<string, string>)[field]).toHaveLength(MARKDOWN_LIMITS.field);
  });

  it('keeps honest text exactly, and reads text that is not text as empty', () => {
    const honest = 'Acme **grew** in 2025.\n\n- one\n- two';
    expect(textOf(receiveSnapshot(snapshot({ dashboards: { c1: { overview: overview(honest) } } })))).toBe(honest);
    for (const markdown of [7, null, { a: 1 }, ['x']]) expect(textOf(receiveSnapshot(snapshot({ dashboards: { c1: { overview: overview(markdown) } } })))).toBe('');
  });

  it('shows only tabs that are tabs, with content a screen can read', () => {
    const out = receiveSnapshot(snapshot({ dashboards: { c1: {
      overview: { lastRefreshedAt: 'x', content: 'just a string' },
      metrics: { lastRefreshedAt: 'x', content: null },
      secret_tab: { lastRefreshedAt: 'x', content: { markdown: 'hidden' } },
      team_org: { lastRefreshedAt: 'x', content: [{ id: 'n1', name: 'Ada' }] },
      history: { lastRefreshedAt: 'x', content: { founderStory: 'ok', timeline: [], quotes: [] } },
    } } }));
    expect(Object.keys(out.dashboards.c1!).sort()).toEqual(['history', 'team_org']);
  });
});

describe('how many rows a list inside a share keeps', () => {
  const rows = (n: number, make: (i: number) => Record<string, unknown> = (i) => ({ id: `r${i}`, n: i })) => Array.from({ length: n }, (_unused, i) => make(i));
  const tab = (content: unknown) => ({ lastRefreshedAt: 'x', content });
  const kept = (tabName: string, content: unknown) => (receiveSnapshot(snapshot({ dashboards: { c1: { [tabName]: tab(content) } } })).dashboards.c1![tabName as 'overview']!.content) as Record<string, unknown[]>;

  const LISTS: Array<[string, string, number]> = [
    ['live_intel', 'items', ROW_LIMITS.newsItems], ['live_intel', 'videos', ROW_LIMITS.videos], ['team_org', 'nodes', ROW_LIMITS.people],
    ['metrics', 'revenue', ROW_LIMITS.seriesPoints], ['metrics', 'revenueQuarterly', ROW_LIMITS.seriesPoints], ['metrics', 'users', ROW_LIMITS.seriesPoints],
    ['metrics', 'churn', ROW_LIMITS.seriesPoints], ['metrics', 'nps', ROW_LIMITS.seriesPoints], ['metrics', 'capTable', ROW_LIMITS.capTable],
    ['mission_governance', 'board', ROW_LIMITS.board], ['mission_governance', 'fundingRounds', ROW_LIMITS.fundingRounds], ['mission_governance', 'investors', ROW_LIMITS.investors],
    ['history', 'timeline', ROW_LIMITS.timeline], ['history', 'quotes', ROW_LIMITS.quotes],
    ['products_roadmap', 'products', ROW_LIMITS.products], ['products_roadmap', 'roadmap', ROW_LIMITS.roadmap], ['products_roadmap', 'relationships', ROW_LIMITS.relationships],
  ];
  for (const [tabName, field, limit] of LISTS) {
    it(`keeps the first ${limit} ${field} of the ${tabName} tab, in order, and no more`, () => {
      const out = kept(tabName, { [field]: rows(limit + 500) })[field]!;
      expect(out).toHaveLength(limit);
      expect(out.map((row) => (row as { n: number }).n)).toEqual(Array.from({ length: limit }, (_unused, i) => i));
    });
  }

  it('keeps the lists of plain text in governance short too', () => {
    const out = kept('mission_governance', {
      positives: Array.from({ length: 5_000 }, (_unused, i) => `p${i}`), negatives: ['n', 7, null, 'm'],
      fundingRounds: [{ round: 'A', leadInvestors: Array.from({ length: 2_000 }, (_unused, i) => `L${i}`) }],
    });
    expect(out.positives).toHaveLength(ROW_LIMITS.notes);
    expect(out.negatives).toEqual(['n', 'm']);
    expect((out.fundingRounds![0] as { leadInvestors: string[] }).leadInvestors).toHaveLength(ROW_LIMITS.leadInvestors);
  });

  it('keeps a bare team list short, and reads a list that is not a list as empty', () => {
    const bare = receiveSnapshot(snapshot({ dashboards: { c1: { team_org: tab(rows(20_000)) } } })).dashboards.c1!.team_org!.content as unknown[];
    expect(bare).toHaveLength(ROW_LIMITS.people);
    for (const items of ['lots', 7, { a: 1 }, null]) expect(kept('live_intel', { items, lastRefreshedAt: null }).items).toEqual([]);
    expect(kept('live_intel', { items: [null, 5, 'x', { id: 'a' }, [1]] }).items).toEqual([{ id: 'a' }]);
  });

  it('keeps a card to its first key points and sources', () => {
    const out = receiveSnapshot(snapshot({ cards: [{
      id: 'k1', cardType: 'insight', title: 'Findings', keyPoints: Array.from({ length: 20_000 }, (_unused, i) => `point ${i}`),
      citations: Array.from({ length: 5_000 }, (_unused, i) => ({ title: 't', url: `https://www.example.com/${i}` })),
    }] })).cards[0]!;
    expect(out.keyPoints).toHaveLength(ROW_LIMITS.keyPoints);
    expect(out.keyPoints[0]).toBe('point 0');
    expect(out.citations).toHaveLength(ROW_LIMITS.citations);
    expect(out.citations[0]!.url).toBe('https://www.example.com/0');
  });

  it('keeps a figure to its first sources, and judges it on the ones it keeps', () => {
    const sources = Array.from({ length: 5_000 }, (_unused, i) => ({ title: 'Reuters', url: `https://www.reuters.com/markets/story-${i}` }));
    const [m] = metricsOf(snapshot({ metrics: [metric({
      confidence: 'verified', citations: sources,
      conflicts: Array.from({ length: 300 }, () => ({ metricType: 'valuation', observations: rows(500), detectedAt: 'x', preferredObservation: 0 })),
    })] }));
    expect(m!.citations).toHaveLength(ROW_LIMITS.citations);
    expect(m!.confidence).toBe('verified');
    expect(m!.conflicts).toHaveLength(ROW_LIMITS.conflicts);
    expect(m!.conflicts![0]!.observations).toHaveLength(ROW_LIMITS.observations);
  });

  it('keeps the sources of a company status and a founding year short', () => {
    const sources = Array.from({ length: 5_000 }, (_unused, i) => ({ title: 'Reuters', url: `https://www.reuters.com/markets/deal-${i}` }));
    const out = receiveSnapshot(snapshot({ companies: [{
      id: 'c1', name: 'Acme', oneLiner: 'x', logoUrl: null, websiteUrl: null,
      ownership: { status: 'subsidiary', acquirer: 'Alphabet', citations: sources, confidence: 'verified' },
      founded: { year: 1999, source: 'wikidata', citations: sources, capturedAt: '2026-10-01T00:00:00.000Z' },
    }] })).companies[0]!;
    expect(out.ownership!.citations).toHaveLength(ROW_LIMITS.citations);
    expect(out.founded!.citations).toHaveLength(ROW_LIMITS.citations);
  });

  it('drops a row that is not a row anywhere in the snapshot, without refusing the share', () => {
    const out = receiveSnapshot(snapshot({ companies: [null, 'x', { id: 'c1', name: 'Acme', logoUrl: null, websiteUrl: null }], cards: [null, 7, { id: 'k1', cardType: 'company', title: 'Acme', citations: [] }], viceClaims: [null, 'x'] }));
    expect(out.companies.map((c) => c.id)).toEqual(['c1']);
    expect(out.cards.map((c) => c.id)).toEqual(['k1']);
    expect(out.viceClaims).toEqual([]);
  });

  it('trims nothing from the real sample deck, nor from the demo deck', async () => {
    const { default: sample } = await import('@/sample/frontier-snapshot.json');
    const { MockRepository } = await import('@mi/mocks');
    const repo = new MockRepository({ latencyMs: 0 });
    const [market] = await repo.listMarkets();
    const deck = await repo.getDeckByMarket(market!.id);
    const demo = await repo.exportShareSnapshot({ deckId: deck!.id });
    const real = { v: 1, kind: 'deck', focusCardId: null, sharedAt: '2026-10-19T10:00:00.000Z', markets: sample.markets, decks: sample.decks, companies: sample.companies, metrics: sample.metrics, cards: sample.cards, viceClaims: sample.viceClaims, dashboards: sample.dashboards } as unknown as ShareSnapshot;
    for (const deckSnapshot of [real, demo]) {
      const out = receiveSnapshot(deckSnapshot);
      const asSent = JSON.parse(JSON.stringify(deckSnapshot.dashboards)) as Record<string, Record<string, { content: Record<string, unknown> }>>;
      // The one change an honest tab ever gets: a live site is not embedded.
      for (const tabs of Object.values(asSent)) if (tabs.live_landing) tabs.live_landing.content.embeddable = false;
      expect(out.dashboards).toEqual(asSent);
      expect(out.cards.map((card) => [card.id, card.keyPoints])).toEqual(deckSnapshot.cards.map((card) => [card.id, card.keyPoints]));
      expect(out.cards.map((card) => card.citations.length)).toEqual(deckSnapshot.cards.map((card) => card.citations.length));
    }
  });
});
