import { describe, expect, it, vi } from 'vitest';
import { runLivingDeckEngine } from '../engine';
import { runSignalWatcher } from '../delta-agent';
import { createAdkTelemetry } from '../telemetry';
import type { LlmClient, MarketPlan } from '../../types';
import type { OriginalSourceServices } from '../../original-source';
import { extractProviderGrounding } from '../../grounding-support';

vi.mock('../../logos', () => ({ faviconUrl: () => null, resolveLogo: async () => ({ url: null }) }));
const url = 'https://sec.gov/Archives/acme';
const quote = 'Acme Inc. reported 45 employees as of 2026-10-01.';
const plan: MarketPlan = { marketName: 'Software', vertical: 'SaaS', geography: null, notes: null, searchThemes: [] };
function fixture(proof = false) {
  const description = 'Acme Inc. builds software for distributed product teams.';
  const text = `${description}\n${quote}`;
  const grounding = extractProviderGrounding(text, {
    groundingChunks: [{ web: { uri: url, title: 'SEC' } }],
    groundingSupports: [description, quote].map(passage => ({ segment: { text: passage,
      startIndex: text.indexOf(passage), endIndex: text.indexOf(passage) + passage.length }, groundingChunkIndices: [0] })),
  });
  const client: LlmClient = {
    ground: vi.fn(async () => ({ text, citations: [{ title: 'SEC', url }], queries: [], ...(proof ? { grounding } : {}) })),
    structure: vi.fn(async (prompt, schema) => schema.parse(prompt.includes('"companies"')
      ? { companies: [{ name: 'Acme Inc.', domain: 'acme.com', descriptor: 'Software', cardTypes: ['company'] }] }
      : prompt.includes('BASE TIER') ? { nudge: 1, reason: 'Model opinion' }
        : { metrics: { employees: { value: 45, confidence: 'verified', sourceIndex: 0,
          reportedClaim: { sourceUrl: url, quote, asOf: '2026-10-01', basis: 'employees', definition: 'employees', unit: 'count' },
        } }, facts: { headcount: 45 } })) as LlmClient['structure'],
  };
  const sources: OriginalSourceServices = {
    retrieve: vi.fn(async (requestedUrl: string) => ({ requestedUrl, finalUrl: requestedUrl, status: 'retrieved' as const,
      httpStatus: 200, contentHash: 'a'.repeat(64), text: quote, retrievedAt: '2026-10-04T00:00:00.000Z' })),
    save: vi.fn(async () => {}), list: async () => [],
  };
  return { client, sources };
}
describe('ADK provider-supported publication before supplementary originals', () => {
  it('rejects citation-only model figures in streamed metrics without doing original reads', async () => {
    const { client, sources } = fixture();
    const events: unknown[] = [];
    const run = await runLivingDeckEngine({ client, plan, deckId: 'deck_a', watch: false,
      maxCandidates: 1, originalSources: sources, onEvent: (event) => events.push(event) });
    expect(run.hydrated).toHaveLength(1);
    expect(run.hydrated[0]!.metrics.every((metric) => metric.value === null && metric.confidence === 'unknown')).toBe(true);
    expect(sources.retrieve).not.toHaveBeenCalled();
    expect(sources.save).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({ type: 'card', result: run.hydrated[0] }));
  });
  it('retains supported headcount but never synthesizes ARR in the real engine', async () => {
    const { client, sources } = fixture(true);
    const run = await runLivingDeckEngine({ client, plan, deckId: 'deck_a', watch: false,
      maxCandidates: 1, originalSources: sources });
    expect(run.hydrated[0]!.metrics.find((metric) => metric.metricType === 'employees')).toMatchObject({ value: 45,
      confidence: 'estimated', passageSupport: null, lastVerifiedAt: null,
      reportedSupport: { provider: 'google-search', support: { text: quote, sources: [{ chunkIndex: 0, url }] } } });
    expect(run.hydrated[0]!.metrics.find((metric) => metric.metricType === 'arr')).toMatchObject({ value: null, confidence: 'unknown' });
    expect(run.hydrated[0]!.company.oneLiner).toBe('Acme Inc. builds software for distributed product teams.');
    expect(sources.retrieve).not.toHaveBeenCalled();
    expect(sources.save).not.toHaveBeenCalled();
  });
  it('publishes provider-supported facts even when the supplementary original store is unavailable', async () => {
    const { client, sources } = fixture(true);
    sources.save = vi.fn(async () => { throw new Error('Evidence storage unavailable'); });
    const onEvent = vi.fn();
    const run = await runLivingDeckEngine({ client, plan, deckId: 'deck_a', watch: false,
      maxCandidates: 1, originalSources: sources, onEvent });
    expect(run.hydrated).toHaveLength(1);
    expect(run.hydrated[0]!.metrics.find(metric => metric.metricType === 'employees')).toMatchObject({ value: 45,
      confidence: 'estimated', reportedSupport: { support: { text: quote } } });
    expect(run.enrichmentFailures).toHaveLength(0);
    expect(onEvent.mock.calls.some(([event]) => event.type === 'card')).toBe(true);
    expect(sources.retrieve).not.toHaveBeenCalled();
    expect(sources.save).not.toHaveBeenCalled();
  });
  it('keeps watcher growth under the same numeric gate rather than bypassing it', async () => {
    const { client, sources } = fixture(true);
    const run = await runSignalWatcher({ client, plan, deckId: 'deck_a', originalSources: sources,
      telemetry: createAdkTelemetry(), maxIterations: 1, focusQueue: [{ cardType: 'company' }] });
    expect(run.cards).toHaveLength(1);
    expect(run.cards[0]!.metrics.find(metric => metric.metricType === 'employees')).toMatchObject({ value: 45,
      confidence: 'estimated', reportedSupport: { support: { text: quote } } });
    expect(run.cards[0]!.metrics.find(metric => metric.metricType === 'arr')).toMatchObject({ value: null, confidence: 'unknown' });
    expect(sources.retrieve).not.toHaveBeenCalled();
    expect(sources.save).not.toHaveBeenCalled();
  });
  it('does not upgrade citation-only watcher figures into reported support', async () => {
    const { client, sources } = fixture(false);
    const run = await runSignalWatcher({ client, plan, deckId: 'deck_a', originalSources: sources,
      telemetry: createAdkTelemetry(), maxIterations: 1, focusQueue: [{ cardType: 'company' }] });
    expect(run.cards).toHaveLength(1);
    expect(run.cards[0]!.metrics.find(metric => metric.metricType === 'employees')).toMatchObject({ value: null,
      confidence: 'unknown', reportedSupport: null });
    expect(sources.retrieve).not.toHaveBeenCalled();
    expect(sources.save).not.toHaveBeenCalled();
  });
});
