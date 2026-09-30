import { describe, expect, it } from 'vitest';
import { tierReviewBatchPrompt, tierReviewPrompt } from './prompts';

describe('tier review prompts', () => {
  it('frames batch review as a limited size-signal consistency check', () => {
    const prompt = tierReviewBatchPrompt('AI tools', [
      { name: 'Example Co', baseTier: 4, evidence: '$10M ARR; 100 employees' },
    ]);

    expect(prompt).toContain('size-signal bands');
    expect(prompt).toContain('not a competitive ranking');
    expect(prompt).toContain(
      'Do not infer growth, product-market fit, profitability, or leadership',
    );
    expect(prompt).not.toContain('category-defining titan');
  });

  it('frames single-company review as a limited size-signal consistency check', () => {
    const prompt = tierReviewPrompt('Example Co', 4, '$10M ARR; 100 employees');

    expect(prompt).toContain('size-signal band 4');
    expect(prompt).toContain(
      'not a measure of growth, product-market fit, profitability, or leadership',
    );
    expect(prompt).not.toContain('maturity tier');
  });
});
