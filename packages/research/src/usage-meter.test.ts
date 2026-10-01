import { describe, expect, it } from 'vitest';
import { createResearchUsageMeter } from './usage-meter';

describe('research usage meter', () => {
  it('reconciles conservative attempt reservations to reported provider usage', () => {
    const meter = createResearchUsageMeter({
      maxRequests: 2,
      maxInputTokens: 5_000,
      maxOutputTokens: 20,
    });

    const attempt = meter.beginAttempt({
      kind: 'model',
      estimatedInputTokens: 1_500,
      maxOutputTokens: 12,
    });
    expect(attempt.maxOutputTokens).toBe(12);
    meter.settleAttempt(attempt.id, { inputTokens: 80, outputTokens: 5 });

    expect(meter.snapshot()).toEqual({
      requests: 1,
      inputTokens: 80,
      outputTokens: 5,
      complete: true,
    });
  });

  it('blocks the next provider attempt before any declared ceiling is crossed', () => {
    const meter = createResearchUsageMeter({
      maxRequests: 1,
      maxInputTokens: 1_000,
      maxOutputTokens: 10,
    });
    meter.beginAttempt({ kind: 'search', estimatedInputTokens: 0, maxOutputTokens: 0 });

    expect(() =>
      meter.beginAttempt({ kind: 'search', estimatedInputTokens: 0, maxOutputTokens: 0 }),
    ).toThrow(/request limit/i);
  });

  it('keeps unreported attempts conservatively charged and marks usage incomplete', () => {
    const meter = createResearchUsageMeter({
      maxRequests: 2,
      maxInputTokens: 5_000,
      maxOutputTokens: 20,
    });
    meter.beginAttempt({
      kind: 'model',
      estimatedInputTokens: 1_500,
      maxOutputTokens: 12,
    });

    expect(meter.snapshot()).toEqual({
      requests: 1,
      inputTokens: 1_500,
      outputTokens: 12,
      complete: false,
    });
  });

  it('rejects oversized input and clamps output to the remaining ceiling', () => {
    const meter = createResearchUsageMeter({
      maxRequests: 3,
      maxInputTokens: 100,
      maxOutputTokens: 4,
    });

    expect(() =>
      meter.beginAttempt({ kind: 'model', estimatedInputTokens: 101, maxOutputTokens: 1 }),
    ).toThrow(/input token limit/i);
    const attempt = meter.beginAttempt({
      kind: 'model',
      estimatedInputTokens: 50,
      maxOutputTokens: 5,
    });
    expect(attempt.maxOutputTokens).toBe(4);
  });
});
