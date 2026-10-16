import { describe, expect, it, vi } from 'vitest';
import { completenessFixture } from './completeness-report.fixture';
import { FILINGS_WAIT_MS, researchDashboardWithSources } from './dashboard';
import { filingMilestones, MAX_FILING_MILESTONES, timelineDateKey, withFilingMilestones } from './filing-milestones';
import { retrieveOriginalSource, type SourceTransport } from './original-source.node';
import { GeminiRepository, type RepoSnapshot } from './repository';
import type { CompanyFiling } from './sec-filings';
import type { LlmClient } from './types';

const filing = (form: CompanyFiling['form'], filingDate: string, events: string[] = [], reportDate: string | null = null): CompanyFiling => ({
  form, filingDate, reportDate, events, title: form.startsWith('8-K') ? 'Current report' : form === 'S-1' ? 'IPO registration' : 'Quarterly report',
  url: `https://www.sec.gov/Archives/edgar/data/1/${filingDate.replace(/-/g, '')}/doc.htm`,
});

describe('a listed company\'s notable filings, as History milestones', () => {
  it('keeps the events a company story tells, titled as the SEC item says, dated by the event', () => {
    const out = filingMilestones([
      filing('8-K', '2026-05-04', ['Acquisition or sale completed'], '2026-05-01'),
      filing('8-K', '2026-04-20', ['Financial results']),
      filing('10-Q', '2026-04-20'),
      filing('8-K', '2026-02-10', ['Executive or director change', 'Regulation FD disclosure'], '2026-02-09'),
      filing('S-1', '2019-03-01'),
    ]);
    // An S-1 from a listed company is mostly a resale registration: EDGAR never says "IPO", so neither does History.
    expect(out.map((m) => [m.event.date, m.event.title])).toEqual([
      ['May 1, 2026', 'Completed an acquisition or disposition of assets'],
      ['February 9, 2026', 'Director or officer departure, appointment or pay arrangement'],
    ]);
    expect(out[0]!.event.detail).toBe('Form 8-K filed with the SEC on May 4, 2026.');
    expect(out[0]!.citation.url).toBe('https://www.sec.gov/Archives/edgar/data/1/20260504/doc.htm');
  });

  it('is bounded, and empty when nothing notable was filed', () => {
    expect(filingMilestones(Array.from({ length: 20 }, (_, i) => filing('8-K', `2026-01-${String(i + 1).padStart(2, '0')}`, ['Material agreement']))))
      .toHaveLength(MAX_FILING_MILESTONES);
    expect(filingMilestones([filing('10-Q', '2026-04-20'), filing('8-K', '2026-04-20', ['Financial results'])])).toEqual([]);
  });

  it('a filing whose date is not a real day is left out, never shown as nonsense', () => {
    expect(filingMilestones([filing('8-K', '2025-06-02', ['Change in control'], '2025-13-40'),
      filing('8-K', '2025-02-30', ['Change in control'])])).toEqual([]);
  });

  it('reads every written timeline date it can, and no others', () => {
    expect(timelineDateKey('May 1, 2026')).toBe(20260501);
    expect(timelineDateKey('September 2019')).toBe(20190900);
    expect(timelineDateKey('Q3 2019')).toBe(20190700);
    expect(timelineDateKey('Mid 2024')).toBe(20240600);
    expect(timelineDateKey('2025')).toBe(20250000);
    expect(timelineDateKey('Late 2022 / Early 2023')).toBeNull();
    expect(timelineDateKey('Recently')).toBeNull();
  });

  it('places milestones by date among the researched rows, keeps their order, and never repeats one', () => {
    const milestones = filingMilestones([
      filing('8-K', '2026-05-04', ['Acquisition or sale completed'], '2026-05-01'),
      filing('8-K', '2024-07-02', ['Change in control'], '2024-07-01'),
    ]);
    const researched = { founderStory: 's', quotes: [], timeline: [
      { date: '2015', title: 'Founded', detail: '' }, { date: 'Mid 2024', title: 'Series B', detail: '' },
      { date: 'Late 2022 / Early 2023', title: 'Pivot', detail: '' }, { date: 'March 2026', title: 'Launch', detail: '' },
    ] };
    const { content, citations } = withFilingMilestones(researched, [{ title: 'About', url: 'https://gamma.example/about' }], milestones);
    expect(content.timeline.map((row) => row.title)).toEqual(['Founded', 'Series B', 'Change in control of the company', 'Pivot', 'Launch', 'Completed an acquisition or disposition of assets']);
    expect(citations.map((c) => c.url)).toEqual(['https://gamma.example/about', milestones[1]!.citation.url, milestones[0]!.citation.url]);
    const again = withFilingMilestones(content, citations, milestones);
    expect(again.content.timeline).toHaveLength(6);
    expect(again.citations).toHaveLength(3);
  });
});

describe('an event the research already tells is not told twice', () => {
  it('a researched acquisition in the same month keeps the filing out; one in another month does not', () => {
    const milestones = filingMilestones([filing('8-K', '2024-03-15', ['Acquisition or sale completed'], '2024-03-14')]);
    const told = withFilingMilestones({ timeline: [{ date: 'March 2024', title: 'Acquired Foo for $1B', detail: '' }] }, [], milestones);
    expect(told.content.timeline).toHaveLength(1);
    expect(told.citations).toEqual([]);
    const other = withFilingMilestones({ timeline: [{ date: 'May 2024', title: 'Acquired Bar', detail: '' }] }, [], milestones);
    expect(other.content.timeline.map((row) => row.title)).toEqual(['Completed an acquisition or disposition of assets', 'Acquired Bar']);
  });

  it('a researched row of another kind in that month does not hide the filing', () => {
    const milestones = filingMilestones([filing('8-K', '2024-03-15', ['Acquisition or sale completed'], '2024-03-14')]);
    const placed = withFilingMilestones({ timeline: [{ date: 'March 2024', title: 'Launched Fleet Manager', detail: '' }] }, [], milestones);
    expect(placed.content.timeline).toHaveLength(2);
  });
});

describe('a slow SEC never costs History its research', () => {
  it('History lands with its researched rows when the filings never answer', async () => {
    vi.useFakeTimers();
    try {
      const client = {
        ground: async () => ({ text: 'Gamma Shop was founded in 2010.', citations: [{ title: 'About', url: 'https://gamma.example/about' }], queries: [] }),
        structure: async () => ({ founderStory: 'Gamma Shop was founded in 2010.', quotes: [], timeline: [{ date: '2010', title: 'Gamma Shop founded', detail: '' }] }),
      } as unknown as LlmClient;
      const company = { id: 'gamma', name: 'Gamma Shop', oneLiner: 'Gadgets.', logoUrl: null, hqLocation: null, websiteUrl: 'https://gamma.example', brandTheme: null };
      let done = false;
      const pending = researchDashboardWithSources('history', { company, marketName: 'Gadgets', storedMetrics: [], client,
        officialFilings: () => new Promise(() => {}) }).then((result) => { done = true; return result; });
      await vi.advanceTimersByTimeAsync(FILINGS_WAIT_MS - 100);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect((await pending).content.timeline.map((row) => row.title)).toEqual(['Gamma Shop founded']);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---- in the repository: the History tab -------------------------------------------------------

const SUBMISSIONS = JSON.stringify({ cik: '0000000777', name: 'GAMMA SHOP INC', tickers: ['GMMA'], filings: { recent: {
  accessionNumber: ['0000000777-26-000040', '0000000777-26-000031', '0000000777-26-000020'],
  filingDate: ['2026-05-04', '2026-04-20', '2026-02-10'],
  reportDate: ['2026-05-01', '2026-04-20', '2026-02-09'],
  form: ['8-K', '8-K', '8-K'],
  items: ['2.01,9.01', '2.02,9.01', '5.02'],
  primaryDocument: ['gmma-20260501.htm', 'gmma-20260420.htm', 'gmma-20260209.htm'],
}, files: [] } });

function secTransport(reads: string[]): SourceTransport {
  return { lookup: async () => ['93.184.216.34'], read: async ({ url }) => {
    reads.push(url.href);
    if (url.pathname === '/files/company_tickers.json') return { status: 200, headers: { 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify({ 0: { cik_str: 777, ticker: 'GMMA', title: 'GAMMA SHOP INC' } })) };
    if (url.pathname === '/submissions/CIK0000000777.json') return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(SUBMISSIONS) };
    return { status: 404, headers: {}, body: Buffer.from('') };
  } };
}

function historyRepo() {
  const snap = { ...completenessFixture(), viceClaims: [], reports: [], briefings: [], savedCards: [],
    opportunity: {}, researchJobs: [], threads: [] } as unknown as RepoSnapshot;
  const reads: string[] = [];
  const transport = secTransport(reads);
  const story = 'Gamma Shop was founded in 2010 in Austin. Acme Robotics was founded in 2015.';
  const ground = vi.fn(async () => ({ text: story, citations: [{ title: 'About', url: 'https://gamma.example/about' }], queries: [] }));
  const structure = vi.fn(async () => ({ founderStory: 'Gamma Shop was founded in 2010 in Austin.', quotes: [],
    timeline: [{ date: '2010', title: 'Gamma Shop founded', detail: 'Founded in Austin.' }] }));
  let saved = structuredClone(snap);
  const repo = new GeminiRepository({ apiKey: 'test', client: { ground, structure } as unknown as LlmClient, dashboardWarmup: false,
    assetSourceReader: (url) => retrieveOriginalSource(url, transport),
    store: { read: () => structuredClone(saved), write: async (next) => { saved = structuredClone(next); } } });
  return { repo, reads };
}

describe('the History tab of a listed company carries its notable SEC filings, free', () => {
  it('a company with a sourced market cap gets its acquisition and executive change, dated and linked', async () => {
    const { repo } = historyRepo();
    const tab = await repo.getDashboardTab('gamma', 'history');
    expect(tab?.content.timeline.map((row) => [row.date, row.title])).toEqual([
      ['2010', 'Gamma Shop founded'],
      ['February 9, 2026', 'Director or officer departure, appointment or pay arrangement'],
      ['May 1, 2026', 'Completed an acquisition or disposition of assets'],
    ]);
    expect(tab?.citations?.map((c) => c.url)).toContain('https://www.sec.gov/Archives/edgar/data/777/000000077726000040/gmma-20260501.htm');
  });

  it('a company not known to be listed never reads SEC for its History', async () => {
    const { repo, reads } = historyRepo();
    await repo.getDashboardTab('acme', 'products_roadmap').catch(() => null);
    reads.length = 0;
    const tab = await repo.getDashboardTab('beta', 'history').catch(() => null);
    expect(reads.filter((url) => url.includes('sec.gov'))).toEqual([]);
    expect(tab?.content.timeline.some((row) => /SEC/.test(row.detail))).toBeFalsy();
  });
});
