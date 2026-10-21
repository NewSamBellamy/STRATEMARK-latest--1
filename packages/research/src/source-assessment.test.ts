import { describe, expect, it } from 'vitest';
import { CONFIDENCE_LEVELS, sourceAssessmentSchema, type Confidence } from '@mi/contracts';
import {
  assessAuthority,
  assessCurrency,
  assessFigure,
  assessPurpose,
  capConfidence,
  chooseBetter,
  confidenceCapReasons,
  countIndependentSources,
  isIndependentPurpose,
  parseStatedDate,
  type AssessedCandidate,
  type AssessableCitation,
  type FigureAssessment,
} from './source-assessment';

// Fake clock: every test passes this in; nothing here reads the real time.
const NOW = new Date('2026-10-15T12:00:00Z');

/** A YYYY-MM-DD date exactly `months` calendar months before NOW (same day of month). */
function monthsAgo(months: number, extraDays = 0): string {
  const d = new Date(Date.UTC(2026, 9 - months, 15 - extraDays));
  return d.toISOString().slice(0, 10);
}

describe('assessCurrency: horizons', () => {
  // [metric, horizon, a current age, first aging age, a stale age]; aging starts at 70% of the horizon.
  const table: Array<[string, number, number, number, number]> = [
    ['employees', 18, 12, 13, 19],
    ['headcount', 18, 12, 13, 19],
    ['valuation', 12, 8, 9, 13],
    ['revenue', 15, 10, 11, 16],
    ['arr', 15, 10, 11, 16],
    ['funding', 24, 16, 17, 25],
    ['funding_total', 24, 16, 17, 25],
    ['last_round', 24, 16, 17, 25],
    ['leadership', 18, 12, 13, 19],
    ['products', 12, 8, 9, 13],
    ['news', 3, 2, 3, 4],
    ['market_cap', 12, 8, 9, 13],
    ['something_unlisted', 12, 8, 9, 13],
    ['constructor', 12, 8, 9, 13],
  ];
  for (const [metricType, horizon, currentAge, agingAge, staleAge] of table) {
    it(`${metricType}: horizon ${horizon} months`, () => {
      const at = (months: number, extraDays = 0) => assessCurrency({ metricType, publishedDate: monthsAgo(months, extraDays), now: NOW });
      expect(at(0).status).toBe('current');
      expect(at(currentAge)).toMatchObject({ status: 'current', ageMonths: currentAge, horizonMonths: horizon, basis: 'publishedDate' });
      expect(at(agingAge).status).toBe('aging');
      // Exactly on the horizon is still inside it; a day past is stale.
      expect(at(horizon).status).toBe('aging');
      expect(at(horizon, 1).status).toBe('stale');
      expect(at(staleAge).status).toBe('stale');
    });
  }
});

describe('assessCurrency: undated is never current', () => {
  it('has no date at all', () => {
    expect(assessCurrency({ metricType: 'arr', now: NOW })).toEqual({ status: 'undated', ageMonths: null, horizonMonths: 15, basis: 'none', date: null });
  });
  it('ignores capturedAt: when we found it proves nothing', () => {
    const r = assessCurrency({ metricType: 'arr', capturedAt: '2026-10-14T00:00:00Z', now: NOW });
    expect(r.status).toBe('undated');
    expect(r.ageMonths).toBeNull();
  });
  it('treats unreadable and null dates as undated', () => {
    for (const bad of ['last week', 'recently', '', '2026-13-01', '2026-02-30', 'Foo 2026', null, undefined]) {
      expect(assessCurrency({ metricType: 'news', publishedDate: bad, asOf: bad, now: NOW }).status).toBe('undated');
    }
  });
  it('treats a date well in the future as undated, not as brand new', () => {
    expect(assessCurrency({ metricType: 'news', publishedDate: '2027-06-01', now: NOW }).status).toBe('undated');
  });
  it('clamps a date a few days ahead (clock skew) to age 0', () => {
    expect(assessCurrency({ metricType: 'news', publishedDate: '2026-10-20', now: NOW })).toMatchObject({ status: 'current', ageMonths: 0 });
  });
  it('prefers the stated period over the publication date, and falls back when it cannot be read', () => {
    const old = assessCurrency({ metricType: 'arr', asOf: '2024-12', publishedDate: '2026-09-01', now: NOW });
    expect(old).toMatchObject({ status: 'stale', basis: 'asOf', date: '2024-12' });
    expect(assessCurrency({ metricType: 'arr', asOf: 'around then', publishedDate: '2026-09-01', now: NOW })).toMatchObject({ status: 'current', basis: 'publishedDate' });
  });
  it('rejects an invalid clock rather than guessing', () => {
    expect(() => assessCurrency({ metricType: 'arr', publishedDate: '2026-01', now: 'nonsense' })).toThrow(RangeError);
  });
});

describe('parseStatedDate', () => {
  it('reads unambiguous shapes and keeps their precision', () => {
    expect(parseStatedDate('2026')?.iso).toBe('2026');
    expect(parseStatedDate('FY2025')?.iso).toBe('2025');
    expect(parseStatedDate('2026-03')?.iso).toBe('2026-03');
    expect(parseStatedDate('2026-03-05T10:00:00Z')?.iso).toBe('2026-03-05');
    expect(parseStatedDate('Mar 2026')?.iso).toBe('2026-03');
    expect(parseStatedDate('March 5, 2026')?.iso).toBe('2026-03-05');
    expect(parseStatedDate('5 March 2026')?.iso).toBe('2026-03-05');
    expect(parseStatedDate('Sept 2025')?.iso).toBe('2025-09');
    expect(parseStatedDate('Q2 2026')?.iso).toBe('2026-04');
    expect(parseStatedDate('2026 Q3')?.iso).toBe('2026-07');
  });
  it('takes a year-only date at the start of the year so currency is never overstated', () => {
    expect(assessCurrency({ metricType: 'revenue', asOf: '2025', now: NOW })).toMatchObject({ ageMonths: 21.5, status: 'stale' });
  });
  it('returns null for anything it cannot read', () => {
    for (const bad of ['', '  ', 'soon', '2026-00', '2026-02-30', 'Smarch 2026', '12/31/2026', '1800']) expect(parseStatedDate(bad)).toBeNull();
  });
});

describe('assessAuthority', () => {
  const tierOf = (url: string, extra: { publisher?: string; companyDomain?: string } = {}) => assessAuthority({ url, ...extra });
  it('filings, courts and regulators are primary', () => {
    expect(tierOf('https://www.sec.gov/Archives/edgar/data/1/10k.htm')).toMatchObject({ tier: 'primary', reason: 'SEC filing' });
    expect(tierOf('https://www.courtlistener.com/docket/1/')).toMatchObject({ tier: 'primary', reason: 'Court record' });
    expect(tierOf('https://find-and-update.company-information.service.gov.uk/company/1').tier).toBe('primary');
    expect(tierOf('https://www.bls.gov/news.release/x.htm')).toMatchObject({ tier: 'primary', reason: 'Government source' });
  });
  it("the company's own domain is primary, subdomains included, and only that company's", () => {
    expect(tierOf('https://www.acme.com/about', { companyDomain: 'acme.com' })).toMatchObject({ tier: 'primary', reason: "The company's own website" });
    expect(tierOf('https://ir.acme.com/q3', { companyDomain: 'https://www.acme.com' }).tier).toBe('primary');
    expect(tierOf('https://www.acme.com/about').tier).toBe('weak');
    expect(tierOf('https://www.acme.com/about', { companyDomain: 'other.com' }).tier).toBe('weak');
  });
  it('lookalike hosts do not borrow a regulator or the company domain', () => {
    expect(tierOf('https://sec.gov.evil.example/x').tier).toBe('weak');
    expect(tierOf('https://notsec.gov.evil.example/x').tier).toBe('weak');
    expect(tierOf('https://acme.com.evil.example/x', { companyDomain: 'acme.com' }).tier).toBe('weak');
  });
  it('established press and wires are strong', () => {
    expect(tierOf('https://www.reuters.com/business/x').tier).toBe('strong');
    expect(tierOf('https://uk.reuters.com/x').tier).toBe('strong');
    expect(tierOf('https://www.ft.com/content/1').tier).toBe('strong');
    expect(tierOf('https://techcrunch.com/2026/01/01/x').tier).toBe('strong');
    expect(tierOf('https://www.prnewswire.com/news-releases/x.html')).toMatchObject({ tier: 'strong', reason: 'Press-release wire' });
  });
  it('encyclopaedias are reference, aggregators are aggregator', () => {
    expect(tierOf('https://en.wikipedia.org/wiki/Acme').tier).toBe('reference');
    expect(tierOf('https://www.wikidata.org/wiki/Q1').tier).toBe('reference');
    expect(tierOf('https://www.crunchbase.com/organization/acme').tier).toBe('aggregator');
    expect(tierOf('https://finance.yahoo.com/quote/ACME').tier).toBe('aggregator');
    expect(tierOf('https://www.linkedin.com/company/acme').tier).toBe('aggregator');
  });
  it('blogs, user content, SEO farms and unknown hosts are weak', () => {
    for (const url of ['https://www.reddit.com/r/x', 'https://medium.com/@a/b', 'https://acme.substack.com/p/1', 'https://x.com/a/status/1', 'https://random-blog.example/post', 'https://fatjoe.com/seo-services']) {
      expect(tierOf(url).tier).toBe('weak');
    }
    expect(tierOf('https://random-blog.example/post').reason).toBe('Not a recognised publisher');
    expect(tierOf('https://not a url').tier).toBe('weak');
  });
  it('reads the publisher behind a grounding redirect, and does not credit the redirect host', () => {
    const redirect = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc';
    expect(tierOf(redirect, { publisher: 'Reuters' }).tier).toBe('strong');
    expect(tierOf(redirect, { publisher: 'sec.gov' }).tier).toBe('primary');
    expect(tierOf(redirect, { publisher: 'acme.com', companyDomain: 'acme.com' }).tier).toBe('primary');
    expect(tierOf(redirect)).toMatchObject({ tier: 'weak', reason: 'Publisher not recorded' });
    expect(tierOf(redirect, { publisher: 'Some Random Blog' }).tier).toBe('weak');
  });
});

describe('assessPurpose', () => {
  const co = 'acme.com';
  it('filings are regulatory_filing', () => {
    expect(assessPurpose({ url: 'https://www.sec.gov/Archives/edgar/data/1/10k.htm' })).toBe('regulatory_filing');
  });
  it('press wires and press-release pages are company press releases', () => {
    expect(assessPurpose({ url: 'https://www.prnewswire.com/news-releases/acme-raises-1.html' })).toBe('company_press_release');
    expect(assessPurpose({ url: 'https://www.businesswire.com/news/home/1/en' })).toBe('company_press_release');
    expect(assessPurpose({ url: 'https://www.globenewswire.com/news-release/1' })).toBe('company_press_release');
    expect(assessPurpose({ url: 'https://www.acme.com/press/2026/series-b', companyDomain: co })).toBe('company_press_release');
    expect(assessPurpose({ url: 'https://www.acme.com/blog/x', title: 'Acme press release: new CEO', companyDomain: co })).toBe('company_press_release');
    expect(assessPurpose({ url: 'https://some-blog.example/x', title: 'Acme announces Series B' })).toBe('company_press_release');
    expect(assessPurpose({ url: 'https://some-blog.example/x', text: 'FOR IMMEDIATE RELEASE Acme today said' })).toBe('company_press_release');
  });
  it('the company site is company_site', () => {
    expect(assessPurpose({ url: 'https://www.acme.com/about', companyDomain: co })).toBe('company_site');
  });
  it('an established outlet is independent reporting even when the headline says announces', () => {
    expect(assessPurpose({ url: 'https://www.reuters.com/x', title: 'Acme announces layoffs, sources say' })).toBe('independent_reporting');
    expect(assessPurpose({ url: 'https://www.ft.com/content/1', title: 'Acme valued at $5bn' })).toBe('independent_reporting');
  });
  it('sponsored content is sponsored, wherever it runs', () => {
    expect(assessPurpose({ url: 'https://www.forbes.com/sites/brandvoice/acme/', title: 'Acme' })).toBe('sponsored');
    expect(assessPurpose({ url: 'https://www.reuters.com/x', title: 'Sponsored: why Acme wins' })).toBe('sponsored');
    expect(assessPurpose({ url: 'https://www.ft.com/partner-content/acme' })).toBe('sponsored');
  });
  it('campaigning organisations are advocacy', () => {
    expect(assessPurpose({ url: 'https://www.greenpeace.org/report/acme' })).toBe('advocacy');
    expect(assessPurpose({ url: 'https://some-blog.example/x', title: 'Sign the petition against Acme' })).toBe('advocacy');
  });
  it('aggregators, reference pages and unknown hosts stay unknown', () => {
    expect(assessPurpose({ url: 'https://www.crunchbase.com/organization/acme', title: 'Acme announces seed' })).toBe('unknown');
    expect(assessPurpose({ url: 'https://en.wikipedia.org/wiki/Acme' })).toBe('unknown');
    expect(assessPurpose({ url: 'https://some-blog.example/x', title: 'Thoughts on Acme' })).toBe('unknown');
  });
  it('only independent reporting and filings count as independent', () => {
    expect(isIndependentPurpose('independent_reporting')).toBe(true);
    expect(isIndependentPurpose('regulatory_filing')).toBe(true);
    for (const p of ['company_press_release', 'company_site', 'sponsored', 'advocacy', 'unknown'] as const) expect(isIndependentPurpose(p)).toBe(false);
  });
});

describe('countIndependentSources', () => {
  const c = (url: string, title?: string): AssessableCitation => ({ url, title });
  it('counts a syndicated copy on the same domain once', () => {
    expect(countIndependentSources([c('https://www.reuters.com/a', 'One story here today'), c('https://uk.reuters.com/b', 'Another story entirely')])).toBe(1);
  });
  it('counts an identical title on different domains once', () => {
    const title = 'Acme raises $50 million in Series B round';
    expect(countIndependentSources([c('https://www.reuters.com/a', title), c('https://apnews.com/b', `${title}!`)])).toBe(1);
    expect(countIndependentSources([c('https://www.reuters.com/a', title), c('https://apnews.com/b', 'AP: Acme closes $50M Series B')])).toBe(2);
  });
  it('does not merge different outlets on a short generic title', () => {
    expect(countIndependentSources([c('https://www.reuters.com/a', 'Acme'), c('https://apnews.com/b', 'Acme')])).toBe(2);
  });
  it('counts only independent sources: not press releases, the company site, sponsored or aggregators', () => {
    const list = [
      c('https://www.prnewswire.com/news-releases/x', 'Acme raises $50 million'),
      c('https://www.acme.com/press/1', 'Acme raises'),
      c('https://www.crunchbase.com/organization/acme'),
      c('https://www.forbes.com/sites/brandvoice/acme', 'Sponsored'),
      c('https://www.reuters.com/a', 'Acme raises $50 million in Series B'),
    ];
    expect(countIndependentSources(list, 'acme.com')).toBe(1);
    expect(countIndependentSources([...list, c('https://www.sec.gov/Archives/edgar/data/1/x.htm', 'Form D')], 'acme.com')).toBe(2);
  });
  it('skips unusable and duplicate urls and tolerates a missing list', () => {
    expect(countIndependentSources([c('javascript:alert(1)'), c('not a url'), c('https://www.reuters.com/a'), c('https://www.reuters.com/a')])).toBe(1);
    expect(countIndependentSources(undefined)).toBe(0);
    expect(countIndependentSources([])).toBe(0);
  });
});

describe('assessFigure', () => {
  const figure = (citations: AssessableCitation[], metricType = 'valuation', companyDomain = 'acme.com') =>
    assessFigure({ metricType, citations, now: NOW, companyDomain });

  it('a current SEC filing is strong and reads in plain English', () => {
    const a = figure([{ url: 'https://www.sec.gov/Archives/edgar/data/1/x.htm', title: 'Form 10-Q', publishedDate: '2026-08-14' }], 'revenue');
    expect(a).toMatchObject({ grade: 'strong', purpose: 'regulatory_filing', independentSources: 1, companyReportedOnly: false });
    expect(a.currency.status).toBe('current');
    expect(a.plainEnglish).toEqual(['Published Aug 2026 (current)', 'SEC filing (primary source)', '1 independent source']);
  });
  it('two independent current reports are strong', () => {
    const a = figure([
      { url: 'https://www.reuters.com/a', title: 'Acme valued at $5bn in new round', publishedDate: '2026-03-02' },
      { url: 'https://www.ft.com/content/1', title: 'Acme hits $5bn valuation', publishedDate: '2026-03-04' },
    ]);
    expect(a).toMatchObject({ grade: 'strong', independentSources: 2, purpose: 'independent_reporting' });
    expect(a.plainEnglish).toEqual(['Published Mar 2026 (current)', 'Established newspaper or news wire (established publisher)', '2 independent sources']);
  });
  it('one independent current report is adequate', () => {
    expect(figure([{ url: 'https://www.reuters.com/a', publishedDate: '2026-03-02' }]).grade).toBe('adequate');
  });
  it('company-reported only is flagged and never strong', () => {
    const a = figure([
      { url: 'https://www.acme.com/press/series-b', title: 'Acme raises', publishedDate: '2026-09-01' },
      { url: 'https://www.prnewswire.com/news-releases/acme-raises', title: 'Acme raises', publishedDate: '2026-09-01' },
    ]);
    expect(a).toMatchObject({ companyReportedOnly: true, independentSources: 0, grade: 'adequate' });
    expect(a.plainEnglish).toContain('Company-reported only');
  });
  it('an undated source is never current', () => {
    const a = figure([{ url: 'https://www.reuters.com/a', title: 'Acme valued at $5bn', capturedAt: '2026-10-14T00:00:00Z' }]);
    expect(a.currency.status).toBe('undated');
    expect(a.grade).toBe('weak');
    expect(a.plainEnglish[0]).toBe('No publication date: age unknown');
  });
  it('a stale source says how old it is', () => {
    const a = figure([{ url: 'https://www.reuters.com/a', publishedDate: '2024-01-10' }]);
    expect(a.currency.status).toBe('stale');
    expect(a.grade).toBe('weak');
    expect(a.plainEnglish[0]).toBe('Published Jan 2024 (stale: 33 months old)');
  });
  it('the stated period is shown as "As of"', () => {
    const a = figure([{ url: 'https://www.sec.gov/Archives/edgar/data/1/x.htm', asOf: '2026-06', publishedDate: '2026-08-14' }], 'revenue');
    expect(a.plainEnglish[0]).toBe('As of Jun 2026 (current)');
  });
  it('a fresh weak page cannot make a stale figure look current', () => {
    const a = figure([
      { url: 'https://www.reuters.com/a', publishedDate: '2023-01-01' },
      { url: 'https://medium.com/@x/acme', publishedDate: '2026-10-01' },
    ]);
    expect(a.currency.status).toBe('stale');
  });
  it('no citations is weak with nothing claimed', () => {
    const a = figure([]);
    expect(a).toMatchObject({ grade: 'weak', independentSources: 0, companyReportedOnly: false, purpose: 'unknown' });
    expect(a.authority).toEqual({ tier: 'weak', reason: 'No source cited' });
    expect(a.plainEnglish).toEqual(['No publication date: age unknown', 'No source cited']);
  });
  it('flags sponsored and advocacy material', () => {
    const a = figure([
      { url: 'https://www.reuters.com/a', publishedDate: '2026-09-01' },
      { url: 'https://www.forbes.com/sites/brandvoice/acme', publishedDate: '2026-09-01' },
      { url: 'https://www.greenpeace.org/acme', publishedDate: '2026-09-01' },
    ]);
    expect(a.plainEnglish).toEqual(expect.arrayContaining(['Includes sponsored content', 'Includes advocacy material']));
  });
  it('produces something the contract schema accepts', () => {
    const a = figure([{ url: 'https://www.reuters.com/a', publishedDate: '2026-03-02' }]);
    expect(sourceAssessmentSchema.parse(a)).toEqual(a);
    expect(sourceAssessmentSchema.safeParse(figure([])).success).toBe(true);
  });
  it('is deterministic for a given clock', () => {
    const list = [{ url: 'https://www.reuters.com/a', publishedDate: '2026-03-02' }];
    expect(figure(list)).toEqual(figure(list));
    expect(assessFigure({ metricType: 'valuation', citations: list, now: new Date('2030-01-01T00:00:00Z') }).currency.status).toBe('stale');
  });
});

describe('capConfidence', () => {
  const NOW_ISO = '2026-10-15T00:00:00Z';
  const assess = (citations: AssessableCitation[]) => assessFigure({ metricType: 'valuation', citations, now: NOW_ISO, companyDomain: 'acme.com' });
  const strong = assess([{ url: 'https://www.sec.gov/Archives/edgar/data/1/x.htm', publishedDate: '2026-08-01' }]);
  const stale = assess([{ url: 'https://www.reuters.com/a', publishedDate: '2023-01-01' }]);
  const undated = assess([{ url: 'https://www.reuters.com/a' }]);
  const weakOnly = assess([{ url: 'https://medium.com/@x/acme', publishedDate: '2026-09-01' }]);
  const wikiOnly = assess([{ url: 'https://en.wikipedia.org/wiki/Acme', publishedDate: '2026-09-01' }]);
  const companyOnly = assess([{ url: 'https://www.acme.com/press/x', publishedDate: '2026-09-01' }]);
  const none = assess([]);
  const aging = assess([{ url: 'https://www.reuters.com/a', title: 'Acme valued at $5bn', publishedDate: '2025-12-01' }]);
  const all: Array<[string, FigureAssessment]> = [['strong', strong], ['stale', stale], ['undated', undated], ['weakOnly', weakOnly], ['wikiOnly', wikiOnly], ['companyOnly', companyOnly], ['none', none], ['aging', aging]];

  it('keeps verified when the evidence is current, authoritative and independent', () => {
    expect(capConfidence('verified', strong)).toBe('verified');
    expect(confidenceCapReasons(strong)).toEqual([]);
  });
  it('keeps verified for an aging but independently reported figure', () => {
    expect(aging.currency.status).toBe('aging');
    expect(capConfidence('verified', aging)).toBe('verified');
  });
  for (const [name, a] of all.filter(([n]) => !['strong', 'aging'].includes(n))) {
    it(`caps verified to estimated: ${name}`, () => {
      expect(capConfidence('verified', a)).toBe('estimated');
      expect(confidenceCapReasons(a).length).toBeGreaterThan(0);
    });
  }
  it('never raises confidence, whatever the evidence', () => {
    const rank: Record<Confidence, number> = { unknown: 0, estimated: 1, verified: 2, user_verified: 3 };
    for (const requested of CONFIDENCE_LEVELS) {
      for (const [, a] of all) expect(rank[capConfidence(requested, a)]).toBeLessThanOrEqual(rank[requested]);
    }
  });
  it('leaves unknown, estimated and a human sign-off alone', () => {
    for (const [, a] of all) {
      expect(capConfidence('unknown', a)).toBe('unknown');
      expect(capConfidence('estimated', a)).toBe('estimated');
      expect(capConfidence('user_verified', a)).toBe('user_verified');
    }
  });
  it('only ever returns a value it was given or the next level down', () => {
    for (const requested of CONFIDENCE_LEVELS) {
      for (const [, a] of all) expect(['verified', 'estimated', 'unknown', 'user_verified']).toContain(capConfidence(requested, a));
    }
  });
});

describe('chooseBetter', () => {
  const asm = (citations: AssessableCitation[]) => assessFigure({ metricType: 'valuation', citations, now: NOW, companyDomain: 'acme.com' });
  const cand = (value: number | null, url: string, publishedDate?: string, label = url): AssessedCandidate & { label: string } =>
    ({ value, label, assessment: asm([{ url, publishedDate }]) });

  it('newer wins when at least as authoritative', () => {
    const older = cand(100, 'https://www.reuters.com/a', '2026-01-10');
    const newer = cand(120, 'https://www.ft.com/content/1', '2026-08-10');
    const r = chooseBetter(older, newer);
    expect(r.winner).toBe(newer);
    expect(r.loser).toBe(older);
    expect(chooseBetter(newer, older).winner).toBe(newer);
  });
  it('a newer but less authoritative figure does not displace a more authoritative current one', () => {
    const filing = cand(100, 'https://www.sec.gov/Archives/edgar/data/1/x.htm', '2026-05-01');
    const blog = cand(150, 'https://www.crunchbase.com/organization/acme', '2026-09-01');
    expect(chooseBetter(filing, blog).winner).toBe(filing);
    expect(chooseBetter(blog, filing).winner).toBe(filing);
  });
  it('flags a conflict only when both are current and the values differ', () => {
    const a = cand(100, 'https://www.reuters.com/a', '2026-08-01');
    const b = cand(120, 'https://www.ft.com/content/1', '2026-09-01');
    expect(chooseBetter(a, b).conflict).toMatch(/disagree \(100 vs 120\)/);
    expect(chooseBetter(a, cand(100, 'https://www.ft.com/content/1', '2026-09-01')).conflict).toBeNull();
    const stale = cand(90, 'https://www.reuters.com/z', '2023-01-01');
    expect(chooseBetter(a, stale).conflict).toBeNull();
    expect(chooseBetter(a, cand(null, 'https://www.ft.com/content/1', '2026-09-01')).conflict).toBeNull();
  });
  it('a current source beats a stale or undated one', () => {
    const current = cand(120, 'https://www.reuters.com/a', '2026-08-01');
    const stale = cand(90, 'https://www.sec.gov/Archives/edgar/data/1/x.htm', '2022-01-01');
    const undated = cand(95, 'https://www.sec.gov/Archives/edgar/data/1/y.htm');
    expect(chooseBetter(stale, current).winner).toBe(current);
    expect(chooseBetter(undated, current).winner).toBe(current);
  });
  it('a current weak source does not beat a stale authoritative one', () => {
    const weak = cand(500, 'https://medium.com/@x/acme', '2026-09-01');
    const stale = cand(90, 'https://www.sec.gov/Archives/edgar/data/1/x.htm', '2023-01-01');
    expect(chooseBetter(weak, stale).winner).toBe(stale);
  });
  it('with neither current, the newer dated one wins over an undated one', () => {
    const dated = cand(90, 'https://www.reuters.com/a', '2023-01-01');
    const undated = cand(95, 'https://www.reuters.com/b');
    expect(chooseBetter(undated, dated).winner).toBe(dated);
    expect(chooseBetter(undated, dated).conflict).toBeNull();
  });
  it('equal age and authority keeps the first', () => {
    const a = cand(100, 'https://www.reuters.com/a', '2026-08-01');
    const b = cand(100, 'https://www.ft.com/content/1', '2026-08-01');
    expect(chooseBetter(a, b).winner).toBe(a);
    expect(chooseBetter(b, a).winner).toBe(b);
  });
  it('at the same age the more authoritative wins', () => {
    const wire = cand(100, 'https://www.reuters.com/a', '2026-08-01');
    const filing = cand(100, 'https://www.sec.gov/Archives/edgar/data/1/x.htm', '2026-08-01');
    expect(chooseBetter(wire, filing).winner).toBe(filing);
  });
});
