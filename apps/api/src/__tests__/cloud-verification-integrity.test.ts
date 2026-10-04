import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { readEnv } from '../env';
import { CloudDeckService, MockFirebaseAdapter } from '../lib/CloudDeckService';
import { MemoryDataStore } from '../lib/firestoreStore';
import { resolveClient } from '../lib/client';
import type { CardWithCompany, CompanyMetric } from '@mi/contracts';

vi.mock('../lib/client', async (original) => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...await original<typeof import('../lib/client')>(), resolveClient: vi.fn(),
}));

const citation = { title: 'Filing', url: 'https://sec.gov/Archives/report', credibility: 'primary' as const };
const capturedAt = '2026-08-01T00:00:00.000Z';
const lastVerifiedAt = '2026-08-02T00:00:00.000Z';
afterEach(() => vi.clearAllMocks());

async function run(out: { verdict: string; currentValue: number | null }, patch: Partial<CompanyMetric> = {}, correction?: unknown) {
  const store = new MemoryDataStore();
  const auth = new MockFirebaseAdapter();
  const service = new CloudDeckService(store, auth, auth);
  const app = createApp(readEnv({ GEMINI_API_KEY: 'test-key', APP_TOKEN: 'app-token' }), {
    store, cloudDeckService: service, forceMemoryStore: true,
  });
  const ground = vi.fn().mockResolvedValue({ text: 'Research notes', citations: [citation] });
  const structure = vi.fn().mockResolvedValue({ ...out, rationale: 'Test result', methodNote: null });
  vi.mocked(resolveClient).mockReturnValue({ client: { ground, structure }, keySource: 'server' } as unknown as ReturnType<typeof resolveClient>);
  await service.saveDeck('user_123', 'deck_test', {
    deck: { id: 'deck_test' }, market: { id: 'deck_test' }, state: { status: 'ready' },
    cards: [{
      card: { id: 'card_test', deckId: 'deck_test', companyId: 'company_test', cardType: 'company' },
      company: { id: 'company_test', name: 'Example Company', oneLiner: 'Test company' },
      metrics: [{ id: 'metric_test', companyId: 'company_test', metricType: 'arr', value: 100,
        confidence: 'verified', citations: [citation], source: citation.url, methodNote: null,
        capturedAt, lastVerifiedAt, ...patch }], viceClaims: [],
    }] as unknown as CardWithCompany[],
  });
  const response = await app.request('/api/research/verify', {
    method: 'POST', headers: { Authorization: 'Bearer valid_token', 'X-Stratemark-Token': 'app-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ deckId: 'deck_test', companyId: 'company_test', metricType: patch.metricType ?? 'arr', correction }),
  });
  expect(response.status).toBe(200);
  const result = await response.json() as { metric: CompanyMetric; verdict: string; changed: boolean };
  const stored = (await service.getDeck('user_123', 'deck_test'))!.cards![0]!.metrics[0]!;
  return { result, stored, ground, structure };
}

describe('cloud metric verification integrity', () => {
  it.each([
    { verdict: 'unverified', currentValue: 900 },
    { verdict: 'supported', currentValue: 900 },
    { verdict: 'contradicted', currentValue: 100 },
    { verdict: 'supported', currentValue: null },
    { verdict: 'contradicted', currentValue: -10 },
  ])('retains the number and support dates on an inconsistent result: %j', async (out) => {
    const { result, stored } = await run(out);
    expect(result.verdict).toBe('unverified');
    expect(stored.value).toBe(100);
    expect(stored.confidence).toBe('estimated');
    expect(stored.capturedAt).toBe(capturedAt);
    expect(stored.lastVerifiedAt).toBe(lastVerifiedAt);
    expect(stored.lastVerificationAttemptAt).toBeTruthy();
  });

  it('persists an inconclusive attempt even when the metric was already unknown', async () => {
    const { stored } = await run({ verdict: 'unverified', currentValue: null }, { confidence: 'unknown', value: null });
    expect(stored.value).toBeNull();
    expect(stored.lastVerifiedAt).toBe(lastVerifiedAt);
    expect(stored.lastVerificationAttemptAt).toBeTruthy();
  });

  it('never rewrites human-reviewed values or support dates', async () => {
    const { stored } = await run({ verdict: 'contradicted', currentValue: 900 }, { confidence: 'user_verified' });
    expect(stored.value).toBe(100);
    expect(stored.confidence).toBe('user_verified');
    expect(stored.lastVerifiedAt).toBe(lastVerifiedAt);
    expect(stored.lastVerificationAttemptAt).toBeTruthy();
  });

  it.each([-20, '900'])('does not apply an invalid shortcut value %s', async (value) => {
    const { stored, ground } = await run({ verdict: 'unverified', currentValue: null }, {}, { value, citations: [citation] });
    expect(ground).toHaveBeenCalledTimes(1);
    expect(stored.value).toBe(100);
    expect(stored.lastVerifiedAt).toBe(lastVerifiedAt);
  });

  it('does not apply a market-share shortcut above 100', async () => {
    const { stored, ground } = await run({ verdict: 'unverified', currentValue: null }, { metricType: 'market_share', value: 20 }, { value: 101, citations: [citation] });
    expect(ground).toHaveBeenCalledTimes(1);
    expect(stored.value).toBe(20);
  });

  it('keeps the valid correction shortcut free of additional model calls', async () => {
    const { stored, ground, structure } = await run({ verdict: 'unverified', currentValue: null }, {}, { value: 200, citations: [citation] });
    expect(stored.value).toBe(200);
    expect(stored.lastVerificationAttemptAt).toBeTruthy();
    expect(stored.lastVerifiedAt).not.toBe(lastVerifiedAt);
    expect(ground).not.toHaveBeenCalled();
    expect(structure).not.toHaveBeenCalled();
  });

  it('supports a real zero without declaring it a changed value', async () => {
    const { result, stored } = await run({ verdict: 'supported', currentValue: 0 }, { value: 0 });
    expect(result.verdict).toBe('supported');
    expect(result.changed).toBe(false);
    expect(stored.lastVerifiedAt).not.toBe(lastVerifiedAt);
  });

  it.each([false, true])('attaches support when confirming an existing estimate (shortcut=%s)', async (shortcut) => {
    const { result, stored } = await run({ verdict: 'supported', currentValue: 100 },
      { confidence: 'estimated', source: null, citations: [] },
      shortcut ? { value: 100, citations: [citation], rationale: 'Confirmed in filing' } : undefined);
    expect(result.verdict).toBe('supported');
    expect(result.changed).toBe(true); // evidence/confidence changed, not the number
    expect(stored.value).toBe(100);
    expect(stored.confidence).toBe('verified');
    expect(stored.source).toBe(citation.url);
    expect(stored.citations).toEqual([citation]);
    expect(stored.capturedAt).toBe(capturedAt);
  });
});
