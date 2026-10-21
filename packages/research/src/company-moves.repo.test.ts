import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import { completenessFixture } from './completeness-report.fixture';
import { GeminiRepository, type RepoSnapshot } from './repository';
import type { LlmClient } from './types';
import type { WebSearchFn } from './web-search';

const HOUR = 60 * 60_000;

/** A workspace with the fixture deck (Acme Robotics, Beta Capital, Gamma Shop), a news feed and one sorting model. */
function movesRepo(news: WebSearchFn, sec: { down: boolean } = { down: false }, movesNews?: WebSearchFn) {
  let saved = { ...completenessFixture(), viceClaims: [], reports: [], briefings: [], savedCards: [],
    opportunity: {}, researchJobs: [], threads: [] } as unknown as RepoSnapshot;
  const structure = vi.fn(async (prompt: string, schema: ZodType<unknown>) => {
    const rows = JSON.parse(prompt.slice(prompt.indexOf('\n[') + 1)) as Array<{ i: number; headline: string }>;
    return schema.parse({ labels: rows.map((row) => ({ i: row.i, about: !/rival/i.test(row.headline),
      kind: /raises/i.test(row.headline) ? 'funding' : 'launch', importance: /raises/i.test(row.headline) ? 3 : 1 })) });
  });
  const newsSearch = vi.fn(news);
  const repo = new GeminiRepository({ apiKey: 'test', client: { structure, ground: vi.fn() } as unknown as LlmClient,
    newsSearch: () => newsSearch,
    ...(movesNews ? { movesNewsSearch: () => movesNews } : {}),
    // SEC answers that none of the fixture companies is a registrant, unless it is down.
    originalSourceReader: async (url) => (sec.down || !url.includes('company_tickers')
      ? { requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString(), reason: 'offline' }
      : { requestedUrl: url, status: 'retrieved', retrievedAt: new Date().toISOString(), text: '{}' }),
    store: { read: () => structuredClone(saved), write: async (next) => { saved = structuredClone(next); } } });
  return { repo, structure, newsSearch, saved: () => saved };
}

const recent = (hoursAgo: number) => new Date(Date.now() - hoursAgo * HOUR).toISOString();
const feed: WebSearchFn = async (query) => query.includes('Acme Robotics')
  ? [{ url: 'https://news.example/acme-b', title: 'Acme Robotics raises $40M Series B', snippet: '', published: recent(5), publisher: 'Reuters' },
    { url: 'https://news.example/acme-rival', title: 'Acme Robotics rival opens a plant', snippet: '', published: recent(3) }]
  : query.includes('Gamma Shop')
    ? [{ url: 'https://news.example/gamma-app', title: 'Gamma Shop launches a picking app', snippet: '', published: recent(2) }]
    : [];

describe('Today in the workspace', () => {
  it('follows only companies it knows, once each', async () => {
    const { repo } = movesRepo(feed);
    await repo.followCompanies(['acme', 'gamma', 'acme', 'nobody']);
    expect((await repo.listFollows()).map((f) => f.companyId).sort()).toEqual(['acme', 'gamma']);
    await repo.unfollowCompany('gamma');
    expect((await repo.listFollows()).map((f) => f.companyId)).toEqual(['acme']);
  });

  it('one refresh reads the free feed per company and sorts every headline in ONE call, ranked and dated', async () => {
    const { repo, structure, newsSearch } = movesRepo(feed);
    await repo.followCompanies(['acme', 'gamma']);
    const result = await repo.refreshMoves();
    expect(result).toMatchObject({ added: 2, refreshed: 2 });
    expect(result.refreshedAt).not.toBeNull();
    expect(newsSearch).toHaveBeenCalledTimes(2);
    expect(structure).toHaveBeenCalledTimes(1);
    const moves = await repo.listMoves();
    // The rival's story is not a move; the funding round outranks the launch.
    expect(moves.map((m) => m.title)).toEqual(['Acme Robotics raises $40M Series B', 'Gamma Shop launches a picking app']);
    expect(moves[0]).toMatchObject({ companyId: 'acme', kind: 'funding', importance: 3, publisher: 'Reuters',
      url: 'https://news.example/acme-b', source: 'news', readAt: null });
  });

  it('a check scoped to one company reads only that company, even forced, with three followed', async () => {
    const { repo, newsSearch } = movesRepo(feed);
    await repo.followCompanies(['acme', 'beta', 'gamma']);
    await repo.refreshMoves({ force: true, companyIds: ['gamma'] });
    expect(newsSearch).toHaveBeenCalledTimes(1);
    expect(newsSearch).toHaveBeenCalledWith(expect.stringContaining('Gamma Shop'));
    const follows = await repo.listFollows();
    expect(follows.find((f) => f.companyId === 'gamma')!.lastCheckedAt).toBeTruthy();
    expect(follows.find((f) => f.companyId === 'acme')!.lastCheckedAt).toBeFalsy();
  });

  it('marks several moves read in one write', async () => {
    const { repo, saved } = movesRepo(feed);
    await repo.followCompanies(['acme', 'gamma']);
    await repo.refreshMoves();
    const ids = (await repo.listMoves()).map((m) => m.id);
    await repo.markMovesRead([...ids, 'unknown']);
    expect((await repo.listMoves()).every((m) => m.readAt)).toBe(true);
    expect(saved().moves?.every((m) => m.readAt)).toBe(true);
  });

  it('refreshes a company at most once a day unless forced, and never files a story twice', async () => {
    const { repo, structure, newsSearch } = movesRepo(feed);
    await repo.followCompanies(['acme']);
    await repo.refreshMoves();
    expect(await repo.refreshMoves()).toMatchObject({ added: 0, refreshed: 0 });
    expect(newsSearch).toHaveBeenCalledTimes(1);
    expect(structure).toHaveBeenCalledTimes(1);
    expect(await repo.refreshMoves({ force: true })).toMatchObject({ added: 0, refreshed: 1 });
    expect(await repo.listMoves()).toHaveLength(1);
    // A company followed later is due at once, without re-reading the others.
    await repo.followCompanies(['gamma']);
    expect(await repo.refreshMoves()).toMatchObject({ added: 1, refreshed: 1 });
    expect(newsSearch).toHaveBeenLastCalledWith(expect.stringContaining('Gamma Shop'));
  });

  it('a company whose feed or sorting failed is tried again within hours, not skipped for a day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      let down = true;
      const { repo, structure } = movesRepo(async (query) => { if (down) throw new Error('feed down'); return feed(query); });
      await repo.followCompanies(['acme']);
      expect(await repo.refreshMoves()).toMatchObject({ added: 0, refreshed: 0 });
      down = false;
      vi.setSystemTime(Date.now() + 2 * HOUR + 1_000);
      structure.mockRejectedValueOnce(new Error('model down'));
      expect(await repo.refreshMoves()).toMatchObject({ added: 0, refreshed: 0 });
      vi.setSystemTime(Date.now() + 2 * HOUR + 1_000);
      expect(await repo.refreshMoves()).toMatchObject({ added: 1, refreshed: 1 });
    } finally { vi.useRealTimers(); }
  });

  it('Today reads its own strict lane: a feed that is down is retried in 2 hours even when the hunt lane would answer "no leads"', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      let down = true;
      const { repo, newsSearch } = movesRepo(async () => [], { down: false },
        async (query) => { if (down) throw new Error('relay answered 429'); return feed(query); });
      await repo.followCompanies(['acme']);
      expect(await repo.refreshMoves()).toMatchObject({ added: 0, refreshed: 0 });
      // Not looked at again on the next open, but within hours.
      expect(await repo.refreshMoves()).toMatchObject({ added: 0, refreshed: 0 });
      down = false;
      vi.setSystemTime(Date.now() + 2 * HOUR + 1_000);
      expect(await repo.refreshMoves()).toMatchObject({ added: 1, refreshed: 1 });
      expect(newsSearch).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('says honestly when each company was last checked, and which could not be reached, from stored state', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      let down = true;
      const { repo } = movesRepo(async (query) => { if (down && query.includes('Gamma')) throw new Error('feed down'); return feed(query); });
      await repo.followCompanies(['acme', 'gamma']);
      expect((await repo.listFollows()).map((f) => f.lastCheckedAt ?? null)).toEqual([null, null]);
      const first = await repo.refreshMoves();
      expect(first).toMatchObject({ refreshed: 1, failed: ['gamma'] });
      const [acme, gamma] = await repo.listFollows();
      expect(acme).toMatchObject({ companyId: 'acme', lastCheckedAt: first.refreshedAt });
      expect(acme!.checkFailedAt ?? null).toBeNull();
      // The retry time parked for the failed company is not shown as a time it was checked.
      expect(gamma).toMatchObject({ companyId: 'gamma', lastCheckedAt: null });
      expect(gamma!.checkFailedAt).toEqual(expect.any(String));
      down = false;
      vi.setSystemTime(Date.now() + 2 * HOUR + 1_000);
      const second = await repo.refreshMoves();
      expect(second).toMatchObject({ refreshed: 1, failed: [] });
      const after = await repo.listFollows();
      expect(after.every((f) => f.lastCheckedAt && !f.checkFailedAt)).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('when every feed is down no check time is claimed at all', async () => {
    const { repo } = movesRepo(async () => { throw new Error('feed down'); });
    await repo.followCompanies(['acme']);
    expect(await repo.refreshMoves()).toMatchObject({ refreshed: 0, refreshedAt: null, failed: ['acme'] });
  });

  it('an SEC outage does not count as a look, and does not hold back the news', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const sec = { down: true };
      const { repo, newsSearch } = movesRepo(feed, sec);
      await repo.followCompanies(['acme']);
      expect(await repo.refreshMoves()).toMatchObject({ added: 1, refreshed: 0 });
      sec.down = false;
      vi.setSystemTime(Date.now() + 2 * HOUR + 1_000);
      expect(await repo.refreshMoves()).toMatchObject({ added: 0, refreshed: 1 });
      expect(newsSearch).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it('while SEC stays unreachable, opening Today again soon searches and sorts nothing more', async () => {
    const { repo, newsSearch, structure } = movesRepo(feed, { down: true });
    await repo.followCompanies(['acme']);
    await repo.refreshMoves();
    expect(await repo.refreshMoves()).toMatchObject({ added: 0, refreshed: 0 });
    expect(newsSearch).toHaveBeenCalledTimes(1);
    expect(structure).toHaveBeenCalledTimes(1);
  });

  it('a look the feed answered with nothing still finds a story a few days old once the feed is back', async () => {
    // The relay turns an outage into an empty answer: nothing tells the refresh it was down.
    let down = true;
    const { repo } = movesRepo(async (query) => (down ? [] : [
      { url: 'https://news.example/acme-old', title: 'Acme Robotics raises $40M Series B', snippet: '', published: recent(72), publisher: 'Reuters' },
    ].filter(() => query.includes('Acme'))));
    await repo.followCompanies(['acme']);
    await repo.refreshMoves();
    down = false;
    expect(await repo.refreshMoves({ force: true })).toMatchObject({ added: 1 });
  });

  it('stories already filed are not sent to be sorted again', async () => {
    const { repo, structure } = movesRepo(feed);
    await repo.followCompanies(['acme']);
    await repo.refreshMoves();
    const sorted = structure.mock.calls.length;
    await repo.refreshMoves({ force: true });
    const prompts = structure.mock.calls.slice(sorted).map((call) => call[0] as string);
    expect(prompts.join('\n')).not.toContain('raises $40M Series B');
  });

  it('a forced check asked during a running one still looks at every company', async () => {
    const { repo, newsSearch } = movesRepo(feed);
    await repo.followCompanies(['acme']);
    await repo.refreshMoves();
    await repo.followCompanies(['gamma']);
    const [, forced] = await Promise.all([repo.refreshMoves(), repo.refreshMoves({ force: true })]);
    expect(forced.refreshed).toBe(2);
    expect(newsSearch.mock.calls.filter(([q]) => String(q).includes('Acme')).length).toBe(2);
  });

  it('read state persists, and moves of a company no longer followed are not shown', async () => {
    const { repo, saved } = movesRepo(feed);
    await repo.followCompanies(['acme', 'gamma']);
    await repo.refreshMoves();
    const [top] = await repo.listMoves();
    await repo.markMoveRead(top!.id, true);
    expect(saved().moves?.find((m) => m.id === top!.id)?.readAt).not.toBeNull();
    // Read moves sink below unread ones.
    expect((await repo.listMoves()).map((m) => m.companyId)).toEqual(['gamma', 'acme']);
    await repo.markMoveRead(top!.id, false);
    expect((await repo.listMoves())[0]!.readAt).toBeNull();
    await repo.unfollowCompany('acme');
    expect((await repo.listMoves()).map((m) => m.companyId)).toEqual(['gamma']);
  });

  it('deleting the market drops the follows and moves of companies that leave the workspace', async () => {
    const { repo, saved } = movesRepo(feed);
    await repo.followCompanies(['acme', 'gamma']);
    await repo.refreshMoves();
    await repo.deleteMarket('mkt_fx');
    expect(saved().follows ?? []).toEqual([]);
    expect(saved().moves ?? []).toEqual([]);
    expect(saved().movesRefreshedAt ?? {}).toEqual({});
  });

  it('remembers a rejected headline and does not send it for sorting again', async () => {
    const { repo, structure, saved } = movesRepo(feed);
    await repo.followCompanies(['acme']);
    await repo.refreshMoves();
    expect(Object.keys(saved().rejectedMoveIds ?? {})).toHaveLength(1);
    await repo.refreshMoves({ force: true });
    await repo.refreshMoves({ force: true });
    // The rival story and the stored funding story are both known: no second sorting call.
    expect(structure).toHaveBeenCalledTimes(1);
    expect(await repo.listMoves()).toHaveLength(1);
  });

  it('forgets a rejection after 14 days, and old snapshots without the field still refresh', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { repo, structure, saved } = movesRepo(async (query) => (query.includes('Acme Robotics') ? [
        { url: 'https://news.example/acme-rival', title: 'Acme Robotics rival opens a plant', snippet: '', published: new Date(Date.now() - 2 * HOUR).toISOString() }] : []));
      expect(saved().rejectedMoveIds).toBeUndefined();
      await repo.followCompanies(['acme']);
      await repo.refreshMoves();
      expect(structure).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.now() + 15 * 24 * HOUR);
      await repo.refreshMoves({ force: true });
      expect(structure).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it('a sorting failure is not a rejection: the headline is sorted again next time', async () => {
    const { repo, structure, saved } = movesRepo(feed);
    await repo.followCompanies(['acme']);
    structure.mockRejectedValueOnce(new Error('model down'));
    await repo.refreshMoves();
    expect(saved().rejectedMoveIds).toBeUndefined();
    await repo.refreshMoves({ force: true });
    expect(structure).toHaveBeenCalledTimes(2);
  });

  it('reports progress as companies are looked at, ending at all of them', async () => {
    const { repo } = movesRepo(feed);
    await repo.followCompanies(['acme', 'beta', 'gamma']);
    const seen: Array<[number, number]> = [];
    await repo.refreshMoves({ onProgress: (done, total) => seen.push([done, total]) });
    expect(seen[0]).toEqual([0, 3]);
    expect(seen.at(-1)).toEqual([3, 3]);
    // A listener that throws does not stop the check.
    expect(await repo.refreshMoves({ force: true, onProgress: () => { throw new Error('ui gone'); } })).toMatchObject({ refreshed: 3 });
  });
});
