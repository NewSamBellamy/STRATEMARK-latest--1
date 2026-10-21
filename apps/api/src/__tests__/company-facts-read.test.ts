import { beforeEach, expect, it, vi } from 'vitest';
import type { CardWithCompany } from '@mi/contracts';
import { createApp } from '../app';
import { readEnv } from '../env';
import { CloudDeckService, MockFirebaseAdapter } from '../lib/CloudDeckService';
import { MemoryDataStore } from '../lib/firestoreStore';

const url = 'https://sec.gov/Archives/acme';
const date = '2026-10-02T00:00:00.000Z';
const quote = 'Acme reported 45 employees as of 2026-10-01.';
const card: CardWithCompany = { card: { id: 'card', deckId: 'deck', companyId: 'cmp', cardType: 'company',
  tier: 5, tierReason: null, title: null, summary: null, citations: [], keyPoints: [], createdAt: date },
  company: { id: 'cmp', name: 'Acme', oneLiner: 'Software', websiteUrl: 'https://acme.com', logoUrl: null, hqLocation: null, brandTheme: null },
  metrics: [{ id: 'metric', companyId: 'cmp', metricType: 'employees', value: 45, confidence: 'verified',
    citations: [{ title: 'SEC', url }], source: url, capturedAt: date, methodNote: null,
    passageSupport: { sourceUrl: url, quote, basis: 'employees', unit: 'count', asOf: '2026-10-01' } }], viceClaims: [] };
beforeEach(() => vi.restoreAllMocks());
async function setup(withOriginal: boolean, sourceUrl = url, now?: Date, forgeAssessment = false) {
  const store = new MemoryDataStore();
  const auth = new MockFirebaseAdapter();
  const service = new CloudDeckService(store, auth, auth);
  const savedCard = structuredClone(card);
  savedCard.metrics[0]!.source = sourceUrl;
  savedCard.metrics[0]!.citations[0]!.url = sourceUrl;
  savedCard.metrics[0]!.passageSupport!.sourceUrl = sourceUrl;
  if (forgeAssessment) (savedCard.metrics[0] as unknown as Record<string, unknown>).assessment = { effect: 'shown_aged_out', forged: true };
  await service.saveDeck('user_123', 'deck', { deck: { id: 'deck' }, market: {}, cards: [savedCard] });
  if (withOriginal) await store.saveCompanyOriginal('user_123', 'deck', { id: 'src_00000000-0000-4000-8000-000000000001',
    companyId: 'cmp', metricType: 'company_profile', capturedAt: date,
    receipts: [{ requestedUrl: sourceUrl, finalUrl: sourceUrl, status: 'retrieved', httpStatus: 200, contentHash: 'a'.repeat(64), text: quote, retrievedAt: date }] });
  const app = createApp(readEnv({ APP_TOKEN: 'app-token' }), { store, cloudDeckService: service, forceMemoryStore: true,
    ...(now ? { clock: () => now } : {}) });
  await service.saveCard('user_123', 'card', { deckId: 'deck' });
  return { service, app };
}

it.each([false, true])('serves consistent card facts from owned originals, not labels; originals=%s', async withOriginal => {
  const { app, service } = await setup(withOriginal);
  vi.spyOn(service, 'checkEntitlement').mockResolvedValue(false); // retained reads are not paid research
  for (const route of ['/api/cards?deckId=deck', '/api/cards/saved']) {
    const response = await app.request(route, { headers: { Authorization: 'Bearer valid_token' } });
    expect(response.status).toBe(200);
    const result = await response.json() as { cards: CardWithCompany[] };
    expect(result.cards[0]!.metrics[0]!.value).toBe(withOriginal ? 45 : null);
  }
  expect((await service.getDeck('user_123', 'deck'))!.cards[0]!.metrics[0]!.value).toBe(45);
});

it.each([false, true])('serves scoped issuer-backed facts only with owned original support; originals=%s', async withOriginal => {
  const { app } = await setup(withOriginal, 'https://acme.com/report');
  for (const route of ['/api/cards?deckId=deck', '/api/cards/saved']) {
    const response = await app.request(route, { headers: { Authorization: 'Bearer valid_token' } });
    expect(response.status).toBe(200);
    const result = await response.json() as { cards: CardWithCompany[] };
    const metric = result.cards[0]!.metrics[0]!;
    expect(metric.value).toBe(withOriginal ? 45 : null);
    if (withOriginal) expect(metric.methodNote).toContain('not independently corroborated');
  }
});

it.each(['/api/cards?deckId=deck', '/api/cards/saved'])('%s computes the assessment on read with the injected clock', async route => {
  const headers = { Authorization: 'Bearer valid_token' };
  const metricAt = async (now: Date, forge = false) => {
    const { app } = await setup(true, url, now, forge);
    const result = await (await app.request(route, { headers })).json() as { cards: CardWithCompany[] };
    return result.cards[0]!.metrics[0]! as unknown as { value: number | null; confidence: string; assessment?: { effect: string; forged?: boolean } };
  };
  const current = await metricAt(new Date('2026-10-20T12:00:00Z'));
  expect(current.value).toBe(45);
  expect(current.assessment?.effect).not.toBe('shown_aged_out');
  // Same stored data, later clock: the figure is older than the window and is shown as a dated estimate.
  const aged = await metricAt(new Date('2028-01-01T00:00:00Z'));
  expect(aged.confidence).toBe('estimated');
  expect(aged.assessment?.effect).toBe('shown_aged_out');
  // A stored/incoming assessment never survives the read: it is recomputed from the figure.
  const forged = await metricAt(new Date('2026-10-20T12:00:00Z'), true);
  expect(forged.assessment?.forged).toBeUndefined();
  expect(forged.assessment?.effect).not.toBe('shown_aged_out');
});

it('does not expose another owner’s cards or originals', async () => {
  const { app } = await setup(true);
  const response = await app.request('/api/cards?deckId=deck', { headers: { Authorization: 'Bearer valid_other_user' } });
  expect(await response.json()).toEqual({ cards: [] });
});

it('accepts a matching original retained by cloud metric verification without upgrading search notes into evidence', async () => {
  const { app, service } = await setup(false);
  const record = (await service.getDeck('user_123', 'deck'))!;
  await service.saveDeck('user_123', 'deck', { ...record, originalSourceAttempts: [{ companyId: 'cmp', metricType: 'employees',
    capturedAt: date, receipts: [{ requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200,
      contentHash: 'a'.repeat(64), text: quote, retrievedAt: date }] }] });
  const response = await app.request('/api/cards?deckId=deck', { headers: { Authorization: 'Bearer valid_token' } });
  const result = await response.json() as { cards: CardWithCompany[] };
  expect(result.cards[0]!.metrics[0]!.value).toBe(45);
  const sources = service.getOriginalSources('user_123', 'deck', vi.fn());
  expect(await sources.list({ companyId: 'cmp', metricType: 'employees' })).toHaveLength(1);
  expect(await sources.list({ companyId: 'other' })).toEqual([]);
});

it('resolves legacy saved references from owned decks and reports unresolvable bookmarks without inventing cards', async () => {
  const { app, service } = await setup(true);
  await service.saveCard('user_123', 'card'); // earlier clients did not retain deckId
  await service.saveCard('user_123', 'missing', { deckId: 'foreign_or_deleted' });
  const response = await app.request('/api/cards/saved', { headers: { Authorization: 'Bearer valid_token' } });
  const result = await response.json() as { cards: CardWithCompany[]; unresolvedCount: number };
  expect(result.cards).toHaveLength(1);
  expect(result.cards[0]!.card.id).toBe('card');
  expect(result.cards[0]!.metrics[0]!.value).toBe(45);
  expect(result.unresolvedCount).toBe(1);
});

it.each(['/api/cards?deckId=deck', '/api/cards/saved'])('%s reads a figure on another deck company’s site as a competitor page', async route => {
  const store = new MemoryDataStore();
  const auth = new MockFirebaseAdapter();
  const service = new CloudDeckService(store, auth, auth);
  const rivalUrl = 'https://blog.rival.com/acme';
  const onRival = { ...structuredClone(card.metrics[0]!), confidence: 'estimated', source: rivalUrl, citations: [{ title: 'rival', url: rivalUrl }],
    passageSupport: null, reportedSupport: null, lastVerifiedAt: null };
  const acme = { ...structuredClone(card), metrics: [onRival] } as unknown as CardWithCompany;
  const rival: CardWithCompany = { ...structuredClone(card), card: { ...card.card, id: 'card2', companyId: 'rv' },
    company: { ...card.company!, id: 'rv', name: 'Rival', websiteUrl: 'https://www.rival.com/' }, metrics: [] };
  await service.saveDeck('user_123', 'deck', { deck: { id: 'deck' }, market: {}, cards: [acme, rival] });
  await store.saveCompanyOriginal('user_123', 'deck', { id: 'src_00000000-0000-4000-8000-000000000002', companyId: 'cmp',
    metricType: 'company_profile', capturedAt: date,
    receipts: [{ requestedUrl: rivalUrl, finalUrl: rivalUrl, status: 'retrieved', httpStatus: 200, contentHash: 'a'.repeat(64), text: quote, retrievedAt: date }] });
  const app = createApp(readEnv({ APP_TOKEN: 'app-token' }), { store, cloudDeckService: service, forceMemoryStore: true,
    clock: () => new Date('2026-10-20T12:00:00Z') });
  await service.saveCard('user_123', 'card', { deckId: 'deck' });
  const result = await (await app.request(route, { headers: { Authorization: 'Bearer valid_token' } })).json() as { cards: CardWithCompany[] };
  const served = result.cards.find(row => row.card.id === 'card')!.metrics[0]! as unknown as { assessment?: { purpose: { kind: string } } };
  expect(served.assessment?.purpose.kind).toBe('competitor');
});
