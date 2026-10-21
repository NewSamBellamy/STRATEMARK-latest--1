import { describe, expect, it } from 'vitest';
import { QUOTA_PRESETS, effectiveQuotaPreset } from './apiKey';

describe('the pacing a research run uses', () => {
  it('is the paid pacing for a hosted-beta visitor who has no key of their own (the Worker key is a paid key)', () => {
    expect(effectiveQuotaPreset({ hasUserKey: false, hosted: true, chosen: 'free' })).toBe('paid');
    expect(QUOTA_PRESETS.paid.groundedRpm).toBeGreaterThan(QUOTA_PRESETS.free.groundedRpm);
    expect(QUOTA_PRESETS.paid.structureRpm).toBeGreaterThan(QUOTA_PRESETS.free.structureRpm);
  });

  it('is whatever the person chose when they bring their own key, hosted or not', () => {
    expect(effectiveQuotaPreset({ hasUserKey: true, hosted: true, chosen: 'free' })).toBe('free');
    expect(effectiveQuotaPreset({ hasUserKey: true, hosted: true, chosen: 'paid' })).toBe('paid');
    expect(effectiveQuotaPreset({ hasUserKey: true, hosted: false, chosen: 'free' })).toBe('free');
  });

  it('is unchanged outside the hosted beta (a local build without a key keeps the saved choice)', () => {
    expect(effectiveQuotaPreset({ hasUserKey: false, hosted: false, chosen: 'free' })).toBe('free');
    expect(effectiveQuotaPreset({ hasUserKey: false, hosted: false, chosen: 'paid' })).toBe('paid');
  });
});
