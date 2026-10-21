/**
 * With HUNT_STALE_FIGURES off (owner decision D6) a hunt asks for exactly what it asked for
 * before any currency work: asking for a stale refresh changes no target and no model call.
 * The stored verified row below is long out of date; it is still "verified" for choosing targets.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, type RepoSnapshot } from './repository';
import { HUNT_STALE_FIGURES } from './metric-assessment';
import type { LlmClient } from './types';

const OLD = '2023-01-05T00:00:00.000Z';
const NOW = new Date('2026-10-20T12:00:00Z');

function snapshot(): RepoSnapshot {
  return {
    schemaVersion: 2, markets: [], decks: [],
    companies: [{ id: 'cmp_1', name: 'OpenAI', oneLiner: 'Frontier AI research and deployment company.', websiteUrl: 'https://openai.com',
      logoUrl: null, hqLocation: null, brandTheme: null }],
    metrics: [
      { id: 'met_arr', companyId: 'cmp_1', metricType: 'arr', value: 13_000_000_000, confidence: 'verified', source: 'https://reuters.com/x',
        citations: [{ title: 'reuters.com', url: 'https://reuters.com/x' }], methodNote: null, capturedAt: OLD, lastVerifiedAt: OLD,
        staleAfterSeconds: 86_400, passageSupport: { sourceUrl: 'https://reuters.com/x', quote: 'q', asOf: '2023-01-05', value: 13_000_000_000, unit: 'USD', basis: 'arr' } },
      { id: 'met_emp', companyId: 'cmp_1', metricType: 'employees', value: 900, confidence: 'estimated', source: 'https://example.com/e',
        citations: [{ title: 'example.com', url: 'https://example.com/e' }], methodNote: null, capturedAt: OLD },
    ],
    cards: [], viceClaims: [], dashboards: {}, companyMarket: { cmp_1: 'Frontier AI' }, opportunity: {}, reports: [], savedCards: [],
    researchJobs: [], threads: [],
  } as unknown as RepoSnapshot;
}

async function huntWith(options: Parameters<GeminiRepository['huntCompanyMetrics']>[1]) {
  const snap = snapshot();
  const ground = vi.fn(async (_prompt: string) => ({ text: 'No reliable figure.', citations: [], queries: [] }));
  const structure = vi.fn(async (_prompt: string, schema: { parse: (v: unknown) => unknown }) => schema.parse({ figures: [] }));
  const client = { ground, structure } as unknown as LlmClient;
  const repo = new GeminiRepository({ apiKey: 'test-placeholder', store: { read: () => snap, write: () => undefined }, client, now: () => NOW });
  await repo.huntCompanyMetrics('cmp_1', options);
  return { ground, structure, snap };
}

describe('hunt targets and model calls with HUNT_STALE_FIGURES off', () => {
  it('is off by default', () => expect(HUNT_STALE_FIGURES).toBe(false));

  it('a stale-refresh request changes no prompt and no call count', async () => {
    const plain = await huntWith(undefined);
    const refresh = await huntWith({ refreshStale: true });
    expect(refresh.ground.mock.calls.map(([p]) => p)).toEqual(plain.ground.mock.calls.map(([p]) => p));
    expect(refresh.structure).toHaveBeenCalledTimes(plain.structure.mock.calls.length);
    expect(plain.ground).toHaveBeenCalled();
  });

  it('does not hunt the long-stale verified figure, and holds the estimated one as a dated line', async () => {
    const { ground } = await huntWith({ refreshStale: true });
    const prompt = String(ground.mock.calls[0]![0]);
    const wanted = prompt.slice(prompt.indexOf('metrics of OpenAI:'), prompt.indexOf('Company: OpenAI'));
    expect(wanted).not.toMatch(/\bARR\b/);
    expect(wanted).toContain('Employees');
    expect(prompt).toContain('we already hold 900 with no date (example.com)');
    expect(prompt).not.toMatch(/\b20(2\d)\b.*latest|latest.*\b20(2\d)\b/i);
  });

  it('never rewrites the stale stored row', async () => {
    const before = snapshot().metrics.find((m) => m.metricType === 'arr');
    const { snap } = await huntWith({ refreshStale: true });
    expect(snap.metrics.find((m) => m.metricType === 'arr')).toEqual(before);
  });
});
