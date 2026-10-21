/**
 * Latest wins at the lanes that used to fill only EMPTY slots (PLAN-CRAAP 1.3): the quoted lane, the
 * reported lane, recovery, own-site reach and the market-batch fill each settle a figure that meets a
 * held one through the same comparison the verified lane uses. Per site: an older held figure is
 * replaced by a newer incoming one (and kept, dated, in priorFigures); a newer held figure stays
 * against an older incoming one; a current verified row is not replaced by a newer estimate; an
 * aged-out verified row is replaced by a newer figure. Humans are never overwritten. Fakes only.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CompanyMetric } from '@mi/contracts';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';
import type { OriginalSourceReceipt } from './original-source';

const DAY = 86_400_000;
const today = new Date();
const daysAgo = (n: number) => new Date(today.getTime() - n * DAY).toISOString().slice(0, 10);
const longAgo = '2024-03-01';

const page = 'https://www.prnewswire.com/news-releases/openai-raises-series-x.html';
const sentence = 'Today, OpenAI announced a $40 billion financing round, valuing the company at $300 billion.';
const INCOMING = 300_000_000_000;
const HELD = 200_000_000_000;

function snapshot(metrics: CompanyMetric[]): RepoSnapshot {
  const now = today.toISOString();
  return {
    schemaVersion: 2, markets: [], decks: [{ id: 'deck_1', marketId: 'mkt_1' }],
    companies: [{ id: 'cmp_1', name: 'OpenAI', oneLiner: 'Frontier AI research and deployment company.', websiteUrl: 'https://openai.com',
      logoUrl: null, hqLocation: 'San Francisco, CA', brandTheme: null }],
    metrics, cards: [{ id: 'card_1', deckId: 'deck_1', cardType: 'company', companyId: 'cmp_1' }],
    viceClaims: [], dashboards: {}, companyMarket: { cmp_1: 'Frontier AI' }, opportunity: {}, reports: [],
    savedCards: [], researchJobs: [], threads: [], capturedAt: now,
  } as unknown as RepoSnapshot;
}
function memoryStore(initial: RepoSnapshot): ResearchStore {
  let data: RepoSnapshot | null = initial;
  return { read: () => data, write: (snap: RepoSnapshot) => { data = snap; } };
}

/** A held valuation: a quoted estimate, or a verified row, dated `asOf`, on the same publisher as the incoming page. */
function held(kind: 'estimated' | 'verified' | 'user_verified', asOf: string): CompanyMetric {
  const citations = [{ title: 'prnewswire.com', url: page }];
  const base = { id: 'met_val', companyId: 'cmp_1', metricType: 'valuation' as const, value: HELD, source: page, citations,
    methodNote: 'held', capturedAt: today.toISOString() };
  if (kind === 'user_verified') return { ...base, confidence: 'user_verified' };
  if (kind === 'verified') {
    return { ...base, confidence: 'verified', lastVerifiedAt: today.toISOString(),
      passageSupport: { sourceUrl: page, quote: 'We value the company at $200 billion.', asOf, basis: 'valuation', unit: 'USD' } };
  }
  return { ...base, confidence: 'estimated',
    quotedSupport: { sourceUrl: page, quote: 'We value the company at $200 billion.', asOf, value: HELD, unit: 'USD' } };
}

const find = async (repo: GeminiRepository) => (await repo.getCompanyMetrics('cmp_1')).find((m) => m.metricType === 'valuation')!;

describe('quoted lane', () => {
  const dateline = (asOf: string) => new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${asOf}T00:00:00Z`));
  async function hunt(stored: CompanyMetric, incomingAsOf: string, options?: { refreshStale?: boolean }) {
    const read = vi.fn(async (u: string): Promise<OriginalSourceReceipt> => ({ requestedUrl: u, finalUrl: u, status: 'retrieved', httpStatus: 200,
      contentHash: 'b'.repeat(64), retrievedAt: today.toISOString(),
      text: u === page ? `SAN FRANCISCO, ${dateline(incomingAsOf)} /PRNewswire/ -- ${sentence} More text.` : 'Nothing here.' }));
    const ground = vi.fn(async () => ({ text: 'notes', citations: [{ url: page, title: 'PR Newswire' }], queries: [] }));
    const structure = vi.fn(async (_p: string, schema: { parse(v: unknown): unknown }) => schema.parse({ figures: [
      { metricType: 'valuation', value: INCOMING, methodNote: null,
        passageSupport: { sourceUrl: page, quote: sentence, asOf: incomingAsOf, basis: 'valuation', unit: 'USD' } },
    ] }));
    const repo = new GeminiRepository({ apiKey: 'k', store: memoryStore(snapshot([stored])), client: { ground, structure } as unknown as LlmClient,
      originalSourceReader: read, huntStaleFigures: true });
    const result = await repo.huntCompanyMetrics('cmp_1', options);
    return { repo, result };
  }

  it('replaces an older held estimate with a newer quoted figure and keeps the old one, dated', async () => {
    const { repo, result } = await hunt(held('estimated', longAgo), daysAgo(30));
    expect(result.filledTypes).toContain('valuation');
    const row = await find(repo);
    expect(row).toMatchObject({ value: INCOMING, confidence: 'estimated' });
    expect(row.quotedSupport?.asOf).toBe(daysAgo(30));
    expect(row.priorFigures).toHaveLength(1);
    expect(row.priorFigures![0]).toMatchObject({ value: HELD, asOf: longAgo });
  });

  it('keeps a newer held estimate against an older quoted figure', async () => {
    const { repo, result } = await hunt(held('estimated', daysAgo(10)), daysAgo(60));
    expect(result.filledTypes).not.toContain('valuation');
    const row = await find(repo);
    expect(row).toMatchObject({ value: HELD, confidence: 'estimated' });
    expect(row.quotedSupport?.asOf).toBe(daysAgo(10));
    expect(row.priorFigures ?? []).toEqual([]);
  });

  it('does not replace a current verified row with a newer quoted estimate; the newer reading is recorded beside it', async () => {
    const { repo, result } = await hunt(held('verified', daysAgo(40)), daysAgo(5));
    expect(result.filledTypes).not.toContain('valuation');
    const row = await find(repo);
    expect(row).toMatchObject({ value: HELD, confidence: 'verified' });
    expect(row.newerObservation).toMatchObject({ value: INCOMING, asOf: daysAgo(5) });
  });

  it('replaces an aged-out verified row with a newer quoted figure, keeping the old one dated', async () => {
    const { repo, result } = await hunt(held('verified', longAgo), daysAgo(30), { refreshStale: true });
    expect(result.filledTypes).toContain('valuation');
    const row = await find(repo);
    expect(row).toMatchObject({ value: INCOMING, confidence: 'estimated' });
    expect(row.priorFigures![0]).toMatchObject({ value: HELD, confidence: 'verified', asOf: longAgo });
    // The new estimate does not inherit the old row's verification evidence.
    expect(row.passageSupport ?? null).toBeNull();
    expect(row.lastVerifiedAt ?? null).toBeNull();
  });

  it('never overwrites a human figure', async () => {
    const { repo } = await hunt(held('user_verified', longAgo), daysAgo(5));
    expect(await find(repo)).toMatchObject({ value: HELD, confidence: 'user_verified' });
  });
});

// ---- Reported lane (grounded support sentence) and reach rows share one reported-support shape. ----

const REUTERS = 'https://www.reuters.com/technology/skydio-2026';
const REPORTED_HELD = 800;
const REPORTED_NEW = 900;

/** A held Skydio headcount: an estimate backed by a provider support sentence, a verified row, or a human figure. */
function heldHeadcount(kind: 'estimated' | 'verified' | 'user_verified', asOf: string): CompanyMetric {
  const citations = [{ title: 'Reuters', url: REUTERS }];
  const base = { id: 'met_emp', companyId: 'cmp_1', metricType: 'employees' as const, value: REPORTED_HELD, source: REUTERS, citations,
    methodNote: 'held', capturedAt: today.toISOString() };
  if (kind === 'user_verified') return { ...base, confidence: 'user_verified' };
  if (kind === 'verified') {
    return { ...base, confidence: 'verified', lastVerifiedAt: today.toISOString(),
      passageSupport: { sourceUrl: REUTERS, quote: 'Skydio had 800 employees.', asOf, basis: 'employees', unit: 'count' } };
  }
  return { ...base, confidence: 'estimated', reportedSupport: reportedSupportOf(REPORTED_HELD, asOf) };
}

function reportedSupportOf(value: number, asOf: string) {
  return { provider: 'google-search' as const, companyName: 'OpenAI', basis: 'employees' as const, value, unit: 'count' as const, asOf,
    definition: undefined, periodStart: undefined,
    support: { supportIndex: 0, text: `OpenAI had ${value} employees as of ${asOf}.`, sources: [{ chunkIndex: 0, url: REUTERS, title: 'Reuters' }] } };
}

const findHeadcount = async (repo: GeminiRepository) => (await repo.getCompanyMetrics('cmp_1')).find((m) => m.metricType === 'employees')!;

/** Both reported-support sites must give the same four answers: older replaced, newer kept, current verified stays, aged-out replaced. */
describe.each([
  ['reported lane', async (stored: CompanyMetric, incomingAsOf: string, options?: { refreshStale?: boolean }) => {
    const text = `OpenAI had ${REPORTED_NEW} employees as of ${incomingAsOf}.`;
    const unreadable = async (url: string) => ({ requestedUrl: url, status: 'unavailable' as const, retrievedAt: today.toISOString(), reason: 'Public page unavailable' });
    const ground = vi.fn().mockResolvedValue({ text, citations: [], queries: [], grounding: { provider: 'google-search', answerText: text,
      supports: [{ supportIndex: 0, text, sources: [{ chunkIndex: 0, url: REUTERS, title: 'Reuters' }] }] } });
    const structure = vi.fn().mockResolvedValue({ figures: [] });
    const repo = new GeminiRepository({ apiKey: 'k', store: memoryStore(snapshot([stored])), client: { ground, structure } as unknown as LlmClient,
      originalSourceReader: unreadable, huntStaleFigures: true });
    const result = await repo.huntCompanyMetrics('cmp_1', options);
    return { repo, written: result.filledTypes.includes('employees') };
  }],
  ['reach rows', async (stored: CompanyMetric, incomingAsOf: string) => {
    const repo = new GeminiRepository({ apiKey: 'k', store: memoryStore(snapshot([stored])), client: {} as unknown as LlmClient });
    const row: CompanyMetric = { id: 'met_in', companyId: 'cmp_1', metricType: 'employees', value: REPORTED_NEW, confidence: 'estimated', source: REUTERS,
      citations: [{ title: 'Reuters', url: REUTERS }], methodNote: 'reach', capturedAt: today.toISOString(), reportedSupport: reportedSupportOf(REPORTED_NEW, incomingAsOf) };
    const written = (repo as unknown as { applyReachRows(id: string, rows: CompanyMetric[], nowIso: string): string[] })
      .applyReachRows('cmp_1', [row], today.toISOString());
    return { repo, written: written.includes('employees') };
  }],
])('%s', (_name, run) => {
  it('replaces an older held estimate with a newer figure and keeps the old one, dated', async () => {
    const { repo, written } = await run(heldHeadcount('estimated', longAgo), daysAgo(20));
    expect(written).toBe(true);
    const row = await findHeadcount(repo);
    expect(row).toMatchObject({ value: REPORTED_NEW, confidence: 'estimated' });
    expect(row.reportedSupport?.asOf).toBe(daysAgo(20));
    expect(row.priorFigures![0]).toMatchObject({ value: REPORTED_HELD, asOf: longAgo });
  });

  it('keeps a newer held estimate against an older figure', async () => {
    const { repo, written } = await run(heldHeadcount('estimated', daysAgo(10)), daysAgo(90));
    expect(written).toBe(false);
    const row = await findHeadcount(repo);
    expect(row).toMatchObject({ value: REPORTED_HELD, confidence: 'estimated' });
    expect(row.reportedSupport?.asOf).toBe(daysAgo(10));
    expect(row.priorFigures ?? []).toEqual([]);
  });

  it('does not replace a current verified row with a newer estimate', async () => {
    const { repo, written } = await run(heldHeadcount('verified', daysAgo(40)), daysAgo(5));
    expect(written).toBe(false);
    expect(await findHeadcount(repo)).toMatchObject({ value: REPORTED_HELD, confidence: 'verified' });
  });

  it('replaces an aged-out verified row with a newer estimate, keeping the old one dated', async () => {
    const { repo, written } = await run(heldHeadcount('verified', longAgo), daysAgo(20), { refreshStale: true });
    expect(written).toBe(true);
    const row = await findHeadcount(repo);
    expect(row).toMatchObject({ value: REPORTED_NEW, confidence: 'estimated' });
    expect(row.priorFigures![0]).toMatchObject({ value: REPORTED_HELD, confidence: 'verified', asOf: longAgo });
    expect(row.passageSupport ?? null).toBeNull();
    expect(row.lastVerifiedAt ?? null).toBeNull();
  });

  it('never overwrites a human figure', async () => {
    const { repo, written } = await run(heldHeadcount('user_verified', longAgo), daysAgo(5), { refreshStale: true });
    expect(written).toBe(false);
    expect(await findHeadcount(repo)).toMatchObject({ value: REPORTED_HELD, confidence: 'user_verified' });
  });
});

// ---- Market batch fill: a figure that landed while the batch search ran meets the batch's own figure ----

describe('market batch fill', () => {
  const SRC = 'https://www.reuters.com/technology/wingtra-skydio-2026';
  const sentenceW = 'Wingtra AG\n* **Employees:** 127 employees, as of October 2026, reported in the company data profile';
  const sentenceS = "Skydio's valuation was $4.4 billion as of April 23, 2026.";
  const NEWV = 4_400_000_000;
  const HELDV = 3_000_000_000;
  const co = (id: string, name: string, site: string) => ({ id, name, oneLiner: `${name} builds drones.`, websiteUrl: site, logoUrl: null, hqLocation: 'Zurich', brandTheme: null });
  const heldValuation = (kind: 'estimated' | 'verified' | 'user_verified', asOf: string): CompanyMetric => {
    const base = { id: 'met_v', companyId: 'cmp_s', metricType: 'valuation' as const, value: HELDV, source: SRC,
      citations: [{ title: 'Reuters', url: SRC }], methodNote: 'held', capturedAt: today.toISOString() };
    if (kind === 'user_verified') return { ...base, confidence: 'user_verified' };
    if (kind === 'verified') return { ...base, confidence: 'verified', lastVerifiedAt: today.toISOString(),
      passageSupport: { sourceUrl: SRC, quote: 'Skydio is valued at $3 billion.', asOf, basis: 'valuation', unit: 'USD' } };
    return { ...base, confidence: 'estimated', reportedSupport: { provider: 'google-search', companyName: 'Skydio', basis: 'valuation', value: HELDV, unit: 'USD', asOf,
      support: { supportIndex: 0, text: 'Skydio is valued at $3 billion.', sources: [{ chunkIndex: 0, url: SRC, title: 'Reuters' }] } } };
  };
  async function batch(arriving: CompanyMetric) {
    const snap = snapshot([]) as unknown as RepoSnapshot & { companies: unknown[]; cards: unknown[]; companyMarket: Record<string, string> };
    snap.companies = [co('cmp_w', 'Wingtra', 'https://wingtra.com'), co('cmp_s', 'Skydio', 'https://skydio.com')];
    snap.cards = [{ id: 'card_w', deckId: 'deck_1', cardType: 'company', companyId: 'cmp_w' }, { id: 'card_s', deckId: 'deck_1', cardType: 'company', companyId: 'cmp_s' }] as never;
    snap.companyMarket = { cmp_w: 'Drones', cmp_s: 'Drones' };
    const answer = `${sentenceW}\n\n${sentenceS}`;
    const ground = vi.fn().mockResolvedValue({ text: answer, citations: [], queries: [], grounding: { provider: 'google-search', answerText: answer,
      supports: [sentenceW, sentenceS].map((text, i) => ({ supportIndex: i, text, sources: [{ chunkIndex: 0, url: SRC, title: 'Reuters' }] })) } });
    const repoRef: { current?: GeminiRepository } = {};
    const structure = vi.fn(async () => {
      // The concurrent write: a figure lands in the slot while the batch search is running.
      (repoRef.current as unknown as { snap: RepoSnapshot }).snap.metrics.push(arriving);
      return { estimates: [{ companyName: 'Skydio', metricType: 'valuation', value: NEWV, unit: 'USD', asOf: '2026-04-23', methodNote: 'Reuters' }] };
    });
    const repo = new GeminiRepository({ apiKey: 'k', store: memoryStore(snap), now: () => new Date('2026-10-21T00:00:00Z'),
      client: { ground, structure } as unknown as LlmClient });
    repoRef.current = repo;
    const result = await repo.fillMissingMarketEstimates('deck_1');
    const row = (await repo.getCompanyMetrics('cmp_s')).find((m) => m.metricType === 'valuation')!;
    return { row, written: result.filledTypes > 0 };
  }

  it('replaces an older figure that landed meanwhile with the newer batch figure, keeping the old one dated', async () => {
    const { row, written } = await batch(heldValuation('estimated', '2024-03-01'));
    expect(written).toBe(true);
    expect(row).toMatchObject({ value: NEWV, confidence: 'estimated' });
    expect(row.priorFigures![0]).toMatchObject({ value: HELDV, asOf: '2024-03-01' });
  });

  it('keeps a newer figure that landed meanwhile', async () => {
    const { row, written } = await batch(heldValuation('estimated', '2026-08-01'));
    expect(written).toBe(false);
    expect(row).toMatchObject({ value: HELDV, confidence: 'estimated' });
    expect(row.priorFigures ?? []).toEqual([]);
  });

  it('does not replace a current verified row with the batch estimate', async () => {
    const { row, written } = await batch(heldValuation('verified', '2026-02-01'));
    expect(written).toBe(false);
    expect(row).toMatchObject({ value: HELDV, confidence: 'verified' });
  });

  it('replaces an aged-out verified row with the newer batch figure, keeping the old one dated', async () => {
    const { row, written } = await batch(heldValuation('verified', '2024-03-01'));
    expect(written).toBe(true);
    expect(row).toMatchObject({ value: NEWV, confidence: 'estimated' });
    expect(row.priorFigures![0]).toMatchObject({ value: HELDV, confidence: 'verified', asOf: '2024-03-01' });
    expect(row.passageSupport ?? null).toBeNull();
  });

  it('never overwrites a human figure', async () => {
    const { row, written } = await batch(heldValuation('user_verified', '2024-03-01'));
    expect(written).toBe(false);
    expect(row).toMatchObject({ value: HELDV, confidence: 'user_verified' });
  });
});

// ---- Recovery from saved research (no provider call) ----

describe('recovery from saved research', () => {
  const AXIOS = 'https://www.axios.com/2026/09/openai-arr';
  const NOW = new Date('2026-10-21T00:00:00Z');
  const ARR_NEW = 70_000_000_000;
  const ARR_HELD = 50_000_000_000;
  const arr = 'Revenue & Annual Recurring Revenue (ARR)\n* **Annualized Recurring Revenue (ARR):** Approaching **~$70 Billion ARR** as of September 30, 2026, driven by a surge in enterprise contracts and multi-tier subscriptions (Axios / Reuters / Bloomberg)';
  const answer = `### Company Profile: OpenAI, Inc. / OpenAI Group PBC\n**Market Context:** Frontier AI\n\n${arr}`;
  const heldArr = (kind: 'estimated' | 'verified' | 'user_verified', asOf: string): CompanyMetric => {
    const base = { id: 'met_arr', companyId: 'cmp_1', metricType: 'arr' as const, value: ARR_HELD, source: AXIOS,
      citations: [{ title: 'axios.com', url: AXIOS }], methodNote: 'held', capturedAt: NOW.toISOString() };
    if (kind === 'user_verified') return { ...base, confidence: 'user_verified' };
    if (kind === 'verified') {
      return { ...base, confidence: 'verified', lastVerifiedAt: NOW.toISOString(),
        passageSupport: { sourceUrl: AXIOS, quote: 'ARR is $50 billion.', asOf, basis: 'arr', unit: 'USD' } };
    }
    return { ...base, confidence: 'estimated', reportedSupport: { ...reportedSupportOf(ARR_HELD, asOf), basis: 'arr', unit: 'USD',
      companyName: 'OpenAI', support: { supportIndex: 0, text: 'OpenAI ARR is $50 billion.', sources: [{ chunkIndex: 0, url: AXIOS, title: 'axios.com' }] } } };
  };
  async function recover(stored: CompanyMetric) {
    const snap = snapshot([stored]) as unknown as Record<string, unknown>;
    (snap.companies as Array<Record<string, unknown>>)[0]!.name = 'OpenAI, Inc.';
    (snap.companies as Array<Record<string, unknown>>).push({ id: 'cmp_2', name: 'Anthropic PBC', oneLiner: 'AI safety lab', logoUrl: null,
      hqLocation: null, websiteUrl: 'https://anthropic.com', brandTheme: null });
    (snap.companyMarket as Record<string, string>).cmp_2 = 'Frontier AI';
    snap.researchEvidence = [{ id: 'ev_1', companyId: 'cmp_1', companyName: 'OpenAI, Inc.', topic: 'company_profile', capturedAt: '2026-10-05T22:16:29.047Z',
      text: answer, citations: [{ title: 'axios.com', url: AXIOS }], queries: ['OpenAI profile'],
      grounding: { provider: 'google-search', answerText: answer, supports: [{ supportIndex: 0, text: arr, sources: [{ chunkIndex: 0, url: AXIOS, title: 'axios.com' }] }] } }];
    const repo = new GeminiRepository({ apiKey: 'k', store: memoryStore(snap as unknown as RepoSnapshot), now: () => NOW,
      client: { ground: vi.fn(), structure: vi.fn() } as unknown as LlmClient });
    const result = await repo.recoverSavedCompanyMetrics('cmp_1');
    const row = (await repo.getCompanyMetrics('cmp_1')).find((m) => m.metricType === 'arr')!;
    return { row, written: result.filledTypes.includes('arr') };
  }

  it('replaces an older held estimate with the newer saved figure and keeps the old one, dated', async () => {
    const { row, written } = await recover(heldArr('estimated', '2025-01-15'));
    expect(written).toBe(true);
    expect(row).toMatchObject({ value: ARR_NEW, confidence: 'estimated' });
    expect(row.priorFigures![0]).toMatchObject({ value: ARR_HELD, asOf: '2025-01-15' });
  });

  it('keeps a newer held estimate against older saved research', async () => {
    const { row, written } = await recover(heldArr('estimated', '2026-10-10'));
    expect(written).toBe(false);
    expect(row).toMatchObject({ value: ARR_HELD, confidence: 'estimated' });
    expect(row.priorFigures ?? []).toEqual([]);
  });

  it('does not replace a current verified row with a newer saved estimate', async () => {
    const { row, written } = await recover(heldArr('verified', '2026-08-01'));
    expect(written).toBe(false);
    expect(row).toMatchObject({ value: ARR_HELD, confidence: 'verified' });
  });

  it('replaces an aged-out verified row with the newer saved estimate, keeping the old one dated', async () => {
    const { row, written } = await recover(heldArr('verified', '2024-03-01'));
    expect(written).toBe(true);
    expect(row).toMatchObject({ value: ARR_NEW, confidence: 'estimated' });
    expect(row.priorFigures![0]).toMatchObject({ value: ARR_HELD, confidence: 'verified', asOf: '2024-03-01' });
    expect(row.passageSupport ?? null).toBeNull();
  });

  it('never overwrites a human figure', async () => {
    const { row, written } = await recover(heldArr('user_verified', '2024-03-01'));
    expect(written).toBe(false);
    expect(row).toMatchObject({ value: ARR_HELD, confidence: 'user_verified' });
  });
});
