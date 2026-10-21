import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectCompanyCardFacts } from '@mi/research';
import { SentinelRepository } from './SentinelRepository';
import * as api from '@/lib/sentinelApi';

const url = 'https://sec.gov/Archives/acme';
const date = '2026-10-02T00:00:00.000Z';
const quote = 'Acme reported 45 employees as of 2026-10-01.';
const metric = { id: 'metric', companyId: 'cmp', metricType: 'employees', value: 45, confidence: 'verified',
  source: url, citations: [{ title: 'SEC', url }], methodNote: null, capturedAt: date,
  passageSupport: { sourceUrl: url, quote, basis: 'employees', unit: 'count', asOf: '2026-10-01' } };
const payload = { deck: { id: 'deck', marketId: 'market', createdAt: date }, market: { id: 'market', name: 'Software' },
  companies: [], metrics: [], viceClaims: [],
  cards: [{ card: { id: 'card', deckId: 'deck', companyId: 'cmp', cardType: 'company', tier: 5, createdAt: date,
    title: null, summary: null, tierReason: null, citations: [], keyPoints: [] },
    company: { id: 'cmp', name: 'Acme', oneLiner: 'Software', websiteUrl: 'https://acme.com', logoUrl: null, hqLocation: null, brandTheme: null },
    metrics: [metric], viceClaims: [] }],
  companySourceAttempts: [{ id: 'src_test', companyId: 'cmp', metricType: 'company_profile', capturedAt: date,
    receipts: [{ requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200, retrievedAt: date,
      contentHash: 'a'.repeat(64), text: quote }] }] };
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

it('revalidates cloud deck facts online, on inspection, and after offline reopen without deleting raw observations', async () => {
  vi.spyOn(api, 'getCloudDeck').mockResolvedValue(payload);
  const repo = new SentinelRepository();
  await repo.getDeckByMarket('market');
  expect((await repo.listCards('deck'))[0]!.metrics[0]!.value).toBe(45);
  expect((await repo.getCompanyFacts('cmp'))[0]!.value).toBe(45);
  const offline = new SentinelRepository();
  expect((await offline.listCards('deck'))[0]!.metrics[0]!.value).toBe(45);
  const cache = JSON.parse(localStorage.getItem('mi.cloud.cache.v1')!);
  delete cache.deck.companySourceAttempts;
  delete cache.market.companySourceAttempts;
  localStorage.setItem('mi.cloud.cache.v1', JSON.stringify(cache));
  vi.spyOn(api, 'getCloudDeck').mockRejectedValue(new Error('Offline'));
  const reopened = new SentinelRepository();
  expect((await reopened.listCards('deck'))[0]!.metrics[0]!.value).toBeNull();
  expect((await reopened.getCard('card'))!.metrics[0]!.value).toBeNull();
  expect((await reopened.getCompanyFacts('cmp'))[0]!.value).toBeNull();
  expect((await reopened.getCompanyMetrics('cmp'))[0]!.value).toBe(45);
});

it('hydrates saved-card evidence and makes the same company facts available to its dashboard', async () => {
  vi.spyOn(api, 'listCloudSavedCards').mockResolvedValue(payload.cards.map(card => ({ ...card,
    companySourceAttempts: payload.companySourceAttempts })));
  const repo = new SentinelRepository();
  expect((await repo.listSavedCards())[0]!.metrics[0]!.value).toBe(45);
  expect((await repo.getCompanyFacts('cmp'))[0]!.value).toBe(45);
});

it('does not treat legacy cloud verification labels or another company’s documents as fact evidence', async () => {
  vi.spyOn(api, 'getCloudDeck').mockResolvedValue({ ...payload,
    companySourceAttempts: payload.companySourceAttempts.map(row => ({ ...row, companyId: 'other' })) });
  const repo = new SentinelRepository();
  await repo.getDeckByMarket('market');
  expect((await repo.listCards('deck'))[0]!.metrics[0]!.value).toBeNull();
  expect((await repo.getCompanyMetrics('cmp'))[0]!.value).toBe(45);
});

describe('facts are assessed on read with the injected clock (parity with the shared composition)', () => {
  const NOW = new Date('2026-10-20T12:00:00Z');
  const cardWith = (metrics: unknown[], cardType = 'company') => ({ ...payload.cards[0]!, card: { ...payload.cards[0]!.card, cardType }, metrics });
  const forged = { version: 1, summary: 'Forged: perfect.', verdict: 'strong', effect: 'none', score: 100 };
  it('serves the same facts as projectCompanyCardFacts for the same input, with the assessment computed now', async () => {
    vi.spyOn(api, 'getCloudDeck').mockResolvedValue({ ...payload, cards: [cardWith([metric])] });
    const repo = new SentinelRepository(() => NOW);
    await repo.getDeckByMarket('market');
    const served = (await repo.listCards('deck'))[0]!;
    expect(served.metrics).toEqual(projectCompanyCardFacts(cardWith([metric]) as never, payload.companySourceAttempts, { now: NOW }).metrics);
    expect(served.metrics[0]!.assessment!.assessedAt).toBe(NOW.toISOString());
  });
  it('discards an assessment carried by the cached card and recomputes it', async () => {
    vi.spyOn(api, 'getCloudDeck').mockResolvedValue({ ...payload, cards: [cardWith([{ ...metric, assessment: forged }])] });
    const repo = new SentinelRepository(() => NOW);
    await repo.getDeckByMarket('market');
    const shown = (await repo.listCards('deck'))[0]!.metrics[0]!;
    expect(shown.assessment!.summary).not.toContain('Forged');
    expect(shown.assessment!.currency.state).toBe('current');
  });
  it('shows an old figure as a dated aged-out estimate instead of dropping it', async () => {
    vi.spyOn(api, 'getCloudDeck').mockResolvedValue({ ...payload, cards: [cardWith([metric])] });
    const repo = new SentinelRepository(() => new Date('2028-01-01T00:00:00Z'));
    await repo.getDeckByMarket('market');
    const shown = (await repo.listCards('deck'))[0]!.metrics[0]!;
    expect(shown).toMatchObject({ value: 45, confidence: 'estimated' });
    expect(shown.assessment!.effect).toBe('shown_aged_out');
  });
  it('gives a signal card no facts', async () => {
    vi.spyOn(api, 'getCloudDeck').mockResolvedValue({ ...payload, cards: [cardWith([metric], 'culture')] });
    const repo = new SentinelRepository(() => NOW);
    await repo.getDeckByMarket('market');
    expect((await repo.listCards('deck'))[0]!.metrics).toEqual([]);
  });
});

it('uses already-retained cloud verification originals without fetching or trusting diagnostic labels', async () => {
  const { id: _id, ...diagnostic } = payload.companySourceAttempts[0]!;
  void _id;
  vi.spyOn(api, 'getCloudDeck').mockResolvedValue({ ...payload, companySourceAttempts: [], originalSourceAttempts: [diagnostic] });
  const repo = new SentinelRepository();
  await repo.getDeckByMarket('market');
  expect((await repo.listCards('deck'))[0]!.metrics[0]!.value).toBe(45);
  expect((await repo.getCompanyFacts('cmp'))[0]!.value).toBe(45);
});
