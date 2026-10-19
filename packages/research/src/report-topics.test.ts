/**
 * Topic-based company reports, the pure half: digests, gaps and the figure guard.
 * Fixtures only: no model, no network.
 */
import { describe, expect, it } from 'vitest';
import { REPORT_TOPICS, type CompanyMetric, type ReportTopic } from '@mi/contracts';
import {
  DIGEST_MAX_CHARS,
  UNREADABLE_GAP,
  bestMetricRows,
  isCitableSource,
  allowedFigures,
  dropUntraceableFigures,
  hasUntraceableFigure,
  parseReportedDate,
  sanitizeSectionMarkdown,
  sourcesSectionMarkdown,
  topicGaps,
  topicStoredDigest,
  topicStoredEvidence,
  type StoredTab,
  type TopicInput,
} from './report-topics';

const NOW = new Date('2026-10-15T12:00:00.000Z');
const REUTERS = { title: 'Reuters', url: 'https://www.reuters.com/business/acme-2026' };
const SEC = { title: 'SEC filing', url: 'https://www.sec.gov/Archives/edgar/data/1/acme-10k.htm' };
const SITE = { title: 'Acme', url: 'https://acme.example/about' };

function metric(over: Partial<CompanyMetric> & Pick<CompanyMetric, 'metricType'>): CompanyMetric {
  return {
    id: `met_${over.metricType}`, companyId: 'cmp_1', value: null, confidence: 'unknown', source: null, citations: [],
    methodNote: null, capturedAt: '2026-10-01T00:00:00.000Z', ...over,
  } as CompanyMetric;
}
const sourced = (metricType: CompanyMetric['metricType'], value: number, confidence: CompanyMetric['confidence'] = 'verified'): CompanyMetric =>
  metric({ metricType, value, confidence, citations: [REUTERS], source: REUTERS.url });

const tab = (content: unknown, over: Partial<StoredTab> = {}): StoredTab =>
  ({ content, citations: [REUTERS], lastRefreshedAt: '2026-10-10T00:00:00.000Z', ...over });

const fullCompany = {
  name: 'Acme', oneLiner: 'Acme makes anvils.', hqLocation: 'Austin, TX', websiteUrl: 'https://acme.example',
  founded: { year: 2012, source: 'wikidata', citations: [SITE] },
};

const FULL_TABS: Record<Exclude<ReportTopic, 'metrics' | 'sources'>, unknown> = {
  overview: { markdown: 'Acme is an anvil maker headquartered in Austin. It sells to studios and film crews.' },
  live_intel: {
    items: [{ id: 'n1', source: 'news', title: 'Acme opens plant', url: 'https://www.reuters.com/n1', summary: 'A new plant.', detail: null,
      publishedDate: '2026-09-30', sentiment: 'positive', publishedAt: '2026-10-01T00:00:00.000Z', stale: false }],
    lastRefreshedAt: '2026-10-10T00:00:00.000Z', cadence: 'weekly',
  },
  team_org: { nodes: [{ id: 'p1', name: 'Wile E.', role: 'CEO', group: 'exec', parentId: null, bio: 'Founder.' }] },
  products_roadmap: {
    products: [{ name: 'Anvil Pro', description: 'A heavy anvil.', revenueNote: 'not disclosed', url: null, status: 'live' }],
    roadmap: [{ title: 'Lighter anvil', horizon: 'next', detail: 'Planned.', date: null }],
  },
  history: {
    founderStory: 'Founded in a garage.',
    timeline: [{ date: '2012', title: 'Founded', detail: 'In Austin.' }],
    quotes: [],
  },
  mission_governance: {
    mission: 'Drop it on them.', ethos: 'Heavy.', governanceStructure: 'Board of three.',
    board: [{ name: 'Road Runner', affiliation: 'Independent' }],
    positives: [], negatives: [], fundingRounds: [{ round: 'Series A', amountUsd: 5_000_000, date: '2014', leadInvestors: ['Looney Capital'] }],
    investors: [],
  },
};

function full(topic: ReportTopic): TopicInput {
  const metrics = [sourced('revenue', 120_000_000), sourced('valuation', 2_000_000_000), sourced('employees', 450), sourced('funding_total', 30_000_000)];
  return {
    company: fullCompany,
    metrics,
    tab: topic === 'metrics' || topic === 'sources' ? null : tab(FULL_TABS[topic]),
    evidence: [{ topic: 'overview', capturedAt: '2026-10-01T00:00:00.000Z', text: 'Acme passage', citations: [REUTERS, SEC, SITE] }],
    otherCitations: [REUTERS, SEC, SITE],
    now: NOW,
  };
}

function empty(): TopicInput {
  return { company: { name: 'Hollow Co' }, metrics: [], tab: null, evidence: [], otherCitations: [], now: NOW };
}

describe('empty company', () => {
  it.each(REPORT_TOPICS)('%s reports gaps and carries no stored content', (topic) => {
    const input = empty();
    expect(topicGaps(topic, input).length).toBeGreaterThan(0);
    const stored = topicStoredEvidence(topic, input);
    expect(stored.hasContent).toBe(false);
    expect(stored.citations).toEqual([]);
  });

  it('a never-researched tab says so, in plain words', () => {
    expect(topicGaps('team_org', empty())).toContain('Team & org has never been researched');
    expect(topicGaps('live_intel', empty())).toContain('Live intel has never been researched');
  });
});

describe('complete company', () => {
  it.each(REPORT_TOPICS)('%s has stored content and no gaps', (topic) => {
    expect(topicGaps(topic, full(topic))).toEqual([]);
    expect(topicStoredEvidence(topic, full(topic)).hasContent).toBe(true);
  });
});

describe('unknown figures stay unknown', () => {
  it('a null value is never rendered as a number', () => {
    const input = { ...empty(), metrics: [metric({ metricType: 'revenue', value: null, confidence: 'unknown' })] };
    const digest = topicStoredDigest('metrics', input);
    expect(digest).toContain('Revenue: Unknown');
    expect(digest).not.toMatch(/Revenue:[^\n]*\$?\d/);
    expect(topicStoredEvidence('metrics', input).hasContent).toBe(false);
  });

  it('an unsourced figure is shown as Unknown even when a value is stored', () => {
    const input = { ...empty(), metrics: [metric({ metricType: 'valuation', value: 987_654_321, confidence: 'estimated', citations: [] })] };
    const digest = topicStoredDigest('metrics', input);
    expect(digest).toContain('Valuation: Unknown');
    expect(digest).not.toContain('987');
    expect(digest).not.toContain('B ');
    expect(topicGaps('metrics', input)).toContain('Valuation (or market cap) has no sourced figure');
  });

  it('a sourced figure carries its confidence, as-of date and source', () => {
    const m = { ...sourced('revenue', 120_000_000), passageSupport: { sourceUrl: REUTERS.url, quote: 'q', asOf: '2025-12-31', basis: 'revenue', unit: 'USD' } } as CompanyMetric;
    const digest = topicStoredDigest('metrics', { ...empty(), metrics: [m] });
    expect(digest).toContain('Revenue: $120M [verified], as of 2025-12-31; source: Reuters');
  });

  it('a stated headcount range stays a range, never a point', () => {
    const m = metric({ metricType: 'employees', value: null, reportedBand: { provider: 'google-search', companyName: 'X', basis: 'employees', low: 51, high: 100, unit: 'count', asOf: '2026-01-01',
      support: { supportIndex: 0, text: 't', sources: [{ chunkIndex: 0, url: REUTERS.url, title: 'Reuters' }] } } } as Partial<CompanyMetric> & { metricType: 'employees' });
    const digest = topicStoredDigest('metrics', { ...empty(), metrics: [m] });
    expect(digest).toContain('Unknown as a point figure');
    expect(digest).toContain('51 to 100');
    expect(topicGaps('metrics', { ...empty(), metrics: [m] })).toContain('Headcount has no sourced figure');
  });

  it('a headline figure that is not stored at all is listed as Unknown', () => {
    const digest = topicStoredDigest('metrics', { ...empty(), metrics: [sourced('revenue', 5_000_000)] });
    expect(digest).toContain('Valuation (or market cap): Unknown');
    expect(digest).toContain('Headcount: Unknown');
  });

  it('a funding round with no disclosed amount says so instead of showing zero', () => {
    const input = full('mission_governance');
    input.tab = tab({ ...(FULL_TABS.mission_governance as object), fundingRounds: [{ round: 'Seed', amountUsd: null, date: '2013', leadInvestors: [] }] });
    const digest = topicStoredDigest('mission_governance', input);
    expect(digest).toContain('Seed: amount undisclosed');
    expect(digest).not.toContain('$0');
  });
});

describe('gap rules', () => {
  it('overview: missing headquarters, founding year and source are each reported', () => {
    const input: TopicInput = { ...empty(), company: { name: 'Hollow Co', oneLiner: 'x' }, tab: tab({ markdown: 'Some text.' }, { citations: [] }) };
    expect(topicGaps('overview', input)).toEqual(['Headquarters not found', 'Founding year not found', 'No source found for overview']);
  });

  it('a legacy overview placeholder is not research', () => {
    const input: TopicInput = { ...full('overview'), tab: tab({ markdown: '## Company background\n\nSaved background needs an evidence-backed refresh. No paid refresh was started.' }) };
    expect(topicGaps('overview', input)).toContain('No company overview has been written');
    expect(topicStoredDigest('overview', input)).not.toContain('Saved background');
  });

  it('metrics: each missing headline figure is its own gap', () => {
    const input: TopicInput = { ...full('metrics'), metrics: [sourced('revenue', 5_000_000)] };
    expect(topicGaps('metrics', input)).toEqual([
      'Valuation (or market cap) has no sourced figure',
      'Headcount has no sourced figure',
      'Total funding raised has no sourced figure',
    ]);
  });

  it('live intel: undated news, old news and a stale tab are told apart', () => {
    const item = (publishedDate: string | null) => ({ id: 'n', source: 'news', title: 't', url: 'https://www.reuters.com/n', summary: 's', detail: null,
      publishedDate, sentiment: 'neutral', publishedAt: '2026-10-14T00:00:00.000Z', stale: false });
    const withItems = (items: unknown[], lastRefreshedAt = '2026-10-10T00:00:00.000Z'): TopicInput =>
      ({ ...full('live_intel'), tab: tab({ items, lastRefreshedAt, cadence: 'weekly' }, { lastRefreshedAt }) });
    expect(topicGaps('live_intel', withItems([item(null)]))).toEqual(['News items carry no reported publish date']);
    expect(topicGaps('live_intel', withItems([item('2025-01-05')]))).toEqual(['No dated news in the last 90 days']);
    expect(topicGaps('live_intel', withItems([item('2026-10-01')], '2026-08-01T00:00:00.000Z')))
      .toEqual(['Live intel was last refreshed more than 30 days ago']);
    expect(topicGaps('live_intel', withItems([]))).toContain('No news items found');
    // The date our own research ran is not the story's date.
    expect(topicGaps('live_intel', withItems([item('Aug 19')]))).toEqual(['News items carry no reported publish date']);
  });

  it('team: no people, then people with no executive', () => {
    expect(topicGaps('team_org', { ...full('team_org'), tab: tab({ nodes: [] }) })).toContain('No team members found');
    const noExec = tab({ nodes: [{ id: 'p', name: 'A', role: 'Engineer', group: 'ai', parentId: null, bio: '' }] });
    expect(topicGaps('team_org', { ...full('team_org'), tab: noExec })).toEqual(['No executives identified']);
  });

  it('products, history and governance name what is missing', () => {
    expect(topicGaps('products_roadmap', { ...full('products_roadmap'), tab: tab({ products: [], roadmap: [] }) }))
      .toEqual(['No products found', 'No roadmap items found']);
    expect(topicGaps('history', { ...full('history'), tab: tab({ founderStory: '', timeline: [], quotes: [] }) }))
      .toEqual(['No history timeline found', 'No founder story found']);
    expect(topicGaps('mission_governance', { ...full('mission_governance'), tab: tab({ mission: '', ethos: '', governanceStructure: '', board: [], positives: [], negatives: [], fundingRounds: [], investors: [] }) }))
      .toEqual(['No mission statement found', 'No governance structure found', 'No board members found', 'No funding rounds or investors found']);
  });

  it('sources: thin, unretained and no primary source', () => {
    const input: TopicInput = { ...empty(), otherCitations: [REUTERS] };
    expect(topicGaps('sources', input)).toEqual([
      'No retained research evidence', 'Only 1 distinct source on file', 'No primary source (company or filing) among the sources on file',
    ]);
  });

  it('unusable links never count as a source', () => {
    const input: TopicInput = { ...full('team_org'), tab: tab(FULL_TABS.team_org, { citations: [{ title: 'x', url: 'not a url' }, { title: 'y', url: 'javascript:alert(1)' }] }) };
    expect(topicGaps('team_org', input)).toEqual(['No source found for team & org']);
  });
});

describe('digest bounds and safety', () => {
  it('stays inside the character cap and says what it left out', () => {
    const nodes = Array.from({ length: 300 }, (_, i) => ({ id: `p${i}`, name: `Person ${i}`, role: 'Engineer', group: 'ai', parentId: null, bio: 'b'.repeat(900) }));
    const digest = topicStoredDigest('team_org', { ...full('team_org'), tab: tab({ nodes }) });
    expect(digest.length).toBeLessThanOrEqual(DIGEST_MAX_CHARS);
    expect(digest).toContain('digest truncated');
  });

  it('a long overview is clipped, never dumped whole', () => {
    const digest = topicStoredDigest('overview', { ...full('overview'), tab: tab({ markdown: 'word '.repeat(20_000) }) });
    expect(digest.length).toBeLessThanOrEqual(DIGEST_MAX_CHARS);
  });

  it('malformed cached content reads as empty, not as a crash', () => {
    const input: TopicInput = { ...full('team_org'), tab: tab('not an object') };
    expect(() => topicStoredDigest('team_org', input)).not.toThrow();
    expect(topicGaps('team_org', input)).toContain('No team members found');
  });

  it('criticisms are only listed when the tab is sourced', () => {
    const content = { ...(FULL_TABS.mission_governance as object), negatives: ['Fined by a regulator'], positives: [] };
    expect(topicStoredDigest('mission_governance', { ...full('mission_governance'), tab: tab(content) })).toContain('Fined by a regulator');
    expect(topicStoredDigest('mission_governance', { ...full('mission_governance'), tab: tab(content, { citations: [] }) })).not.toContain('Fined by a regulator');
  });

  it('news is listed newest first with its reported date, undated items marked', () => {
    const mk = (id: string, publishedDate: string | null) => ({ id, source: 'news', title: `Story ${id}`, url: `https://www.reuters.com/${id}`, summary: 's', detail: null,
      publishedDate, sentiment: 'neutral', publishedAt: '2026-10-14T00:00:00.000Z', stale: false });
    const digest = topicStoredDigest('live_intel', { ...full('live_intel'), tab: tab({ items: [mk('old', '2026-01-02'), mk('none', null), mk('new', '2026-10-01')], lastRefreshedAt: null, cadence: 'weekly' }) });
    expect(digest.indexOf('Story new')).toBeLessThan(digest.indexOf('Story old'));
    expect(digest).toContain('[publish date not reported] Story none');
  });
});

describe('parseReportedDate', () => {
  it('reads real dates and refuses guesses', () => {
    expect(parseReportedDate('2026-08-19')?.toISOString().slice(0, 10)).toBe('2026-08-19');
    expect(parseReportedDate('2026 Mar')?.getUTCFullYear()).toBe(2026);
    expect(parseReportedDate('March 3, 2026')?.getUTCMonth()).toBe(2);
    expect(parseReportedDate('Aug 19')).toBeNull();
    expect(parseReportedDate('2026')).toBeNull();
    expect(parseReportedDate('yesterday')).toBeNull();
    expect(parseReportedDate(null)).toBeNull();
  });
});

describe('sourcesSectionMarkdown', () => {
  it('groups the sources on file and never invents one', () => {
    const md = sourcesSectionMarkdown(full('sources'));
    expect(md).toContain('3 distinct sources');
    expect(md).toContain('SEC filing');
    expect(sourcesSectionMarkdown(empty())).toBe('No sources are on file for this company yet.');
  });
});

describe('the figure guard', () => {
  const digest = [
    'Revenue: $1.2B [verified], as of 2025-12-31; source: Reuters',
    'Employees: 4,500 [estimated]',
    'Market Share: 12.5%',
    'Founded: 2012 (per wikidata)',
  ].join('\n');
  const allowed = allowedFigures(digest, 'Acme', 'Metrics');

  it('keeps a figure the digest states, in any equivalent spelling', () => {
    for (const s of ['Revenue was $1.2B.', 'Revenue was $1.2 billion.', 'Revenue was $1,200 million.', 'It has 4,500 staff.', 'Share is 12.5%.', 'It was founded in 2012.', 'Reported as of 2025-12-31.']) {
      expect(hasUntraceableFigure(s, allowed), s).toBe(false);
    }
  });

  it('drops a figure that is in neither the digest nor the findings', () => {
    for (const s of ['Revenue was $1.5B.', 'It has 5,000 staff.', 'It was founded in 2013.', 'Growth was 40%.', 'Valuation is $20 billion.']) {
      expect(hasUntraceableFigure(s, allowed), s).toBe(true);
    }
  });

  it('exempts only bare small counts, nothing with a unit, symbol or decimal', () => {
    expect(hasUntraceableFigure('The top 3 products and 2 founders.', allowed)).toBe(false);
    expect(hasUntraceableFigure('It runs 7%.', allowed)).toBe(true);
    expect(hasUntraceableFigure('It raised $7.', allowed)).toBe(true);
    expect(hasUntraceableFigure('A score of 7.5.', allowed)).toBe(true);
    expect(hasUntraceableFigure('11 offices.', allowed)).toBe(true);
  });

  it('catches figures spelled out in words, and percentages with a small number', () => {
    expect(hasUntraceableFigure('Revenue was about twelve million dollars.', allowed)).toBe(true);
    expect(hasUntraceableFigure('Staff numbered in the thousands.', allowed)).toBe(true);
    expect(hasUntraceableFigure('Margins grew 5 percent.', allowed)).toBe(true);
    expect(hasUntraceableFigure('Output rose 3x.', allowed)).toBe(true);
    expect(hasUntraceableFigure('It has two founders and three products.', allowed)).toBe(false);
    expect(hasUntraceableFigure('Staff numbered in the thousands.', allowedFigures(digest, 'staff in the thousands'))).toBe(false);
  });

  it('ignores numbers inside links and footnote markers', () => {
    expect(hasUntraceableFigure('See [the filing](https://sec.gov/a/99999/b) [3].', allowed)).toBe(false);
  });

  it('removes just the offending sentence, bullet or row and keeps the rest', () => {
    const draft = [
      'Revenue was $1.2B per Reuters. Profit hit $900M this year. It is based in Austin.',
      '',
      '- Employees: 4,500 (estimated)',
      '- Customers: 12,000',
      '',
      '| Metric | Value |',
      '| --- | --- |',
      '| Revenue | $1.2B |',
      '| Valuation | $20B |',
    ].join('\n');
    const out = dropUntraceableFigures(draft, allowed);
    expect(out.removed).toBe(3);
    expect(out.markdown).toContain('Revenue was $1.2B per Reuters. It is based in Austin.');
    expect(out.markdown).toContain('- Employees: 4,500 (estimated)');
    expect(out.markdown).toContain('| Revenue | $1.2B |');
    for (const gone of ['900M', '12,000', '$20B']) expect(out.markdown).not.toContain(gone);
  });

  it('a table whose rows are all untraceable disappears with its header', () => {
    const out = dropUntraceableFigures('Intro.\n\n| Year | Revenue |\n| --- | --- |\n| 2030 | $9T |\n', allowed);
    expect(out.markdown).toBe('Intro.');
    expect(out.removed).toBe(1);
  });

  it('a header carrying an untraceable year takes its table with it', () => {
    const out = dropUntraceableFigures('| Revenue 2031 | Value |\n| --- | --- |\n| Revenue | $1.2B |\n', allowed);
    expect(out.markdown).toBe('');
  });

  it('strips footnote markers the model chose, because they could point at the wrong source', () => {
    const out = dropUntraceableFigures('Revenue was $1.2B [1][2]. Share is 12.5% [3, 4].', allowed);
    expect(out.markdown).toBe('Revenue was $1.2B. Share is 12.5%.');
    expect(out.removed).toBe(0);
  });

  it('leaves clean text alone', () => {
    const text = '### Position\n\nAcme is not found to report a valuation.\n\n- No headcount range found.';
    expect(dropUntraceableFigures(text, allowed)).toEqual({ markdown: text, removed: 0 });
  });

  it('deeper findings widen what may be stated, and nothing else does', () => {
    const wide = allowedFigures(digest, 'Acme raised $40M in 2025-03 (Reuters).');
    expect(hasUntraceableFigure('It raised $40M in 2025.', wide)).toBe(false);
    expect(hasUntraceableFigure('It raised $41M in 2025.', wide)).toBe(true);
  });
});

describe('sanitizeSectionMarkdown', () => {
  it('removes images, links, raw urls and html, keeping the words', () => {
    const out = sanitizeSectionMarkdown('See [the filing](https://sec.gov/a) and ![x](https://evil.example/p.png) <script>alert(1)</script> at https://x.example/y now.');
    expect(out).toBe('See the filing and  alert(1) at  now.');
    expect(out).not.toMatch(/https?:|<|\]\(/);
  });

  it('drops a reference-style image together with its protocol-relative definition', () => {
    const out = sanitizeSectionMarkdown('Before.\n\n![a][r]\n\n[r]: //evil.example/p.png?q=SECRET\n\nAfter.');
    expect(out).not.toMatch(/evil|SECRET|!\[|\]:/);
    expect(out).toContain('Before.');
    expect(out).toContain('After.');
  });

  it('drops definitions however they are written, so no reference can still resolve', () => {
    const cases = [
      '![a][r]\n\n[r]:\n//evil.example/p.png',
      '![a][r]\n\n> [r]: //evil.example/p.png',
      '![a][r]\n\n- [r]: //evil.example/p.png',
      '![a][r]\n\n   [r]: <//evil.example/p.png> "title"',
      '![a][r]\n\n[r]: //evil.example/p.png\n  "next-line title"',
      '![a][]\n\n[a]: //evil.example/p.png',
      '![a]\n\n[a]: //evil.example/p.png',
      '![a][r]\n\n[r]: /\\/evil.example/p.png',
      '![a][r]\r\n\r\n[r]: //evil.example/p.png\r\n',
    ];
    for (const md of cases) {
      const out = sanitizeSectionMarkdown(md);
      expect(out, JSON.stringify(md)).not.toMatch(/evil|!\[|\]:|title/);
    }
  });

  it('keeps the words of a reference-style link and drops its protocol-relative target', () => {
    const out = sanitizeSectionMarkdown('Read [the filing][r] and [more][] now.\n\n[r]: //evil.example/phish\n[more]: //evil.example/more');
    expect(out.trim()).toBe('Read the filing and more now.');
  });

  it('drops images whose alt text holds brackets, and links to protocol-relative targets', () => {
    const out = sanitizeSectionMarkdown('![[x]](https://evil.example/p.png) and [click](//evil.example/phish) and [[nested]](//evil.example/n) ![open');
    expect(out).not.toMatch(/evil|!\[|\]\(/);
    expect(out).toContain('click');
  });

  it('removes bare www addresses, which GFM would turn into links', () => {
    expect(sanitizeSectionMarkdown('See www.evil.example/phish today.')).toBe('See  today.');
  });

  it('leaves footnotes and ordinary bracketed text alone', () => {
    const md = 'Revenue grew [Note]: it doubled.\n\n[Verified]: revenue grew twice\n\nA point.[^1]\n\n[^1]: A footnote.';
    expect(sanitizeSectionMarkdown(md)).toBe(md);
  });
});

describe('the figure guard: hostile spellings and look-alike units', () => {
  const source = allowedFigures(
    'Revenue: $120M [verified], as of 2026-03-31; source: Reuters',
    'Employees: 450',
    'Founded: 2012 (per wikidata)',
    'Market Share: 12.5%',
    'More than a million people use it.',
    'Total raised: Unknown',
    'Acme',
    '2026',
  );
  const untraceable = (s: string): boolean => hasUntraceableFigure(s, source);

  it('reads numbers glued to finance suffixes and units', () => {
    for (const s of ['It made $999mm.', 'Debt of $7bln.', 'A spread of 480bps.', 'Up 47pp.', 'The 25th largest.', 'Revenue near 1.2e9.', 'Rated 9/10.', 'Runs v2.3.4.', 'Raised 5mn.', 'Cost 5 bln.']) {
      expect(untraceable(s), s).toBe(true);
    }
    const stated = allowedFigures('spread 480bps, 47 pp, the 25th, 9/10, v2.3.4, $999mm, 1.2e9');
    for (const s of ['A spread of 480 bps.', 'Up 47pp.', 'The 25th.', 'Rated 9/10.', 'Runs v2.3.4.', 'It made $999 million.', 'Revenue near 1.2e9.']) {
      expect(hasUntraceableFigure(s, stated), s).toBe(false);
    }
  });

  it('does not let a small number or zero stand in for an unknown or a count of people', () => {
    expect(untraceable('Total funding raised: 0.')).toBe(true);
    expect(untraceable('It has zero debt.')).toBe(true);
    expect(untraceable('Acme has 7 employees.')).toBe(true);
    expect(untraceable('About 5 users.')).toBe(true);
    expect(untraceable('It raised 3.')).toBe(true);
    // The same bare number in the sources, or a countable thing, is fine.
    expect(hasUntraceableFigure('Acme has 7 employees.', allowedFigures('Level 7 support'))).toBe(false);
    expect(untraceable('It is built on 3 sources and 2 products.')).toBe(false);
  });

  it('matches value AND currency, percent, sign and unit, not digits alone', () => {
    expect(untraceable('Acme has 450 staff.')).toBe(false);
    for (const s of ['It costs $450.', 'Share is 450%.', '120 million users.', 'A change of -450.', 'Revenue of €120M.', 'From 450–120M.', 'Revenue of 120M.']) {
      expect(untraceable(s), s).toBe(true);
    }
    expect(untraceable('Revenue of $120 million.')).toBe(false);
    expect(untraceable('Share is 12.5%.')).toBe(false);
    expect(untraceable('Share is 12.5 percent.')).toBe(false);
    expect(untraceable('Share is 12.5.')).toBe(true);
  });

  it('allows a source date only as that date, never as free-standing numbers', () => {
    for (const s of ['It has 31 employees.', 'Churn is 17%.', 'There were 3 offices in 03.', 'On March 12, 2026 it moved.', 'In 12 March 2026.', 'Revenue reached $31M.']) {
      expect(untraceable(s), s).toBe(true);
    }
    for (const s of ['As of 2026-03-31.', 'As of March 31, 2026.', 'On 31 March 2026.', 'During March 2026.', 'Revenue doubled in 2026.', 'Founded in 2012.']) {
      expect(untraceable(s), s).toBe(false);
    }
  });

  it('does not let the report\'s own bookkeeping widen what may be said', () => {
    const wide = allowedFigures('(digest truncated: 12 more line(s) not shown)', '(40 more people are stored but not listed)', 'DISTINCT SOURCES (41):');
    expect(hasUntraceableFigure('It has 12 offices and 41 sites.', wide)).toBe(true);
    expect(hasUntraceableFigure('Churn is 17%.', allowedFigures('Acme', '2026'))).toBe(true);
  });

  it('reads digits written in other scripts, entities and with invisible characters', () => {
    for (const s of ['９９９ million users.', '٩٩٩ employees.', '&#57;&#57;&#57; employees.', '&#x39;99 employees.', '9​99 employees.', '۹۹۹ employees.']) {
      expect(untraceable(s), s).toBe(true);
    }
    expect(untraceable('４５０ staff.')).toBe(false);
    expect(untraceable('&#52;50 staff.')).toBe(false);
  });

  it('treats a spelled number with a magnitude word as a figure, matched by value', () => {
    expect(untraceable('Five million people use it.')).toBe(true);
    expect(untraceable('Twenty-five thousand customers.')).toBe(true);
    expect(untraceable('A million people use it.')).toBe(false);
    expect(hasUntraceableFigure('Five million people use it.', allowedFigures('5 million users'))).toBe(false);
    expect(hasUntraceableFigure('Staff numbered in the thousands.', allowedFigures('staff in the thousands'))).toBe(false);
  });
});

describe('metric rows, sources and live intel edge cases', () => {
  it('picks the best row per figure, not the first stored', () => {
    const unknown = metric({ metricType: 'revenue', value: null, confidence: 'unknown' });
    const good = { ...sourced('revenue', 120_000_000), id: 'met_good' };
    const older = { ...sourced('revenue', 90_000_000), id: 'met_old', capturedAt: '2020-01-01T00:00:00.000Z' };
    expect(bestMetricRows([unknown, older, good]).map((m) => m.id)).toEqual(['met_good']);
    const input: TopicInput = { ...empty(), metrics: [unknown, good] };
    const digest = topicStoredDigest('metrics', input);
    expect(digest).toContain('Revenue: $120M');
    expect(digest).not.toContain('Revenue: Unknown');
    expect(topicGaps('metrics', input)).not.toContain('Revenue (or ARR) has no sourced figure');
  });

  it('a retained passage with no capture time is the oldest, not a crash', () => {
    const rows = [
      { topic: 'overview', text: 'old', citations: [REUTERS] },
      { topic: 'overview', capturedAt: '2026-10-01T00:00:00.000Z', text: 'new', citations: [SEC] },
    ] as unknown as TopicInput['evidence'];
    expect(() => topicStoredDigest('sources', { ...empty(), evidence: rows })).not.toThrow();
    expect(() => topicGaps('sources', { ...empty(), evidence: rows })).not.toThrow();
  });

  it('news dated in the future is ignored: it neither makes the news current nor counts as a date', () => {
    const future = new Date(NOW.getTime() + 40 * 86_400_000).toISOString().slice(0, 10);
    const item = (publishedDate: string) => ({ id: 'n', source: 'news', title: 'Story', url: 'https://www.reuters.com/n', summary: 's', detail: null,
      publishedDate, sentiment: 'neutral', publishedAt: '2026-10-14T00:00:00.000Z', stale: false });
    const input: TopicInput = { ...full('live_intel'), tab: tab({ items: [item(future)], lastRefreshedAt: '2026-10-10T00:00:00.000Z', cadence: 'weekly' }) };
    expect(topicGaps('live_intel', input)).toEqual(['No dated news in the last 90 days']);
    expect(topicStoredDigest('live_intel', input)).toContain('[publish date not reported] Story');
  });

  it('a stored tab that could not be read is a gap, never raw content', () => {
    const input: TopicInput = { ...full('team_org'), tab: null, unreadable: true };
    expect(topicGaps('team_org', input)).toEqual([UNREADABLE_GAP]);
    expect(topicStoredEvidence('team_org', input).hasContent).toBe(false);
  });

  it('search-provider redirects and local addresses are not sources', () => {
    for (const url of ['https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', 'http://localhost:3000/x', 'https://127.0.0.1/x', 'https://192.168.1.5/x', 'https://intranet.internal/x']) {
      expect(isCitableSource({ title: 't', url }), url).toBe(false);
    }
    expect(isCitableSource({ title: 'Reuters', url: 'https://www.reuters.com/a' })).toBe(true);
    const input: TopicInput = { ...full('team_org'), tab: tab(FULL_TABS.team_org, { citations: [{ title: 'x', url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc' }] }) };
    expect(topicGaps('team_org', input)).toEqual(['No source found for team & org']);
    // A figure whose only source is a redirect is not statable.
    const redirectOnly = metric({ metricType: 'revenue', value: 5, confidence: 'verified', citations: [{ title: 'x', url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc' }] });
    expect(topicStoredDigest('metrics', { ...empty(), metrics: [redirectOnly] })).toContain('Revenue: Unknown');
  });
});
