import { describe, expect, it } from 'vitest';
import { MockRepository } from '@mi/mocks';
import { loadSampleSnapshot } from '@/sample/loadSampleSnapshot';
import { needsSampleDeck, selectRepository } from './RepositoryProvider';
import { SentinelRepository } from './SentinelRepository';

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
});
