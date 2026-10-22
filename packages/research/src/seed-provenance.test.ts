import { describe, expect, it } from 'vitest';
import type { Deck } from '@mi/contracts';
import type { CompanyCandidate } from './types';
import { buildStubs } from './pipeline';

const deck = { id: 'dck_seed' } as Deck;

describe('seeded metric provenance (Rule 9)', () => {
  it('never stores a seeded figure as verified when it has no citation', () => {
    const candidate: CompanyCandidate = {
      name: 'Acme Robotics',
      domain: 'acme-robotics.example',
      descriptor: 'Warehouse robots for mid-size logistics firms',
      cardTypes: ['company'],
      reportedValuation: 1_200_000_000,
      reportedArr: 40_000_000,
      reportedHeadcount: 310,
    };
    const stub = buildStubs([candidate], deck)[0]!;
    expect(stub.metrics.map((m) => m.metricType).sort()).toEqual(['arr', 'employees', 'valuation']);
    for (const metric of stub.metrics) {
      expect(metric.confidence).not.toBe('verified');
      expect(metric.citations).toEqual([]);
    }
    // Values are untouched: only the claim about them drops.
    expect(stub.metrics.find((m) => m.metricType === 'valuation')?.value).toBe(1_200_000_000);
    expect(stub.metrics.find((m) => m.metricType === 'arr')?.value).toBe(40_000_000);
    expect(stub.metrics.find((m) => m.metricType === 'employees')?.value).toBe(310);
  });
});
