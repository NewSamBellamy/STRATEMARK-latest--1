import { describe, expect, it } from 'vitest';
import type { Report } from '@mi/contracts';
import { buildTopicReportModel, costLine, topicReportToJson, topicReportToMarkdown } from './topicReportModel';
import { resolveReportImages, shotSections } from './reportImages';

const company = { name: 'Acme', logoUrl: null, website: 'https://acme.example', hq: 'Austin, Texas' };

const report: Report = {
  id: 'rpt_1',
  kind: 'company',
  subjectId: 'co_1',
  title: 'Acme — Company Report',
  markdown: '',
  citations: [],
  topics: ['overview', 'metrics', 'history'],
  sections: [
    {
      topic: 'overview',
      title: 'Overview',
      markdown: 'Acme makes anvils.',
      citations: [
        { title: 'Reuters', url: 'https://www.reuters.com/acme' },
        { title: 'Reuters again', url: 'https://www.reuters.com/acme' },
        { title: 'Redirect', url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc' },
      ],
      gaps: [],
      researchedDeeper: false,
    },
    {
      topic: 'metrics',
      title: 'Metrics',
      markdown: 'Revenue: not found.',
      citations: [],
      gaps: ['Revenue has no sourced figure.'],
      researchedDeeper: true,
    },
    { topic: 'history', title: 'History', markdown: 'Founded long ago.', citations: [{ title: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Acme' }], gaps: [], researchedDeeper: false },
  ],
  cost: { estUsd: 0.4231, calls: 12, searches: 9 },
  createdAt: '2026-10-17T10:00:00.000Z',
};

describe('the topic report model', () => {
  it('numbers each section\'s sources from 1, drops repeats and turns an expired redirect into a search', () => {
    const model = buildTopicReportModel(report, company);
    const overview = model.sections[0]!;
    expect(overview.footnotes.map((f) => f.n)).toEqual([1, 2]);
    expect(overview.footnotes[0]).toMatchObject({ url: 'https://www.reuters.com/acme', direct: true });
    expect(overview.footnotes[1]!.direct).toBe(false);
    expect(overview.footnotes[1]!.url).toContain('https://www.google.com/search');
    // The next section starts again at 1 so each page stands on its own.
    expect(model.sections[2]!.footnotes.map((f) => f.n)).toEqual([1]);
  });

  it('counts the sections that still have gaps and keeps the gap text', () => {
    const model = buildTopicReportModel(report, company);
    expect(model.openGapCount).toBe(1);
    expect(model.sections[1]!.gaps).toEqual(['Revenue has no sourced figure.']);
    expect(model.sections[1]!.researchedDeeper).toBe(true);
  });

  it('leads the cover with the first publisher image and does not repeat it in its section', () => {
    const cover = { src: 'https://img.example/a.jpg', credit: 'Reuters', sourceUrl: 'https://www.reuters.com/acme', kind: 'cover' as const };
    const shot = { src: 'https://shots.example/a', credit: 'Reuters', sourceUrl: 'https://www.reuters.com/acme', kind: 'screenshot' as const };
    const model = buildTopicReportModel(report, company, new Map([['overview', [cover, shot]]]));
    expect(model.hero).toBe(cover);
    expect(model.sections[0]!.images).toEqual([shot]);
  });

  it('has no cover picture when no source published one', () => {
    expect(buildTopicReportModel(report, company).hero).toBeNull();
  });

  it('says a demo report is a demo', () => {
    expect(buildTopicReportModel({ ...report, title: 'Acme — Company Report (demo)' }, company).demo).toBe(true);
    expect(buildTopicReportModel(report, company).demo).toBe(false);
  });
});

describe('cost line', () => {
  it('states a measured cost as an estimate with its calls and searches', () => {
    expect(costLine(report.cost)).toBe('Cost to build: about $0.42 (estimate), 12 model calls, 9 searches');
  });
  it('says not measured, never zero, when nothing was measured', () => {
    expect(costLine({ estUsd: null, calls: null, searches: null })).toBe('Cost to build: not measured');
  });
  it('shows nothing for a report from before cost tracking', () => {
    expect(costLine(undefined)).toBeNull();
  });
  it('does not show a measured cost as free', () => {
    expect(costLine({ estUsd: 0.002, calls: 1, searches: null })).toBe('Cost to build: about $0.01 (estimate), 1 model call');
  });
});

describe('report files', () => {
  it('writes Markdown with gaps called out and sources as numbered footnotes', () => {
    const md = topicReportToMarkdown(report, company);
    expect(md).toContain('# Acme — Company Report');
    expect(md).toContain('## Overview');
    expect(md).toContain('1. [');
    expect(md).toContain('> Not found: Revenue has no sourced figure.');
    expect(md).toContain('Cost to build: about $0.42');
  });

  it('writes JSON with the same sections and numbered sources', () => {
    const json = JSON.parse(topicReportToJson(report, company)) as {
      topics: string[];
      sections: Array<{ topic: string; gaps: string[]; sources: Array<{ n: number; url: string }> }>;
      cost: { estUsd: number } | null;
    };
    expect(json.topics).toEqual(['overview', 'metrics', 'history']);
    expect(json.sections[0]!.sources[0]).toEqual({ n: 1, title: 'Reuters', url: 'https://www.reuters.com/acme' });
    expect(json.sections[1]!.gaps).toHaveLength(1);
    expect(json.cost?.estUsd).toBeCloseTo(0.4231);
  });

  it('keeps an unmeasured cost null in JSON', () => {
    const json = JSON.parse(topicReportToJson({ ...report, cost: undefined }, company)) as { cost: unknown };
    expect(json.cost).toBeNull();
  });
});

describe('report pictures', () => {
  const deps = {
    cover: async (url: string) => (url.includes('reuters') ? { src: 'https://img.example/reuters.jpg', publisher: 'Reuters' } : null),
    shot: async (url: string) => `https://shots.example/${encodeURIComponent(url)}`,
  };

  it('credits every picture to the page it came from and generates none', async () => {
    const images = await resolveReportImages(report, deps);
    const overview = images.get('overview')!;
    expect(overview.map((i) => i.kind)).toEqual(['cover', 'screenshot']);
    expect(overview[0]).toMatchObject({ credit: 'Reuters', sourceUrl: 'https://www.reuters.com/acme' });
  });

  it('gives a section with no source no picture rather than a made-up one', async () => {
    const images = await resolveReportImages(report, deps);
    expect(images.has('metrics')).toBe(false);
  });

  it('survives a source whose picture lookup fails', async () => {
    const images = await resolveReportImages(report, { cover: async () => { throw new Error('offline'); }, shot: async () => null });
    expect(images.size).toBe(0);
  });

  it('captures pages only for the first few sections that have a source', () => {
    const many: Report['sections'] = ['overview', 'metrics', 'live_intel', 'team_org', 'products_roadmap'].map((topic) => ({
      topic: topic as 'overview', title: topic, markdown: '', gaps: [], researchedDeeper: false,
      citations: [{ title: 'Site', url: `https://${topic}.example/page` }],
    }));
    expect(shotSections(many!).size).toBe(3);
  });
});
