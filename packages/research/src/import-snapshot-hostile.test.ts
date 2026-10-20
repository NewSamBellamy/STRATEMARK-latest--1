import { describe, expect, it } from 'vitest';
import { companyMetricSchema } from '@mi/contracts';
import { completenessFixture } from './completeness-report.fixture';
import { ImportRefusedError, prepareImportedSnapshot } from './import-snapshot';
import { METRIC_GATE_VERSION } from './revalidate-stored';
import { migrateSnapshot, type RepoSnapshot } from './repository';

type Loose = Record<string, unknown>;
const fixture = () => completenessFixture() as unknown as RepoSnapshot & Loose;
/** The fixture with one field replaced, the way a hostile file would. */
const withField = (field: string, value: unknown) => ({ ...fixture(), [field]: value }) as unknown as RepoSnapshot;
const prepared = (snapshot: RepoSnapshot) => prepareImportedSnapshot(snapshot);
const rows = (n: number) => Array.from({ length: n }, () => ({}));
const at = '2026-01-01T00:00:00Z';

describe('a file made of many small rows is refused, whole, before any row is read', () => {
  it.each([
    ['markets', 501, /501 decks, more than the 500/],
    ['decks', 501, /501 decks, more than the 500/],
    ['cards', 20_001, /20,001 cards, more than the 20,000/],
    ['metrics', 50_001, /50,001 figures, more than the 50,000/],
    ['viceClaims', 20_001, /20,001 claims, more than the 20,000/],
    ['reports', 2_001, /2,001 reports, more than the 2,000/],
    ['briefings', 2_001, /2,001 briefings, more than the 2,000/],
    ['savedCards', 20_001, /20,001 saved cards, more than the 20,000/],
    ['threads', 2_001, /2,001 conversations, more than the 2,000/],
    ['researchEvidence', 20_001, /20,001 research notes, more than the 20,000/],
    ['researchJobs', 501, /501 research runs, more than the 500/],
    ['originalSourceAttempts', 20_001, /20,001 saved source pages, more than the 20,000/],
  ])('%s over its limit', (field, size, message) => {
    expect(() => prepared(withField(field, rows(size)))).toThrow(ImportRefusedError);
    expect(() => prepared(withField(field, rows(size)))).toThrow(message);
    expect(() => prepared(withField(field, rows(size)))).toThrow(/probably not a Stratemark export/);
  });

  it('refuses a keyed collection with more entries than the file has companies for', () => {
    const many = Object.fromEntries(Array.from({ length: 5_001 }, (_, n) => [`c${n}`, {}]));
    expect(() => prepared(withField('dashboards', many))).toThrow(/5,001 company pages, more than the 5,000/);
    const analyses = Object.fromEntries(Array.from({ length: 1_001 }, (_, n) => [`m${n}`, {}]));
    expect(() => prepared(withField('opportunity', analyses))).toThrow(/1,001 market analyses, more than the 1,000/);
  });

  it('refuses the reviewer\'s 60,000-deck file at once, not after a slow start', () => {
    const started = Date.now();
    expect(() => prepared(withField('markets', rows(60_000)))).toThrow(/60,000 decks, more than the 500/);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('takes a list exactly at its limit', () => {
    expect(() => prepared(withField('markets', rows(500)))).not.toThrow();
    expect(() => prepared(withField('cards', rows(20_000)))).not.toThrow();
  });
});

describe('what a file cannot say about the person: following, and "already revalidated"', () => {
  it('leaves out followed companies, their news and when it was last looked for, and counts the follows', () => {
    const file = {
      ...fixture(),
      follows: [{ companyId: 'acme', followedAt: at }, { companyId: 'beta', followedAt: at }],
      moves: [{ id: 'mv', companyId: 'acme', kind: 'funding', title: 'Raised', url: 'https://example.com/x', publishedAt: at, foundAt: at, source: 'news', readAt: null }],
      movesRefreshedAt: { acme: at },
    } as unknown as RepoSnapshot;
    const plan = prepared(file);
    expect(plan.snapshot.follows).toBeUndefined();
    expect(plan.snapshot.moves).toBeUndefined();
    expect(plan.snapshot.movesRefreshedAt).toBeUndefined();
    expect(plan.followsLeftOut).toBe(2);
  });

  it('ignores a claim that the figures were revalidated, so imported figures are judged here', () => {
    const plan = prepared(withField('metricGateVersion', 999));
    expect(plan.snapshot.metricGateVersion).toBeUndefined();
    const migrated = migrateSnapshot(plan.snapshot);
    expect(migrated.revalidation?.ran).toBe(true);
    expect(migrated.snapshot.metricGateVersion).toBe(METRIC_GATE_VERSION);
  });
});

describe('a note without text cannot stop every start', () => {
  const note = (change: Loose) => ({ id: 'e1', companyId: 'acme', companyName: 'Acme', topic: 't', capturedAt: at, text: 'x', citations: [], queries: [], ...change });
  const dropped = (change: Loose) => prepared(withField('researchEvidence', [{ ...note({}), ...change }])).snapshot.researchEvidence;

  it('is not kept when its text is missing, or its grounding answer is not text', () => {
    const missing = note({}); delete (missing as Loose).text;
    expect(prepared(withField('researchEvidence', [missing])).snapshot.researchEvidence).toEqual([]);
    expect(dropped({ text: 5 })).toEqual([]);
    expect(dropped({ grounding: { answerText: 5 } })).toEqual([]);
    expect(dropped({ grounding: [] })).toEqual([]);
    expect(dropped({})).toHaveLength(1);
    expect(dropped({ grounding: { answerText: 'ok' } })).toHaveLength(1);
  });

  it('is read as nothing, not as an error, by the revalidation that runs when the figure gates move on', () => {
    // A workspace saved under an older gate version is revalidated at start; this row used to make that throw every time.
    const stored = { ...fixture(), metricGateVersion: 1, researchEvidence: [{ id: 'e1', companyId: 'acme', topic: 't', capturedAt: at, citations: [], queries: [] }] } as unknown as RepoSnapshot;
    expect(() => migrateSnapshot(stored)).not.toThrow();
  });
});

describe('a figure that is not a finite number is not a figure', () => {
  it('rejects Infinity in the metric contract and leaves the row out of an import', () => {
    const valid = fixture().metrics[0]!;
    expect(companyMetricSchema.safeParse({ ...valid, value: Infinity }).success).toBe(false);
    expect(companyMetricSchema.safeParse({ ...valid, value: -Infinity }).success).toBe(false);
    expect(companyMetricSchema.safeParse({ ...valid, value: null, confidence: 'unknown' }).success).toBe(true);
    const plan = prepared(withField('metrics', [{ ...valid, id: 'huge', value: Infinity }, valid]));
    expect(plan.snapshot.metrics.map((m) => m.id)).toEqual([valid.id]);
    expect(plan.skipped).toBe(1);
  });
});

describe('an id that names something every object has is not an id', () => {
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'])('%s', (id) => {
    const file = fixture();
    file.markets = [{ ...file.markets[0]!, id }];
    file.decks = [{ ...file.decks[0]!, marketId: id }];
    const plan = prepared(file);
    expect(plan.snapshot.markets).toEqual([]);
    // Its deck and the deck's cards go with it.
    expect(plan.snapshot.decks).toEqual([]);
    expect(plan.snapshot.cards).toEqual([]);
  });

  it('applies to decks, companies and cards, and to the rows that point at them', () => {
    const deck = fixture(); deck.decks = [{ ...deck.decks[0]!, id: 'toString' }];
    expect(prepared(deck).snapshot.decks).toEqual([]);
    const company = fixture();
    company.companies = company.companies.map((c) => c.id === 'acme' ? { ...c, id: '__proto__' } : c);
    company.metrics = company.metrics.map((m) => m.companyId === 'acme' ? { ...m, companyId: '__proto__' } : m);
    const afterCompany = prepared(company).snapshot;
    expect(afterCompany.companies.map((c) => c.id)).not.toContain('__proto__');
    expect(afterCompany.metrics.some((m) => m.companyId === '__proto__')).toBe(false);
    expect(afterCompany.metrics.some((m) => m.companyId === 'beta')).toBe(true);
    const card = fixture(); card.cards = [{ ...card.cards[0]!, companyId: 'valueOf' }, card.cards[1]!];
    expect(prepared(card).snapshot.cards.map((c) => c.id)).toEqual([card.cards[1]!.id]);
  });

  it('is also left out of the keyed collections', () => {
    const file = fixture();
    file.dashboards = { acme: file.dashboards.acme!, constructor: {}, toString: {} } as never;
    file.companyMarket = { acme: 'Robotics', valueOf: 'x' };
    file.opportunity = { [file.markets[0]!.id]: { markdown: 'm', citations: [], at }, toString: { markdown: 'm', citations: [], at } };
    const plan = prepared(file).snapshot;
    expect(Object.keys(plan.dashboards)).toEqual(['acme']);
    expect(Object.keys(plan.companyMarket)).toEqual(['acme']);
    expect(Object.keys(plan.opportunity)).toEqual([file.markets[0]!.id]);
  });
});

describe('rows that crash a whole page are left out, and counted', () => {
  const tab = (content: unknown) => ({ content, lastRefreshedAt: at });
  const dashboards = (companyTabs: Loose) => prepared(withField('dashboards', { acme: companyTabs }));

  it.each([
    ['history as a list', { history: [1, 2] }],
    ['history as text', { history: 'x' }],
    ['history as a number', { history: 5 }],
    ['history with no content', { history: tab(null) }],
    ['live_intel as a list', { live_intel: [1] }],
    ['live_intel with list content', { live_intel: tab([]) }],
    ['live_intel with no content', { live_intel: tab(null) }],
    ['mission_governance as text', { mission_governance: 'x' }],
    ['mission_governance with text content', { mission_governance: tab('x') }],
    ['mission_governance with no content', { mission_governance: tab(null) }],
    ['a tab with no time', { history: { content: {} } }],
    ['a tab that is a list', { metrics: [] }],
    ['metrics with plain content', { metrics: tab(5) }],
  ])('%s', (_name, tabs) => {
    const plan = dashboards(tabs);
    expect(plan.snapshot.dashboards.acme).toEqual({});
    expect(plan.skipped).toBe(1);
  });

  it('keeps tabs the pages can read, including the older list form of Team & Org', () => {
    const good = { history: tab({ timeline: [] }), live_intel: tab({ items: [] }), mission_governance: tab({}), team_org: tab([{ id: 'p1' }]), overview: tab({ markdown: 'x' }) };
    const plan = dashboards(good);
    expect(plan.snapshot.dashboards.acme).toEqual(good);
    expect(plan.skipped).toBe(0);
  });

  it('leaves out a market analysis that is not one', () => {
    const id = fixture().markets[0]!.id;
    for (const analysis of ['text', 5, [], null, { markdown: 5, at }, { markdown: 'm' }]) {
      const plan = prepared(withField('opportunity', { [id]: analysis }));
      expect(plan.snapshot.opportunity).toEqual({});
      expect(plan.skipped).toBe(1);
    }
    expect(prepared(withField('opportunity', { [id]: { markdown: 'm', at } })).snapshot.opportunity[id]).toEqual({ markdown: 'm', at, citations: [] });
  });

  it('gives every report a list of sources and leaves out the ones that are not sources', () => {
    const report = { id: 'r1', kind: 'deck', subjectId: 'd', title: 't', markdown: 'm', createdAt: at };
    const good = { title: 'SEC', url: 'https://www.sec.gov/x' };
    const plan = prepared(withField('reports', [
      { ...report, id: 'null', citations: null },
      { ...report, id: 'missing' },
      { ...report, id: 'mixed', citations: [good, { title: { a: 1 }, url: 'x' }, 'x', null] },
    ]));
    expect(plan.snapshot.reports.map((r) => [r.id, r.citations])).toEqual([['null', []], ['missing', []], ['mixed', [good]]]);
    expect(plan.skipped).toBe(1 + 3);
  });

  it('keeps a briefing\'s readable updates and insights', () => {
    const update = { companyName: 'Acme', companyId: 'acme', signal: 'high', oneLiner: 'o', detail: 'd', publishedDate: null, citations: [] };
    const briefing = { id: 'b1', marketId: 'm', deckId: 'd', marketName: 'M', headline: 'h', generatedAt: at, windowHours: 24, updates: [update, { ...update, oneLiner: { a: 1 } }, 'x', { ...update, signal: 'loud' }], insights: ['ok', 5, { a: 1 }] };
    const plan = prepared(withField('briefings', [briefing]));
    expect(plan.snapshot.briefings[0]!.updates).toEqual([update]);
    expect(plan.snapshot.briefings[0]!.insights).toEqual(['ok']);
    expect(plan.skipped).toBe(3 + 2);
  });

  it('keeps company entries that are text and leaves the rest out', () => {
    const plan = prepared(withField('companyMarket', { acme: 'Robotics', beta: { a: 1 }, gamma: 5 }));
    expect(plan.snapshot.companyMarket).toEqual({ acme: 'Robotics' });
    expect(plan.skipped).toBe(2);
  });
});
