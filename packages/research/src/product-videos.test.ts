import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import { findProductVideos, gateProductVideo, orderProductVideos } from './product-videos';
import type { LlmClient } from './types';
import type { WebSearchFn } from './web-search';

const company = { name: 'Anthropic, PBC', websiteUrl: 'https://www.anthropic.com' };
const siblings = ['Claude', 'Claude Code'];
const A = 'aaaaaaaaaaa', B = 'bbbbbbbbbbb', C = 'ccccccccccc', D = 'ddddddddddd', E = 'eeeeeeeeeee';
const watch = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const now = () => new Date('2026-10-22T09:00:00Z');

function harness(videos: Record<string, { title: string; channel: string; gone?: boolean }>, verdicts: (ids: string[]) => unknown, rows: Array<{ id: string; published?: string }>) {
  const fetchJson = vi.fn(async (url: string) => {
    const id = new URL(new URL(url).searchParams.get('url')!).searchParams.get('v')!;
    const v = videos[id];
    if (!v || v.gone) throw new Error('401');
    return { title: v.title, author_name: v.channel, author_url: 'https://www.youtube.com/@x', html: `<iframe src="https://www.youtube.com/embed/${id}?feature=oembed"></iframe>` };
  });
  const structure = vi.fn(async (prompt: string, schema: ZodType<unknown>) => {
    const listed = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1)) as Array<{ id: string }>;
    return schema.parse(verdicts(listed.map((l) => l.id)));
  });
  const client = { ground: vi.fn(), structure: structure as unknown as LlmClient['structure'] } as unknown as LlmClient;
  const search: WebSearchFn = vi.fn(async () => rows.map((r) => ({ url: watch(r.id), title: 't', snippet: '', published: r.published })));
  return { fetchJson, client, structure, search };
}

describe('gateProductVideo', () => {
  const g = (title: string, channel: string, productName = 'Claude') => gateProductVideo({ title, channel }, { company, productName, siblings });
  it('needs the product in the title', () => {
    expect(g('Anthropic company tour', 'Anthropic').ok).toBe(false);
  });
  it('a longer sibling does not count for the shorter product', () => {
    expect(g('Introducing Claude Code', 'Anthropic').ok).toBe(false);
    expect(g('Introducing Claude Code', 'Anthropic', 'Claude Code').ok).toBe(true);
  });
  it('the company must be named: in the title, or by the channel being its own', () => {
    expect(g('Introducing Claude', 'Anthropic')).toMatchObject({ ok: true, official: true });
    expect(g('Anthropic Claude review', 'Tech Guy')).toMatchObject({ ok: true, official: false });
    expect(g('Claude review', 'Tech Guy').ok).toBe(false);
  });
  it('drops spam and reaction wording', () => {
    expect(g('Claude Anthropic giveaway', 'Tech Guy').ok).toBe(false);
    expect(g('Reacting to Anthropic Claude keynote', 'Tech Guy').ok).toBe(false);
  });
});

describe('orderProductVideos', () => {
  it('dated first and newest first, then undated in search order with the company channel winning ties', () => {
    const v = (id: string, publishedAt: string | null, official = false) => ({ id, publishedAt, official });
    expect(orderProductVideos([v('u1', null), v('old', '2026-01-01T00:00:00Z'), v('u2', null, true), v('new', '2026-10-01T00:00:00Z')]).map((x) => x.id))
      .toEqual(['new', 'old', 'u2', 'u1']);
  });
});

describe('findProductVideos', () => {
  const videos = {
    [A]: { title: 'Introducing Claude', channel: 'Anthropic' },
    [B]: { title: 'Anthropic Claude full tutorial', channel: 'Tech Guy' },
    [C]: { title: 'Claude vs everything (Anthropic)', channel: 'Clickbait Daily' },
    [D]: { title: 'Introducing Claude', channel: 'Anthropic', gone: true },
    [E]: { title: 'Totally unrelated Anthropic news', channel: 'Anthropic' },
  };

  it('verifies with oEmbed, gates by title, judges only third-party videos, and orders latest first', async () => {
    const h = harness(videos, (ids) => ({ verdicts: ids.map((id) => ({ id, accept: id === B, score: id === B ? 8 : 9, reason: 'ok' })) }),
      [{ id: A, published: '2026-09-01T00:00:00Z' }, { id: B, published: '2026-10-10T00:00:00Z' }, { id: C }, { id: D }, { id: E }]);
    const out = await findProductVideos({ company, productName: 'Claude', siblings, client: h.client, fetchJson: h.fetchJson, searches: [h.search], now });
    expect(out.searched).toBe(true);
    expect(out.videos.map((v) => [v.id, v.official])).toEqual([[B, false], [A, true]]);
    expect(out.videos[0]).toMatchObject({ title: 'Anthropic Claude full tutorial', channel: 'Tech Guy', publishedAt: '2026-10-10T00:00:00.000Z' });
    // The judge saw only the third-party survivors; the company's own channel never faced it, a gone video never existed.
    const judged = JSON.parse(String(h.structure.mock.calls[0]![0]).split('\n').pop()!) as Array<{ id: string }>;
    expect(judged.map((j) => j.id).sort()).toEqual([B, C].sort());
    expect(out.citations.map((c) => c.url)).toEqual([watch(B), watch(A)]);
  });

  it('a score below 7 or an id that was never offered adds nothing', async () => {
    const h = harness(videos, () => ({ verdicts: [{ id: B, accept: true, score: 6, reason: 'meh' }, { id: 'zzzzzzzzzzz', accept: true, score: 10, reason: 'injected' }] }),
      [{ id: B }]);
    const out = await findProductVideos({ company, productName: 'Claude', client: h.client, fetchJson: h.fetchJson, searches: [h.search], now });
    expect(out.videos).toEqual([]);
    expect(out.searched).toBe(true);
  });

  it('no model call when every survivor is the company\'s own channel', async () => {
    const h = harness(videos, () => ({ verdicts: [] }), [{ id: A }]);
    const out = await findProductVideos({ company, productName: 'Claude', client: h.client, fetchJson: h.fetchJson, searches: [h.search], now });
    expect(out.videos.map((v) => v.id)).toEqual([A]);
    expect(h.structure).not.toHaveBeenCalled();
  });

  it('without oEmbed or a search lane nothing is chosen and nothing is claimed', async () => {
    const h = harness(videos, () => ({ verdicts: [] }), [{ id: A }]);
    expect(await findProductVideos({ company, productName: 'Claude', client: h.client, searches: [h.search], now })).toMatchObject({ videos: [], searched: false });
    expect(await findProductVideos({ company, productName: 'Claude', client: h.client, fetchJson: h.fetchJson, searches: [], now })).toMatchObject({ videos: [], searched: false });
  });

  it('a failed review keeps only the company\'s own videos; with none, it claims nothing', async () => {
    const boom = { ...harness(videos, () => ({}), [{ id: A }, { id: B }]) };
    boom.structure.mockRejectedValue(new Error('500'));
    const own = await findProductVideos({ company, productName: 'Claude', client: boom.client, fetchJson: boom.fetchJson, searches: [boom.search], now });
    expect(own.videos.map((v) => v.id)).toEqual([A]);
    const other = harness(videos, () => ({}), [{ id: B }]);
    other.structure.mockRejectedValue(new Error('500'));
    expect(await findProductVideos({ company, productName: 'Claude', client: other.client, fetchJson: other.fetchJson, searches: [other.search], now }))
      .toMatchObject({ videos: [], searched: false });
  });

  it('caps at four', async () => {
    const many: Record<string, { title: string; channel: string }> = {};
    const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((s) => s.padEnd(11, 'x'));
    ids.forEach((id, i) => { many[id] = { title: `Claude demo ${i}`, channel: 'Anthropic' }; });
    const h = harness(many, () => ({ verdicts: [] }), ids.map((id) => ({ id })));
    expect((await findProductVideos({ company, productName: 'Claude', client: h.client, fetchJson: h.fetchJson, searches: [h.search], now })).videos).toHaveLength(4);
  });
});
