import { describe, expect, it } from 'vitest';
import type { LiveIntelItem, Product, ProductBrief, RoadmapItem } from '@mi/contracts';
import {
  buildProductReportModel,
  mentionsProduct,
  metricRows,
  productTimeline,
  relatedRoadmap,
  relatedStories,
  sentimentTally,
} from './productReportModel';

const product: Product = { name: 'Astra', description: 'A planner.', revenueNote: '', url: 'https://acme.example/astra', status: 'live' };
const company = { name: 'Acme', logoUrl: null, website: null, hq: null };
const brief = (over: Partial<ProductBrief> = {}): ProductBrief => ({
  companyId: 'c', productName: 'Astra', generatedAt: '2026-10-17T00:00:00.000Z', overview: '', metrics: [], sentiment: null, timeline: [], citations: [], ...over,
});
const item = (over: Partial<LiveIntelItem>): LiveIntelItem => ({
  id: 'i', source: 'news', title: 't', url: 'https://news.example/a', summary: '', detail: null, publishedDate: null,
  sentiment: 'neutral', publishedAt: '2026-10-01T00:00:00.000Z', stale: false, publisher: null, imageUrl: null, ...over,
} as LiveIntelItem);

describe('mentionsProduct', () => {
  it('matches the whole name only, ignoring case, and never short names', () => {
    expect(mentionsProduct('Astra launches a new tier', 'astra')).toBe(true);
    expect(mentionsProduct('The Astrazeneca results', 'Astra')).toBe(false);
    expect(mentionsProduct('Go and Gone', 'Go')).toBe(false);
    expect(mentionsProduct('Pricing (Astra) changed', 'Astra')).toBe(true);
  });
});

describe('related items', () => {
  it('keeps only stories and roadmap items that name the product', () => {
    const stories = relatedStories([item({ title: 'Astra adds teams', sentiment: 'positive' }), item({ title: 'Other news', url: 'https://news.example/b' })], 'Astra');
    expect(stories).toHaveLength(1);
    expect(sentimentTally(stories)).toEqual({ positive: 1, neutral: 0, negative: 0 });
    const rm: RoadmapItem[] = [{ title: 'Astra mobile', horizon: 'next', detail: '', date: '2027' }, { title: 'Billing', horizon: 'now', detail: '', date: null }];
    expect(relatedRoadmap(rm, 'Astra').map((r) => r.title)).toEqual(['Astra mobile']);
  });
});

describe('metricRows', () => {
  it('shows stored facts, null for the unreported, and drops a researched figure that has no source', () => {
    const rows = metricRows(product, brief({ metrics: [
      { label: 'Users', value: '10M', asOf: '2026', sourceUrl: 'https://data.example/u', sourceTitle: 'Data' },
      { label: 'Revenue', value: '$1B', asOf: null, sourceUrl: null, sourceTitle: null },
      { label: 'Pricing', value: null, asOf: null, sourceUrl: 'https://data.example/p', sourceTitle: null },
    ] }));
    expect(rows.find((r) => r.label === 'Status')?.value).toBe('Live');
    expect(rows.find((r) => r.label === 'Revenue role')?.value).toBeNull();
    expect(rows.find((r) => r.label === 'Users')).toMatchObject({ value: '10M', asOf: '2026' });
    expect(rows.find((r) => r.label === 'Revenue')?.value).toBeNull();
    expect(rows.find((r) => r.label === 'Pricing')?.value).toBeNull();
  });
});

describe('productTimeline', () => {
  it('keeps researched milestones first and marks roadmap items as planned, inventing no dates', () => {
    const t = productTimeline(
      brief({ timeline: [{ date: 'Nov 2022', title: 'Launch', detail: 'Public beta.', sourceUrl: 'https://news.example/l' }] }),
      [{ title: 'Astra mobile', horizon: 'next', detail: 'iOS first.', date: null }],
    );
    expect(t.map((r) => r.origin)).toEqual(['research', 'roadmap']);
    expect(t[1]).toMatchObject({ date: null, detail: expect.stringContaining('next') });
  });
});

describe('buildProductReportModel', () => {
  it('numbers each source once and says when the product was not researched', () => {
    const m = buildProductReportModel({
      company, product, brief: null,
      stories: [{ title: 'Astra adds teams', url: 'https://news.example/a', publisher: 'News', date: null, sentiment: 'positive' }],
      roadmap: [],
    });
    expect(m.researched).toBe(false);
    expect(m.sentiment).toBeNull();
    expect(m.noteByUrl['https://news.example/a']).toBe(1);
    expect(m.footnotes).toHaveLength(1);
  });

  it('shares one footnote between a metric and a timeline row that cite the same page', () => {
    const m = buildProductReportModel({
      company, product, stories: [], roadmap: [],
      brief: brief({
        metrics: [{ label: 'Users', value: '10M', asOf: null, sourceUrl: 'https://data.example/u', sourceTitle: 'Data' }],
        timeline: [{ date: '2025', title: 'Milestone', detail: '', sourceUrl: 'https://data.example/u' }],
      }),
    });
    expect(m.footnotes).toHaveLength(1);
  });
});
