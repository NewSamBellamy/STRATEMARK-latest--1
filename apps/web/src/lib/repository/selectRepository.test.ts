import { describe, expect, it } from 'vitest';
import { MockRepository } from '@mi/mocks';
import { loadSampleSnapshot } from '@/sample/loadSampleSnapshot';
import { needsSampleDeck, selectRepository } from './RepositoryProvider';
import { SentinelRepository } from './SentinelRepository';
import { sourceCheckLines } from '@/features/dashboard/SourceCheck';

describe('repository selection', () => {
  it('only demo mode needs the bundled sample deck', () => {
    expect(needsSampleDeck('', undefined)).toBe(true);
    expect(needsSampleDeck('key', undefined)).toBe(false);
    expect(needsSampleDeck('', 'cloud')).toBe(false);
  });

  it('builds the demo repository from the lazily loaded sample, and refuses without it', async () => {
    const sample = await loadSampleSnapshot();
    expect(await loadSampleSnapshot()).toBe(sample);
    const repo = selectRepository('', '', undefined, undefined, 'free', '', sample);
    expect(repo).toBeInstanceOf(MockRepository);
    expect((await repo.listMarkets()).length).toBeGreaterThan(0);
    expect(() => selectRepository('', '')).toThrow(/sample deck/);
    expect(selectRepository('', '', 'cloud')).toBeInstanceOf(SentinelRepository);
  });

  it('demo facts carry a read-time assessment computed from the injected clock; a forged one is discarded', async () => {
    const sample = await loadSampleSnapshot();
    const companyId = 'cmp_mistral-ai_iubim';
    const forged = { ...sample, metrics: sample.metrics.map((m) => (m.companyId === companyId ? { ...m, assessment: { version: 1, score: 100, summary: 'forged' } } : m)) } as typeof sample;
    const asOf = async (iso: string) => {
      const repo = selectRepository('', '', undefined, undefined, 'free', '', forged, () => new Date(iso));
      return (await repo.getCompanyFacts!(companyId)).filter((m) => m.value != null);
    };
    const early = await asOf('2026-08-01T12:00:00Z');
    const later = await asOf('2027-08-01T12:00:00Z');
    expect(early.length).toBeGreaterThan(0);
    for (const m of [...early, ...later]) {
      expect(m.assessment).toBeTruthy();
      expect(m.assessment!.summary).not.toBe('forged');
      expect(m.assessment!.assessedAt.startsWith('202')).toBe(true);
    }
    // The sample figures are undated captures from one search-found page: the check says exactly that, no more.
    for (const m of early) {
      const lines = sourceCheckLines(m, m.metricType);
      expect(lines.slice(0, 2)).toEqual(['The source gives no date for this figure', 'forbes.com: independent trade press']);
      expect(m.assessment!.currency).toMatchObject({ asOf: null, state: 'undated' });
    }
    // Same stored figures, different clock: age follows the injected now, values never change.
    expect(later.map((m) => m.value)).toEqual(early.map((m) => m.value));
    expect(later.map((m) => m.assessment!.assessedAt)).not.toEqual(early.map((m) => m.assessment!.assessedAt));
  });
});
