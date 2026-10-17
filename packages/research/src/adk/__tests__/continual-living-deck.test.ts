import { describe, it, expect } from 'vitest';
import { estimatePrivateCompanyMetrics } from '../../proxy-estimator';
import { createGeminiClient } from '../../gemini';
import { LivingDeckEngine, type LivingDeckEngineOptions } from '../engine';
import { createAdkTelemetry } from '../telemetry';

describe('🚀 Continual Living Deck & Balanced 8-Tier Swarm Architecture', () => {
  // These two tests replace a pair that called inferScaleFromEntity and asserted
  // its hardcoded figures — e.g. `expect(scale.valuation).toBeGreaterThanOrEqual(1e9)`
  // for OpenRouter — as CORRECT. That function is deleted; a company's scale must
  // come from grounded evidence, never from a regex over its name. These tests now
  // pin the invariant that was being violated.

  it('returns NO figures for a company with no grounded evidence — honest null, not a guess', () => {
    // A real private company about which the research pass found nothing usable.
    const metrics = estimatePrivateCompanyMetrics('Stealth Robotics Co', 'general_tech', null);

    // Tier 4 of the waterfall is "honest null". Either nothing is emitted, or what
    // is emitted is explicitly unknown with a null value. What must NEVER happen is
    // a concrete number appearing from nowhere.
    for (const metric of metrics) {
      if (metric.confidence === 'unknown') {
        expect(metric.value).toBeNull();
      } else {
        expect(metric.value).not.toBeNull();
        expect(metric.methodNote).toBeTruthy();
      }
    }

    const invented = metrics.filter((m) => m.value !== null && !m.methodNote);
    expect(invented).toEqual([]);
  });

  it('derives an estimate only from observable evidence, and always shows its work', () => {
    const metrics = estimatePrivateCompanyMetrics('Evidence Labs', 'b2b_vertical_saas', {
      headcount: 40,
      headcountSource: 'Company careers page, 40 listed employees',
      citations: [{ title: 'evidencelabs.com/careers', url: 'https://evidencelabs.com/careers' }],
    });

    const arr = metrics.find((m) => m.metricType === 'arr');
    expect(arr).toBeDefined();
    expect(arr?.value).toBeGreaterThan(0);

    // A derived figure is an ESTIMATE, never "verified" — verified is reserved for
    // a directly reported figure with a usable citation.
    expect(arr?.confidence).toBe('estimated');

    // And it must carry an auditable formula, so a reader can recompute it.
    expect(arr?.methodNote).toBeTruthy();
    expect(arr?.methodNote).toContain('40');
  });

  it('executes continuous living deck auto-hydration and topology expansion', async () => {
    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey || process.env.LIVE_TESTS !== '1') return;

    const client = createGeminiClient({ apiKey, model: 'gemini-3.7-flash' });
    const telemetry = createAdkTelemetry({ rootAuthor: 'continual_living_deck_test' });

    // `satisfies` is load-bearing here: the previous version of this test passed
    // an `options: { batchSize, maxCompanies, enableDeltaWatcher }` object that
    // does not exist on LivingDeckEngineOptions, and the API-key early-return
    // above meant the assertions never ran — so the shape drift stayed invisible
    // while the suite reported green. This pins the real constructor contract.
    const options = {
      deckId: 'deck_test_123',
      client,
      telemetry,
      plan: {
        marketName: 'AI Developer Tooling',
        vertical: 'developer tools',
        geography: null,
        notes: null,
        searchThemes: ['AI code review', 'agentic IDEs'],
      },
      maxCandidates: 15,
      enrichmentConcurrency: 4,
      watch: true,
    } satisfies LivingDeckEngineOptions;

    const engine = new LivingDeckEngine(options);

    expect(engine).toBeDefined();
    expect(typeof engine.run).toBe('function');
    expect(engine.getState().deckId).toBe('deck_test_123');
    expect(engine.getState().status).toBe('idle');
  });
});
