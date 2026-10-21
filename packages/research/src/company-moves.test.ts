import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import type { CompanyMove } from '@mi/contracts';
import { classifyMoves, filingMoveCandidates, mergeMoves, moveId, moveSince, newsMoveCandidates, rankMoves, type MoveCandidate } from './company-moves';
import type { LlmClient } from './types';

const now = new Date('2026-10-16T09:00:00Z');
const acme = { id: 'acme', name: 'Acme Robotics', websiteUrl: 'https://acme.example' };

describe('dates and repeats', () => {
  it('a story dated ahead of now (beyond clock skew) is not a move', async () => {
    const found = await newsMoveCandidates(acme, async () => [
      { url: 'https://news.example/f', title: 'Acme Robotics raises $40M', snippet: '', published: '2026-10-16T20:00:00Z' },
      { url: 'https://news.example/g', title: 'Acme Robotics hires a CFO', snippet: '', published: '2026-10-16T09:10:00Z' },
    ], new Date('2026-10-09T00:00:00Z'), now);
    expect(found.map((c) => c.url)).toEqual(['https://news.example/g']);
    // Within skew: dated now, never in the future.
    expect(found[0]!.publishedAt).toBe(now.toISOString());
  });

  it('each quarter\'s filing is its own move although EDGAR titles them alike', () => {
    const q = (url: string, publishedAt: string): MoveCandidate => ({ companyId: 'acme', companyName: 'Acme Robotics', title: 'Quarterly report (Form 10-Q)',
      url, publisher: 'SEC EDGAR', publishedAt, snippet: '', source: 'sec_filing', kind: 'filing', importance: 1 });
    const first = mergeMoves([], [q('https://www.sec.gov/a-q2', '2026-08-01T00:00:00.000Z')], '2026-08-02T00:00:00.000Z');
    expect(mergeMoves(first.moves, [q('https://www.sec.gov/a-q3', '2026-11-01T00:00:00.000Z')], '2026-11-02T00:00:00.000Z').added).toBe(1);
  });
});

describe('news moves', () => {
  it('keeps only dated stories naming the company, newer than the last look, one per address', async () => {
    const newsSearch = vi.fn(async () => [
      { url: 'https://news.example/a?utm_source=x', title: 'Acme Robotics raises $40M Series B', snippet: '', published: '2026-10-15T08:00:00Z', publisher: 'Reuters' },
      { url: 'https://news.example/a', title: 'Acme Robotics raises $40M Series B (update)', snippet: '', published: '2026-10-15T09:00:00Z' },
      { url: 'https://news.example/b', title: 'A paint shop opens a store', snippet: '', published: '2026-10-15T08:00:00Z' },
      { url: 'https://news.example/c', title: 'Acme Robotics hires a CFO', snippet: '', published: undefined },
      { url: 'https://news.example/d', title: 'Acme Robotics at a trade show', snippet: '', published: '2026-10-01T08:00:00Z' },
      { url: 'https://news.example/e', title: 'Acme Robotics will launch in 2030', snippet: '', published: '2030-01-01T00:00:00Z' },
    ]);
    const found = await newsMoveCandidates(acme, newsSearch, new Date('2026-10-09T09:00:00Z'), now);
    expect(found.map((c) => c.title)).toEqual(['Acme Robotics raises $40M Series B']);
    expect(found[0]).toMatchObject({ publisher: 'Reuters', source: 'news', publishedAt: '2026-10-15T08:00:00.000Z' });
  });

  it('a failed search yields no moves rather than an error', async () => {
    expect(await newsMoveCandidates(acme, async () => { throw new Error('429'); }, new Date(0), now)).toEqual([]);
  });
});

describe('filing moves', () => {
  const filing = (form: string, filingDate: string, events: string[]) =>
    ({ form, filingDate, reportDate: null, title: form === '8-K' ? 'Current report' : 'Quarterly report', events, url: `https://www.sec.gov/x/${form}-${filingDate}` }) as never;
  it('takes the kind and the title only from what EDGAR lists', () => {
    const moves = filingMoveCandidates(acme, [
      filing('8-K', '2026-10-14', ['Executive or director change']),
      filing('8-K', '2026-10-13', ['Material agreement']),
      filing('10-Q', '2026-10-12', []),
      filing('8-K', '2026-09-01', ['Financial results']),
    ], new Date('2026-10-09T00:00:00Z'));
    expect(moves.map((m) => [m.kind, m.title])).toEqual([
      ['hire', 'Current report (Form 8-K): Executive or director change'],
      ['deal', 'Current report (Form 8-K): Material agreement'],
      ['filing', 'Quarterly report (Form 10-Q)'],
    ]);
    expect(moves.every((m) => m.publisher === 'SEC EDGAR' && m.source === 'sec_filing')).toBe(true);
  });
});

const candidate = (title: string, extra: Partial<MoveCandidate> = {}): MoveCandidate => ({
  companyId: 'acme', companyName: 'Acme Robotics', title, url: `https://news.example/${encodeURIComponent(title)}`,
  publisher: null, publishedAt: '2026-10-15T08:00:00.000Z', snippet: '', source: 'news', ...extra,
});

describe('one classification call per refresh', () => {
  it('drops headlines that are not about the company or are none of the kinds, and never rewrites a headline', async () => {
    const structure = vi.fn(async (_prompt: string, schema: ZodType<unknown>) => schema.parse({ labels: [
      { i: 0, about: true, kind: 'funding', importance: 3 },
      { i: 1, about: false, kind: 'deal', importance: 2 },
      { i: 2, about: true, kind: 'other', importance: 1 },
    ] }));
    const client = { structure } as unknown as LlmClient;
    const kept = await classifyMoves(client, [candidate('Acme Robotics raises $40M'), candidate('Rival buys Acme Robotics supplier'),
      candidate('Acme Robotics stock rises'), candidate('8-K', { source: 'sec_filing', kind: 'filing' })]);
    expect(structure).toHaveBeenCalledTimes(1);
    expect(kept.map((c) => [c.title, c.kind])).toEqual([['8-K', 'filing'], ['Acme Robotics raises $40M', 'funding']]);
  });

  it('a failed call keeps the filings and no news', async () => {
    const client = { structure: async () => { throw new Error('503'); } } as unknown as LlmClient;
    const kept = await classifyMoves(client, [candidate('Acme Robotics raises $40M'), candidate('8-K', { source: 'sec_filing', kind: 'filing' })]);
    expect(kept.map((c) => c.title)).toEqual(['8-K']);
  });
});

describe('merging and ranking', () => {
  it('keeps read state, drops repeats by address and by headline, and ranks unread first', () => {
    const first = mergeMoves([], [candidate('Acme Robotics raises $40M', { kind: 'funding', importance: 3 })], '2026-10-15T09:00:00Z');
    expect(first.added).toBe(1);
    const read: CompanyMove[] = first.moves.map((m) => ({ ...m, readAt: '2026-10-15T10:00:00Z' }));
    const second = mergeMoves(read, [
      candidate('Acme Robotics raises $40M', { kind: 'funding', importance: 3 }),
      candidate('Acme Robotics raises $40M!', { kind: 'funding', url: 'https://other.example/x' }),
      candidate('Acme Robotics hires a CFO', { kind: 'hire', importance: 2, publishedAt: '2026-10-14T08:00:00.000Z' }),
      candidate('Unsorted', {}),
    ], '2026-10-16T09:00:00Z');
    expect(second.added).toBe(1);
    expect(second.moves.find((m) => m.kind === 'funding')!.readAt).toBe('2026-10-15T10:00:00Z');
    expect(rankMoves(second.moves).map((m) => m.kind)).toEqual(['hire', 'funding']);
    expect(moveId('acme', 'https://news.example/a?utm_source=x')).toBe(moveId('acme', 'https://news.example/a'));
  });

  it('looks a week back the first time, and a day before the last refresh after that', () => {
    expect(moveSince(now).toISOString()).toBe('2026-10-09T09:00:00.000Z');
  });
});
