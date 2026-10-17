import { afterEach, describe, expect, it, vi } from 'vitest';
import { SentinelRepository } from './SentinelRepository';

describe('cloud research conversation transport', () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
  it('reads the returned conversation from the cloud instead of an empty local stub', async () => {
    localStorage.setItem('mi.sentinelApiUrl', 'https://sentinel.test');
    const thread = { id: 'thr_test', scope: { kind: 'deck', deckId: 'deck_test' }, title: 'Question', reportId: null,
      messages: [], createdAt: '2026-10-01', updatedAt: '2026-10-01' };
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => thread } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ threads: [thread] }) } as Response);
    const repository = new SentinelRepository();
    expect(await repository.getResearchThread('thr_test')).toEqual(thread);
    expect(await repository.listResearchThreads({ deckId: 'deck_test' })).toEqual([thread]);
    expect(fetch.mock.calls[0]![0]).toBe('https://sentinel.test/api/research/threads/thr_test');
    expect(fetch.mock.calls[1]![0]).toBe('https://sentinel.test/api/research/threads?deckId=deck_test');
  });
});
