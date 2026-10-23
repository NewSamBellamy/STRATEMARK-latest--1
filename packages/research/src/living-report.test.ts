import { describe, expect, it, vi } from 'vitest';
import { companyReportSchema, type CompanyMetric } from '@mi/contracts';
import { digestNoteText } from './research-document';
import type { ResearchEvidence } from './research-evidence';
import { gatherReportInputs, selectEvidence, type GatherDeps, type ReportInputs } from './living-report-inputs';
import { gateReport, numbersSupported, numbersIn, reportPrompt } from './living-report-gate';
import { buildStoredDataReport, composeCompanyReport, isReportStale } from './living-report';

const NOW = () => new Date('2026-10-22T10:00:00.000Z');
const base = { id: 'm1', companyId: 'c1', source: null, methodNote: null, capturedAt: '2026-01-01T00:00:00.000Z' } as const;
const metric = (o: Partial<CompanyMetric>): CompanyMetric => ({ ...base, metricType: 'valuation', value: null, confidence: 'unknown', citations: [], ...o }) as CompanyMetric;

const OVERVIEW = [
  '## Source-reported background',
  '',
  'Acme builds warehouse robots for mid-sized retailers and was founded in Austin. It sells the robots on a subscription.',
  '[reuters.com](https://reuters.com/acme)',
  '',
  '## Market position',
  '',
  'Acme competes with Locus Robotics and says it has deployments in 40 warehouses.',
  '[acme.com](https://acme.com/about)',
  '',
  '## Figures',
  '- Valuation: $1.2B — estimated ([reuters](https://reuters.com/v))',
].join('\n');

function deps(over: Partial<GatherDeps> = {}): GatherDeps {
  return {
    company: { id: 'c1', name: 'Acme', oneLiner: 'Acme builds warehouse robots.', websiteUrl: 'https://acme.com', hqLocation: 'Austin', founded: null },
    tabs: {
      overview: { content: { markdown: OVERVIEW }, lastRefreshedAt: '2026-10-01T00:00:00.000Z' },
      products_roadmap: { content: { products: [{ name: 'PickBot', description: 'An autonomous picking robot.', revenueNote: 'not disclosed', url: null, status: 'live' }], roadmap: [{ title: 'PickBot 2', horizon: 'next', detail: 'A faster arm.', date: '2027 H1' }] } },
      team_org: { content: { nodes: [{ id: 'n1', name: 'Jo Rivera', role: 'CEO', group: 'exec', parentId: null, bio: 'Founded Acme in 2018.', isFounder: true }] } },
      live_intel: { content: { items: [{ id: 'i1', source: 'news', title: 'Acme opens a second plant', url: 'https://reuters.com/plant', summary: 'The plant adds capacity.', detail: null, publishedDate: '2026-09-30', sentiment: 'positive', publishedAt: '2026-10-01T00:00:00.000Z', stale: false, publisher: 'Reuters' }], lastRefreshedAt: null, cadence: 'weekly' } },
    },
    metrics: [
      metric({ metricType: 'valuation', value: 1_200_000_000, confidence: 'estimated', citations: [{ title: 'reuters.com', url: 'https://reuters.com/v' }] }),
      metric({ id: 'm2', metricType: 'employees', value: 900, confidence: 'unknown' }),
    ],
    evidence: [],
    ...over,
  };
}

const note = (id: string, text: string): ResearchEvidence => ({ id, companyId: 'c1', topic: 'user_note', capturedAt: '2026-10-20T00:00:00.000Z', text, citations: [], queries: [] });

describe('gatherReportInputs', () => {
  it('reads every stored tab, the figures and the notes into attributed passages', () => {
    const digest = digestNoteText('Q3 memo', { summary: 'Acme is expanding to Europe.', findings: [{ claim: 'A Berlin hub opens in 2027', quote: 'We will open a Berlin hub in 2027.' }], figures: [] });
    const inputs = gatherReportInputs(deps({ evidence: [note('ev1', digest), note('ev2', 'Talked to a buyer: delivery is slow.')] }));
    expect(inputs.tabNames).toEqual(['overview', 'products_roadmap', 'team_org', 'live_intel']);
    expect(inputs.noteCount).toBe(3);
    const keys = inputs.items.map((i) => i.key);
    expect(keys).toContain('company:summary');
    expect(keys).toContain('product:0');
    expect(keys).toContain('figure:valuation:Valuation');
    expect(inputs.items.find((i) => i.key === 'overview:0')).toMatchObject({ kind: 'web', url: 'https://reuters.com/acme', title: 'reuters.com' });
    // the figure bullet inside the overview markdown is the figures' job, not a prose passage
    expect(inputs.items.some((i) => i.origin === 'overview' && /Valuation: \$1\.2B/.test(i.text))).toBe(false);
    expect(inputs.items.filter((i) => i.userSupplied).every((i) => i.kind === 'note')).toBe(true);
    expect(inputs.figures).toHaveLength(1);
    expect(inputs.missingFigures.map((m) => m.label)).toContain('Employees');
  });

  it('never states an unsourced figure and keeps unknown as unknown', () => {
    const inputs = gatherReportInputs(deps({ metrics: [metric({ value: 5e9, confidence: 'verified', citations: [] })] }));
    expect(inputs.figures).toHaveLength(0);
    expect(inputs.items.some((i) => i.origin === 'figures')).toBe(false);
  });

  it('keeps a raw pasted document out when its digest stands for it, and reads it when there is no digest', () => {
    const digest = digestNoteText('Memo', { summary: 'A short summary of the memo.', findings: [], figures: [] });
    const chunk = (title: string, n: number) => note(`c${title}${n}`, `[Provided by you: ${title}, part ${n} of 2]\n\nSome long body text of the document that goes on for a while.`);
    const withDigest = gatherReportInputs(deps({ evidence: [chunk('Memo', 1), note('d', digest)] }));
    expect(withDigest.items.filter((i) => i.userSupplied)).toHaveLength(1);
    const noDigest = gatherReportInputs(deps({ evidence: [chunk('Raw', 1), chunk('Raw', 2)] }));
    expect(noDigest.items.filter((i) => i.userSupplied)).toHaveLength(1);
  });

  it('puts chat-derived evidence in with its own source', () => {
    const chat: ResearchEvidence = { id: 'e9', companyId: 'c1', topic: 'chat:t1', capturedAt: '2026-10-21T00:00:00.000Z', text: 'Acme won a contract with a grocer.', citations: [{ title: 'grocerynews.com', url: 'https://grocerynews.com/x' }], queries: [] };
    const inputs = gatherReportInputs(deps({ evidence: [chat] }));
    expect(inputs.items.find((i) => i.origin === 'chat')).toMatchObject({ url: 'https://grocerynews.com/x', kind: 'web' });
  });

  it('hash: stable for the same data, different when a note is added, a figure changes or a tab moves', () => {
    const a = gatherReportInputs(deps());
    expect(gatherReportInputs(deps()).dataHash).toBe(a.dataHash);
    expect(gatherReportInputs(deps({ evidence: [note('n', 'A new note about pricing that is long enough.')] })).dataHash).not.toBe(a.dataHash);
    const changed = deps();
    changed.metrics = [metric({ value: 2_000_000_000, confidence: 'estimated', citations: [{ title: 'reuters.com', url: 'https://reuters.com/v' }] })];
    expect(gatherReportInputs(changed).dataHash).not.toBe(a.dataHash);
    const moved = deps();
    moved.tabs.live_intel = { content: { items: [], lastRefreshedAt: null, cadence: 'weekly' } };
    expect(gatherReportInputs(moved).dataHash).not.toBe(a.dataHash);
  });
});

describe('selectEvidence', () => {
  it('keeps the highest priority under a bound (the user\'s own research survives) in a stable order', () => {
    const inputs = gatherReportInputs(deps({ evidence: [note('n1', 'My own note: the CFO is leaving soon, said a buyer.')] }));
    const chosen = selectEvidence(inputs.items, { maxItems: 3 });
    expect(chosen).toHaveLength(3);
    expect(chosen.some((s) => s.userSupplied)).toBe(true);
    expect(chosen.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    const order = chosen.map((s) => inputs.items.findIndex((i) => i.key === s.key));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('respects a character budget', () => {
    const inputs = gatherReportInputs(deps());
    const chosen = selectEvidence(inputs.items, { maxChars: 200 });
    expect(chosen.reduce((n, s) => n + s.text.length, 0)).toBeLessThanOrEqual(200);
  });
});

describe('number checking', () => {
  it('reads scaled numbers the way a person writes them', () => {
    expect(numbersIn('$3.4 billion and 1,200 staff, up 12%')).toEqual([3.4e9, 1200, 12]);
    expect(numbersSupported('It is valued at $1.2 billion.', 'Valuation: $1.2B (estimated)')).toBe(true);
    expect(numbersSupported('It is valued at $2 billion.', 'Valuation: $1.2B (estimated)')).toBe(false);
    expect(numbersSupported('No figure at all here.', 'anything')).toBe(true);
    // a magnitude spelled out is still a figure
    expect(numbersSupported('It earns forty billion dollars.', 'It earns well')).toBe(false);
    expect(numbersSupported('Hundreds of stores use it.', 'Used in hundreds of stores')).toBe(true);
  });
});

describe('gateReport', () => {
  const inputs = gatherReportInputs(deps());
  const sources = selectEvidence(inputs.items);
  const idOf = (key: string) => sources.find((s) => s.key === key)!.id;
  const figureText = 'Valuation $1.2B';
  const raw = (blocks: unknown[], extra: Record<string, unknown> = {}) => ({ headline: 'Acme sells robots on subscription', abstract: '', abstractCites: [], sections: [{ id: 'executive_summary', blocks }], ...extra });

  it('keeps a cited paragraph whose numbers are in the cited text', () => {
    const ov1 = idOf('overview:1');
    const g = gateReport(raw([{ type: 'paragraph', text: 'Acme says it has deployments in 40 warehouses and competes with Locus Robotics.', cites: [ov1] }]), sources, figureText);
    expect(g.sections[0]?.blocks[0]).toMatchObject({ type: 'paragraph', citations: [ov1] });
  });

  it('drops an uncited factual paragraph instead of relabelling it as commentary', () => {
    const g = gateReport(raw([{ type: 'paragraph', text: 'Acme leads the warehouse robot market worldwide.', cites: [] }]), sources, figureText);
    expect(g.sections).toHaveLength(0);
    expect(g.dropped.uncited).toBe(1);
  });

  it('drops a paragraph citing an id that does not exist', () => {
    const g = gateReport(raw([{ type: 'paragraph', text: 'Acme leads the warehouse robot market worldwide.', cites: ['s999'] }]), sources, figureText);
    expect(g.sections).toHaveLength(0);
  });

  it('drops a number the cited text does not contain', () => {
    const g = gateReport(raw([
      { type: 'paragraph', text: 'Acme has deployments in 400 warehouses across the country.', cites: [idOf('overview:1')] },
      { type: 'bullets', items: [{ text: 'Revenue reached $90 million last year for the company.', cites: [idOf('overview:0')] }, { text: 'It sells the robots on a subscription basis.', cites: [idOf('overview:0')] }] },
    ]), sources, figureText);
    expect(g.dropped.numbers).toBe(2);
    expect(g.sections[0]?.blocks).toHaveLength(1);
    expect(g.sections[0]?.blocks[0]?.items).toHaveLength(1);
  });

  it('lets analyst commentary be uncited but never carry a new figure', () => {
    const g = gateReport(raw([
      { type: 'analyst_view', text: 'The subscription model should make revenue more predictable than one-off robot sales.', cites: [] },
      { type: 'analyst_view', text: 'Growth looks set to reach 300% next year given the new plant.', cites: [] },
      { type: 'analyst_view', text: 'At the $1.2B estimate the company looks richly valued for its stage.', cites: [] },
    ]), sources, figureText);
    const texts = g.sections[0]!.blocks.map((b) => b.text);
    expect(texts).toHaveLength(2);
    expect(texts.join(' ')).not.toContain('300%');
    expect(texts[1]).toContain('$1.2B');
  });

  it('accepts a quote only when it appears word for word in a cited source', () => {
    const own = idOf('overview:0');
    const ok = gateReport(raw([{ type: 'quote', text: 'It sells the robots on a subscription.', cites: [own], attribution: 'Reuters' }]), sources, figureText);
    expect(ok.sections[0]?.blocks[0]?.type).toBe('quote');
    const bad = gateReport(raw([{ type: 'quote', text: 'We will triple output next year, said the CEO.', cites: [own] }]), sources, figureText);
    expect(bad.sections).toHaveLength(0);
    expect(bad.dropped.quote).toBe(1);
  });

  it('refuses links and markup anywhere, strips citation markers, and ignores unknown block and section kinds', () => {
    const g = gateReport({
      headline: 'See https://evil.example for Acme', abstract: 'Acme builds robots [s1] for retailers across the country.', abstractCites: [idOf('overview:0')],
      sections: [
        { id: 'executive_summary', blocks: [
          { type: 'paragraph', text: 'Read more at https://evil.example about Acme robots and the subscription.', cites: [idOf('overview:0')] },
          { type: 'figures', text: 'Valuation $9 trillion', cites: [] },
          { type: 'analyst_view', text: '<b>Subscriptions</b> make the model steadier than outright sales of robots.', cites: [] },
        ] },
        { id: 'sources', blocks: [{ type: 'paragraph', text: 'A model-written source list that must be ignored entirely.', cites: [idOf('overview:0')] }] },
      ],
    }, sources, figureText);
    expect(g.headline).toBeNull();
    expect(g.abstract).toBe('Acme builds robots for retailers across the country.');
    expect(g.sections).toHaveLength(1);
    expect(g.sections[0]!.blocks).toHaveLength(1);
    expect(g.sections[0]!.blocks[0]!.text).toBe('Subscriptions make the model steadier than outright sales of robots.');
    expect(g.dropped.markup).toBe(1);
  });

  it('a headline with a number that exists nowhere in the evidence is not used', () => {
    expect(gateReport(raw([], { headline: 'Acme is now worth $77 billion' }), sources, figureText).headline).toBeNull();
    expect(gateReport(raw([], { headline: 'Acme is valued around $1.2 billion' }), sources, figureText).headline).toBe('Acme is valued around $1.2 billion');
  });

  it('a malformed model answer yields nothing', () => {
    expect(gateReport('nope', sources, figureText).sections).toEqual([]);
    expect(gateReport({ sections: 5 }, sources, figureText).sections).toEqual([]);
  });
});

describe('the stored-data report (no model)', () => {
  const inputs = gatherReportInputs(deps({ evidence: [note('n1', 'My own note: buyers say delivery is slow.')] }));
  const report = buildStoredDataReport(inputs, NOW);

  it('is a usable, valid document with sourced sections, figures as stored, gaps named and the notes shown', () => {
    expect(companyReportSchema.safeParse(report).success).toBe(true);
    expect(report.status).toBe('stored_data');
    expect(report.headline).toBe('Acme builds warehouse robots');
    const ids = report.sections.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['executive_summary', 'what_they_do', 'business_model', 'leadership_culture', 'momentum', 'risks', 'your_research', 'sources']));
    const figures = report.sections.find((s) => s.id === 'business_model')!.blocks.find((b) => b.type === 'figures')!.figures!;
    expect(figures.find((f) => f.metricType === 'valuation')).toMatchObject({ display: '$1.2B', trust: 'estimated' });
    expect(figures.find((f) => f.label === 'Employees')).toMatchObject({ display: null, trust: 'unknown' });
    expect(report.basedOn.notes).toBe(1);
    expect(report.basedOn.tabs).toBe(4);
    expect(report.basedOn.dataHash).toBe(inputs.dataHash);
  });

  it('every citation points at a real source and every factual block has one', () => {
    const real = new Set(report.sources.map((s) => s.id));
    for (const section of report.sections) for (const block of section.blocks) {
      const cited = [...block.citations, ...(block.items ?? []).flatMap((i) => i.citations), ...(block.figures ?? []).flatMap((f) => f.citations)];
      expect(cited.every((id) => real.has(id))).toBe(true);
      if (block.type === 'paragraph' || block.type === 'quote') expect(block.citations.length).toBeGreaterThan(0);
      if (block.type === 'bullets') expect(block.items!.every((i) => i.citations.length > 0)).toBe(true);
    }
  });

  it('with nothing stored it still renders honestly', () => {
    const empty = buildStoredDataReport(gatherReportInputs({ company: { id: 'c2', name: 'Nilco', oneLiner: 'No source-backed company snapshot is ready yet.', websiteUrl: null, hqLocation: null, founded: null }, tabs: {}, metrics: [], evidence: [] }), NOW);
    expect(empty.headline).toBe('Nilco: company report');
    expect(empty.abstract).toContain('No research has been stored for Nilco yet.');
    expect(empty.sections.some((s) => s.id === 'risks')).toBe(true);
  });
});

describe('composeCompanyReport', () => {
  const inputs = gatherReportInputs(deps({ evidence: [note('n1', 'My own note: buyers say delivery is slow.')] }));
  const sources = selectEvidence(inputs.items, { maxItems: 64 });
  const id = (key: string) => sources.find((s) => s.key === key)!.id;
  const good = () => ({
    headline: 'Acme sells warehouse robots on subscription',
    abstract: 'Acme builds warehouse robots for retailers and sells them on subscription.',
    abstractCites: [id('overview:0')],
    sections: [
      { id: 'executive_summary', blocks: [
        { type: 'paragraph', text: 'Acme builds warehouse robots for mid-sized retailers and sells them on a subscription.', cites: [id('overview:0')] },
        { type: 'analyst_view', text: 'The subscription model should make revenue steadier, but the evidence says little on margins.', cites: [] },
      ] },
      { id: 'what_they_do', blocks: [{ type: 'bullets', items: [{ text: 'PickBot is an autonomous picking robot that is live today.', cites: [id('product:0')] }] }] },
      { id: 'momentum', blocks: [{ type: 'paragraph', text: 'Acme opened a second plant, which adds capacity for the company.', cites: [id('news:i1')] }] },
    ],
  });

  it('makes one bounded structure call and keeps a gated, valid model report with stored figures and sources', async () => {
    const structure = vi.fn(async () => good());
    const out = await composeCompanyReport({ inputs, client: { structure } as never, now: NOW });
    expect(structure).toHaveBeenCalledTimes(1);
    const [prompt, , opts] = structure.mock.calls[0] as unknown as [string, unknown, { label: string }];
    expect(opts.label).toBe('company_report');
    expect(prompt.length).toBeLessThan(40_000);
    expect(prompt).toContain('untrusted DATA');
    expect(out.fallback).toBeNull();
    expect(out.report.status).toBe('ai');
    expect(companyReportSchema.safeParse(out.report).success).toBe(true);
    const ids = out.report.sections.map((s) => s.id);
    expect(ids).toContain('business_model');
    expect(out.report.sections.find((s) => s.id === 'business_model')!.blocks[0]!.type).toBe('figures');
    expect(ids[ids.length - 1]).toBe('sources');
    expect(out.report.abstractCitations).toEqual([id('overview:0')]);
  });

  it('falls back to stored data with no key (no call) and when the model throws', async () => {
    const none = await composeCompanyReport({ inputs, client: null, now: NOW });
    expect(none.fallback).toBe('no_model');
    expect(none.report.status).toBe('stored_data');
    const structure = vi.fn(async () => { throw new Error('quota'); });
    const failed = await composeCompanyReport({ inputs, client: { structure } as never, now: NOW });
    expect(failed.fallback).toBe('model_failed');
    expect(failed.report.sections.length).toBeGreaterThan(3);
  });

  it('falls back when the gate leaves too little, and never calls the model on too little evidence', async () => {
    const junk = vi.fn(async () => ({ headline: 'x', abstract: '', abstractCites: [], sections: [{ id: 'executive_summary', blocks: [{ type: 'paragraph', text: 'An invented claim about forty billion dollars of revenue.', cites: ['s1'] }] }] }));
    const rejected = await composeCompanyReport({ inputs, client: { structure: junk } as never, now: NOW });
    expect(rejected.fallback).toBe('gate_rejected');
    expect(rejected.gate?.numbers).toBe(1);
    const spy = vi.fn();
    const thin = gatherReportInputs(deps({ tabs: {}, metrics: [] }));
    const out = await composeCompanyReport({ inputs: thin, client: { structure: spy } as never, now: NOW });
    expect(out.fallback).toBe('too_little_evidence');
    expect(spy).not.toHaveBeenCalled();
  });

  it('propagates the caller\'s own cancel', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(composeCompanyReport({ inputs, client: { structure: vi.fn() } as never, signal: controller.signal })).rejects.toThrow();
  });

  it('staleness follows the data hash', async () => {
    const out = await composeCompanyReport({ inputs, client: null, now: NOW });
    expect(isReportStale(out.report, inputs)).toBe(false);
    const later: ReportInputs = gatherReportInputs(deps({ evidence: [note('n2', 'Another note that changes what the report is written from.')] }));
    expect(isReportStale(out.report, later)).toBe(true);
  });

  it('the prompt marks the user\'s notes as unverified and lists unknown figures as not to be stated', () => {
    const p = reportPrompt(inputs, sources, '2026-10-22');
    expect(p).toMatch(/the user's own note, unverified/);
    expect(p).toContain('Figures still unknown (do not state them): Employees');
  });
});
