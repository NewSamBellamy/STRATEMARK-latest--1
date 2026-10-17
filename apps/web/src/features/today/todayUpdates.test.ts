import { describe, expect, it } from 'vitest';
import type { CompanyMove, LiveIntelContent } from '@mi/contracts';
import { MAX_UPDATES, pickTodayUpdates, updatesFromMoves, updatesFromSocial, unreadCount, type TodayUpdate } from './todayUpdates';

const NOW = new Date('2026-10-17T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function move(id: string, over: Partial<CompanyMove> = {}): CompanyMove {
  return {
    id, companyId: 'cmp_a', companyName: 'Acme', kind: 'funding', importance: 2, title: `Story ${id}`, url: `https://news.example/${id}`,
    publisher: 'News Example', publishedAt: daysAgo(1), foundAt: daysAgo(0), source: 'news', readAt: null, ...over,
  };
}

function intel(items: Array<Partial<LiveIntelContent['items'][number]> & { id: string }>): Pick<LiveIntelContent, 'items'> {
  return {
    items: items.map((i) => ({
      source: 'reddit' as const, title: `Thread ${i.id}`, url: `https://reddit.com/r/x/${i.id}`, summary: 'People are talking.', detail: null,
      publishedDate: daysAgo(2).slice(0, 10), sentiment: 'neutral' as const, publishedAt: daysAgo(1), stale: false, ...i,
    })),
  } as Pick<LiveIntelContent, 'items'>;
}

describe('updates from the moves feed', () => {
  it('keeps only this company and sorts each into release, filing or news', () => {
    const all = updatesFromMoves([
      move('1', { kind: 'launch' }), move('2', { kind: 'filing', source: 'sec_filing' }), move('3', { kind: 'deal' }), move('4', { companyId: 'cmp_other' }),
    ], 'cmp_a');
    expect(all.map((u) => [u.id, u.kind])).toEqual([['1', 'release'], ['2', 'filing'], ['3', 'news']]);
    expect(all.every((u) => u.dateKind === 'published' && u.sentiment === null)).toBe(true);
  });

  it('carries read state through', () => {
    expect(updatesFromMoves([move('1', { readAt: daysAgo(0) })], 'cmp_a')[0]!.readAt).not.toBeNull();
  });
});

describe('updates from the social conversation', () => {
  it('takes only Reddit and X items from the stored research, with the sentiment research tagged', () => {
    const out = updatesFromSocial(intel([{ id: 'a', sentiment: 'negative' }, { id: 'b', source: 'news' }, { id: 'c', source: 'x' }]), new Set(), NOW);
    expect(out.map((u) => u.id)).toEqual(['social:a', 'social:c']);
    expect(out[0]).toMatchObject({ kind: 'social', sentiment: 'negative', publisher: 'Reddit', dateKind: 'published' });
    expect(out[1]!.publisher).toBe('X');
  });

  it('says when a date is only when research found the item, never as its publication date', () => {
    const [u] = updatesFromSocial(intel([{ id: 'a', publishedDate: null }]), new Set(), NOW);
    expect(u!.dateKind).toBe('found');
  });

  it('leaves out an item with no usable date, a future date, or a link that is not http(s)', () => {
    const out = updatesFromSocial(intel([
      { id: 'nodate', publishedDate: null, publishedAt: 'not a date' },
      { id: 'future', publishedDate: '2099-01-01' },
      { id: 'badurl', url: 'javascript:alert(1)' },
      { id: 'ok' },
    ]), new Set(), NOW);
    expect(out.map((u) => u.id)).toEqual(['social:ok']);
  });

  it('remembers what was read on this device', () => {
    const [u] = updatesFromSocial(intel([{ id: 'a' }]), new Set(['social:a']), NOW);
    expect(u!.readAt).not.toBeNull();
  });

  it('is empty when nothing is stored', () => {
    expect(updatesFromSocial(null, new Set(), NOW)).toEqual([]);
  });
});

describe('picking the day\'s updates', () => {
  const news = (n: number, daysBack = 1): TodayUpdate[] => updatesFromMoves(Array.from({ length: n }, (_, i) => move(`n${i}`, { publishedAt: daysAgo(daysBack + i * 0.1) })), 'cmp_a');
  const social = (n: number): TodayUpdate[] => updatesFromSocial(intel(Array.from({ length: n }, (_, i) => ({ id: `s${i}`, publishedDate: daysAgo(1 + i * 0.2).slice(0, 10) }))), new Set(), NOW);

  it('never shows more than ten, newest first', () => {
    const picked = pickTodayUpdates([...news(14), ...social(6)], NOW);
    expect(picked).toHaveLength(MAX_UPDATES);
    const dates = picked.map((u) => u.at);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('keeps room for the social conversation when there is a lot of news', () => {
    const picked = pickTodayUpdates([...news(14), ...social(6)], NOW);
    expect(picked.filter((u) => u.kind === 'social').length).toBe(4);
  });

  it('gives unused social room back to the news, and unused news room back to social', () => {
    expect(pickTodayUpdates([...news(14), ...social(1)], NOW).filter((u) => u.kind !== 'social')).toHaveLength(9);
    expect(pickTodayUpdates([...news(2), ...social(9)], NOW)).toHaveLength(10);
  });

  it('is not padded: fewer than five real items stays fewer than five', () => {
    expect(pickTodayUpdates([...news(2)], NOW)).toHaveLength(2);
    expect(pickTodayUpdates([], NOW)).toEqual([]);
  });

  it('looks back two weeks first and only widens to reach five', () => {
    const recent = news(6, 1);
    const old = updatesFromMoves([move('old', { publishedAt: daysAgo(40), url: 'https://news.example/old' })], 'cmp_a');
    expect(pickTodayUpdates([...recent, ...old], NOW).map((u) => u.id)).not.toContain('old');
    expect(pickTodayUpdates([...news(2, 1), ...old], NOW).map((u) => u.id)).toContain('old');
    const tooOld = updatesFromMoves([move('ancient', { publishedAt: daysAgo(400), url: 'https://news.example/ancient' })], 'cmp_a');
    expect(pickTodayUpdates(tooOld, NOW)).toEqual([]);
  });

  it('shows one item once, however the link is written', () => {
    const a = updatesFromMoves([move('1', { url: 'https://news.example/story?utm=x#top' }), move('2', { url: 'https://news.example/story/' })], 'cmp_a');
    expect(pickTodayUpdates(a, NOW)).toHaveLength(1);
  });

  it('counts unread', () => {
    const all = updatesFromMoves([move('1'), move('2', { readAt: daysAgo(0) })], 'cmp_a');
    expect(unreadCount(all)).toBe(1);
  });
});
