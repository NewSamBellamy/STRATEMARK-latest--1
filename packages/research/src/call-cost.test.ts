import { describe, expect, it } from 'vitest';
import { callCostUsd, priceFamily, readUsage } from './call-cost';

describe('readUsage', () => {
  it('adds search-result prompt tokens to input and thinking tokens to output', () => {
    expect(readUsage({ promptTokenCount: 1000, toolUsePromptTokenCount: 4000, candidatesTokenCount: 300, thoughtsTokenCount: 700 }))
      .toEqual({ inputTokens: 5000, outputTokens: 1000 });
  });
  it('reads nothing from a missing, empty or malformed report', () => {
    for (const meta of [undefined, null, 'x', {}, { promptTokenCount: 'many' }, { promptTokenCount: NaN }]) expect(readUsage(meta)).toBeUndefined();
  });
});

describe('callCostUsd', () => {
  it('prices tokens by model family at the high list price', () => {
    expect(priceFamily('gemini-flash-lite-latest')).toBe('lite');
    expect(priceFamily('gemini-3.7-flash')).toBe('flash');
    expect(priceFamily('gemini-3.1-pro-preview')).toBe('pro');
    expect(priceFamily('something-new')).toBe('pro');
    // 1M in + 1M out on flash = 1.50 + 7.50
    expect(callCostUsd({ model: 'gemini-3.7-flash', grounded: false, usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } })).toBeCloseTo(9, 6);
  });
  it('charges the search fee only to grounded calls, by query count with a one-prompt floor', () => {
    const usage = { inputTokens: 0, outputTokens: 0 };
    expect(callCostUsd({ model: 'gemini-flash-lite-latest', grounded: false, usage, searchQueries: 9 })).toBe(0);
    expect(callCostUsd({ model: 'gemini-flash-lite-latest', grounded: true, usage, searchQueries: 1 })).toBeCloseTo(0.035, 6);
    expect(callCostUsd({ model: 'gemini-flash-lite-latest', grounded: true, usage, searchQueries: 6 })).toBeCloseTo(0.084, 6);
  });
  it('is only the search fee when the provider sent no usage', () => {
    expect(callCostUsd({ model: 'gemini-3.7-flash', grounded: true })).toBeCloseTo(0.035, 6);
    expect(callCostUsd({ model: 'gemini-3.7-flash', grounded: false })).toBe(0);
  });
});
