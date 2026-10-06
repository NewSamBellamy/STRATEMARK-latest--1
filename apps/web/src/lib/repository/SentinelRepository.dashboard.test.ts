import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Market } from '@mi/contracts';
import { SentinelRepository } from './SentinelRepository';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
describe('cloud dashboard citation transport', () => {
  it('retains actual server attribution in the result consumed by every dashboard section', async () => {
    localStorage.setItem('mi.sentinelApiUrl', 'https://sentinel.test');
    const citations = [{ title: 'Official', url: 'https://example.com/report' }];
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => ({ content: { markdown: 'Notes' }, citations }) } as Response);
    const repository = new SentinelRepository();
    vi.spyOn(repository, 'listMarkets').mockResolvedValue([{ id: 'deck_test' }] as Market[]);
    expect(await repository.getDashboardTab('cmp', 'overview')).toMatchObject({ content: { markdown: 'Notes' }, citations });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('https://sentinel.test/api/research/tab', expect.objectContaining({ body: JSON.stringify({ deckId: 'deck_test', companyId: 'cmp', tab: 'overview' }) }));
  });
});
