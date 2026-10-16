import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import { completenessFixture } from './completeness-report.fixture';
import { GeminiRepository, type RepoSnapshot } from './repository';
import type { LlmClient } from './types';
import type { WebSearchFn } from './web-search';

const HOUR = 60 * 60_000;

/** A workspace with the fixture deck (Acme Robotics, Beta Capital, Gamma Shop), a news feed and one sorting model. */
function movesRepo(news: WebSearchFn) {
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
    originalSourceReader: async (url) => ({ requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString(), reason: 'offline' }),
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

  it('a company whose feed or sorting failed is tried again next time, not skipped for a day', async () => {
    let down = true;
    const { repo, structure } = movesRepo(async (query) => { if (down) throw new Error('feed down'); return feed(query); });
    await repo.followCompanies(['acme']);
    expect(await repo.refreshMoves()).toMatchObject({ added: 0, refreshed: 0 });
    down = false;
    structure.mockRejectedValueOnce(new Error('model down'));
    expect(await repo.refreshMoves()).toMatchObject({ added: 0, refreshed: 0 });
    expect(await repo.refreshMoves()).toMatchObject({ added: 1, refreshed: 1 });
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
});
