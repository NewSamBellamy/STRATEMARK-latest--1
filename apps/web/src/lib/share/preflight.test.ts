import { expect, it, vi } from 'vitest';
import { buildDataset } from '@mi/mocks';
import type { CardWithCompany, MarketIntelRepository } from '@mi/contracts';
import { projectCompanyCardFacts } from '@mi/research';
import { verifyCardForShare } from './preflight';

it('packages accepted facts after checks rather than resurrecting raw verification labels', async () => {
  const data = buildDataset();
  const metric = { ...data.metrics[0]!, confidence: 'estimated' as const, value: 123 };
  const card: CardWithCompany = { card: data.cards[0]!, company: data.companies[0]!, viceClaims: [], metrics: [metric] };
  const raw = vi.fn().mockResolvedValue([{ ...metric, confidence: 'verified' }]);
  const facts = vi.fn().mockResolvedValue([{ ...metric, value: null, confidence: 'unknown' }]);
  const repo = { verifyMetric: vi.fn(), getCompanyMetrics: raw, getCompanyFacts: facts } as unknown as MarketIntelRepository;
  const result = await verifyCardForShare(repo, card, vi.fn());
  expect(result.metrics[0]!.value).toBeNull();
  expect(raw).not.toHaveBeenCalled();
});

it('offline fallback composes the same read-time facts as the card path, discarding a forged assessment', async () => {
  const now = new Date('2026-10-20T12:00:00Z');
  const data = buildDataset();
  const base = data.metrics[0]!;
  const forged = {
    ...base,
    metricType: 'employees' as const,
    value: 900,
    confidence: 'estimated' as const,
    asOf: '2026-09-01',
    assessment: { effect: 'none', forged: true },
  };
  const card = {
    card: data.cards[0]!,
    company: data.companies[0]!,
    viceClaims: [],
    metrics: [forged],
  } as unknown as CardWithCompany;
  const repo = { verifyMetric: vi.fn() } as unknown as MarketIntelRepository; // no getCompanyFacts → fallback
  const result = await verifyCardForShare(repo, card, vi.fn(), now);
  expect(result.metrics).toEqual(projectCompanyCardFacts(card, [], { now }).metrics);
  for (const m of result.metrics) expect((m.assessment as { forged?: boolean } | undefined)?.forged).toBeUndefined();
});
