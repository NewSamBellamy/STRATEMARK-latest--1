import { describe, expect, it } from 'vitest';
import { buildDailyReportModel } from './dailyReportModel';
import { captureAllowed, resolveUpdateImages } from './reportImages';
import type { TodayUpdate } from '@/features/today/todayUpdates';

const company = { name: 'Acme', logoUrl: null, website: 'https://acme.example', hq: null };
const NOW = new Date('2026-10-17T12:00:00.000Z');

const update = (id: string, over: Partial<TodayUpdate> = {}): TodayUpdate => ({
  id, kind: 'news', title: `Story ${id}`, url: `https://www.reuters.com/${id}`, publisher: 'Reuters', at: '2026-10-16T08:00:00.000Z',
  dateKind: 'published', summary: null, sentiment: null, importance: 2, readAt: null, ...over,
});

describe('the day\'s report', () => {
  it('numbers the updates and credits each to its publisher and date', () => {
    const model = buildDailyReportModel(company, [update('a'), update('b', { kind: 'social', publisher: 'Reddit', url: 'https://www.reddit.com/r/x/1', dateKind: 'found', sentiment: 'negative', summary: 'A thread.' })], new Map(), NOW);
    expect(model.items.map((i) => i.n)).toEqual([1, 2]);
    expect(model.items[0]!.byline).toMatch(/^Reuters · /);
    expect(model.items[1]!.byline).toMatch(/^Reddit · found /);
    expect(model.items[1]).toMatchObject({ kindLabel: 'Social', sentiment: 'negative', summary: 'A thread.' });
    expect(model.counts).toEqual([{ label: 'News', count: 1 }, { label: 'Social', count: 1 }]);
  });

  it('turns an expired redirect link into a search, not a dead link', () => {
    const [item] = buildDailyReportModel(company, [update('a', { url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc' })], new Map(), NOW).items;
    expect(item!.source.direct).toBe(false);
    expect(item!.source.url).toContain('google.com/search');
  });

  it('attaches only the pictures it was given, to the update they belong to', () => {
    const image = { src: 'https://img.example/a.jpg', credit: 'Reuters', sourceUrl: 'https://www.reuters.com/a', kind: 'cover' as const };
    const model = buildDailyReportModel(company, [update('a'), update('b')], new Map([['a', [image]]]), NOW);
    expect(model.items[0]!.images).toEqual([image]);
    expect(model.items[1]!.images).toEqual([]);
  });

  it('is empty when there are no updates', () => {
    expect(buildDailyReportModel(company, [], new Map(), NOW).items).toEqual([]);
  });
});

describe('page captures', () => {
  it('are never taken of pages that only answer with a login or blocked wall', () => {
    for (const url of ['https://www.reddit.com/r/x/comments/1', 'https://x.com/acme/status/1', 'https://twitter.com/a', 'https://www.linkedin.com/company/a', 'https://old.reddit.com/r/y', 'https://www.facebook.com/a']) {
      expect(captureAllowed(url)).toBe(false);
    }
    for (const url of ['https://www.reuters.com/a', 'https://thehackernews.com/2026/x.html', 'https://notreddit.com/a', 'https://reddit.com.evil.example/a']) {
      expect(captureAllowed(url)).toBe(true);
    }
    expect(captureAllowed('not a url')).toBe(false);
  });

  it('give a social update no capture, and a news update its publisher\'s own picture first', async () => {
    const deps = {
      cover: async (url: string) => (url.includes('reuters') ? { src: 'https://img.example/r.jpg', publisher: 'Reuters' } : null),
      shot: async (url: string) => `https://shots.example/${encodeURIComponent(url)}`,
    };
    const images = await resolveUpdateImages([
      { id: 'news', url: 'https://www.reuters.com/a', title: 'A' },
      { id: 'social', url: 'https://www.reddit.com/r/x/1', title: 'B' },
      { id: 'blog', url: 'https://blog.example/post', title: 'C' },
    ], deps);
    expect(images.get('news')!.map((i) => i.kind)).toEqual(['cover']);
    expect(images.has('social')).toBe(false);
    expect(images.get('blog')!.map((i) => i.kind)).toEqual(['screenshot']);
  });
});
