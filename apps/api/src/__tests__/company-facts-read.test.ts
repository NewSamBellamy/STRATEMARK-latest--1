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
async function setup(withOriginal: boolean) {
  const store = new MemoryDataStore();
  const auth = new MockFirebaseAdapter();
  const service = new CloudDeckService(store, auth, auth);
  await service.saveDeck('user_123', 'deck', { deck: { id: 'deck' }, market: {}, cards: [structuredClone(card)] });
  if (withOriginal) await store.saveCompanyOriginal('user_123', 'deck', { id: 'src_00000000-0000-4000-8000-000000000001',
    companyId: 'cmp', metricType: 'company_profile', capturedAt: date,
    receipts: [{ requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200, contentHash: 'a'.repeat(64), text: quote, retrievedAt: date }] });
  const app = createApp(readEnv({ APP_TOKEN: 'app-token' }), { store, cloudDeckService: service, forceMemoryStore: true });
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
