import { expect, it, vi } from 'vitest';
import { buildDataset } from '@mi/mocks';
import type { CardWithCompany, MarketIntelRepository } from '@mi/contracts';
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
