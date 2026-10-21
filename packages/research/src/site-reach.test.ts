/**
 * Own-site reach lane ("Users / Distribution"): synthetic pages, no network.
 * The slot sat at 18.8% because the only paths to it demanded a dated,
 * company-named, unhedged sentence, while companies state their reach on their
 * own homepage undated and in first person ("Trusted by 10,000+ customers").
 */
import { describe, expect, it, vi } from 'vitest';
import type { CompanyMetric } from '@mi/contracts';
import { ownSiteLeadUrls, ownSiteReachRows, pageTextBlocks, pickReachClaim, siteReachClaims } from './site-reach';
import { reportedMetricCitations, reportedStoredCitations, reportedSupportCitations } from './reported-metrics';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import type { OriginalSourceReceipt } from './original-source';
import type { LlmClient } from './types';
import { reachHuntRequest } from './prompts';

const site = 'https://acme.example/';
const page = (text: string, url = site) => ({ url, text });
const claimsOf = (text: string) => siteReachClaims([page(text)]);
const one = (text: string) => claimsOf(text).map((c) => ({ type: c.metricType, def: c.definition, value: c.value, floor: c.lowerBound }));

describe('siteReachClaims — what a company says about its own reach', () => {
  it.each([
    ['Trusted by 10,000+ customers worldwide.', { type: 'users', def: 'customers', value: 10000, floor: true }],
    ['Used by over 50 million people.', { type: 'users', def: 'users', value: 50_000_000, floor: true }],
    ['Join 4,000 companies that run on Acme.', { type: 'users', def: 'customers', value: 4000, floor: false }],
    ['Serving 120,000 merchants across Europe.', { type: 'users', def: 'customers', value: 120000, floor: false }],
    ['2.5 million monthly active users.', { type: 'users', def: 'monthly_active_users', value: 2_500_000, floor: false }],
    ['Now available in 30,000 stores.', { type: 'distribution', def: 'distribution', value: 30000, floor: false }],
    ['Our cans are sold in more than 40 countries.', { type: 'distribution', def: 'distribution', value: 40, floor: true }],
    ['Stocked by 1,200+ retailers nationwide.', { type: 'distribution', def: 'distribution', value: 1200, floor: true }],
    ['Over 100,000 units shipped to date.', { type: 'distribution', def: 'distribution', value: 100000, floor: true }],
  ])('%s', (text, expected) => {
    expect(one(text)).toEqual([expected]);
  });

  it('reads a homepage stat tile whose figure and label sit in separate elements', () => {
    const html = '<html><body><div class="stat"><span>10,000+</span></div><div class="label">Customers</div></body></html>';
    expect(one(html)).toEqual([{ type: 'users', def: 'customers', value: 10000, floor: true }]);
    expect(pageTextBlocks(html)).toContain('10,000+ Customers');
  });

  it('reads the meta description, the page\'s own one-line pitch', () => {
    const html = '<head><meta name="description" content="Acme is trusted by 3,500 teams."></head><body><p>Hello</p></body>';
    expect(one(html)).toEqual([{ type: 'users', def: 'customers', value: 3500, floor: false }]);
  });

  it.each([
    ['hedged', 'About 500 customers use Acme.'],
    ['approximate', 'Nearly 2 million users have signed up.'],
    ['forward-looking', 'We plan to reach 1 million users by 2030.'],
    ['ranking, not a count', 'Trusted by Fortune 500 customers.'],
    ['a year, not a count', 'Since 2019 customers have loved it.'],
    ['staff, not reach', 'We have 200 team members across 16 countries.'],
    ['people without who-uses wording', 'Our 80 people love coffee.'],
    ['two figures in one sentence', 'Trusted by 5,000 customers in 40 countries.'],
    ['too small to be a population', 'We have 3 customers.'],
  ])('rejects a %s', (_label, text) => {
    expect(claimsOf(text)).toEqual([]);
  });

  it('stays silent when the pages disagree, never choosing a side', () => {
    const claims = siteReachClaims([page('Trusted by 10,000 customers.'), page('Trusted by 12,000 customers.', 'https://acme.example/about')]);
    expect(pickReachClaim(claims, 'users')).toBeNull();
  });

  it('accepts the same figure repeated across pages, preferring the plain statement over a floor', () => {
    const claims = siteReachClaims([page('Trusted by 10,000+ customers.'), page('Acme serves 10,000 customers.', 'https://acme.example/about')]);
    expect(pickReachClaim(claims, 'users')).toMatchObject({ value: 10000, lowerBound: false });
  });

  it('prefers a stores figure over a countries figure for distribution', () => {
    const claims = siteReachClaims([page('Sold in 12 countries.'), page('Available in 4,500 stores.')]);
    expect(pickReachClaim(claims, 'distribution')).toMatchObject({ value: 4500, noun: 'stores' });
  });
});

describe('ownSiteReachRows — the gates a row must pass', () => {
  const base = { companyId: 'cmp_1', companyName: 'Acme', website: 'https://acme.example', types: ['users', 'distribution'] as const, capturedAt: '2026-10-14T00:00:00.000Z' };

  it('builds an estimated, undated row labelled as a lower bound, citing the company\'s own page', () => {
    const [row] = ownSiteReachRows({ ...base, pages: [page('<p>Trusted by 10,000+ customers worldwide.</p>')] });
    expect(row).toMatchObject({ metricType: 'users', value: 10000, confidence: 'estimated', source: 'https://acme.example/' });
    expect(row!.reportedSupport).toMatchObject({ provider: 'page-quote', asOf: null, definition: 'customers', unit: 'count' });
    expect(row!.methodNote).toMatch(/own site/i);
    expect(row!.methodNote).toMatch(/lower bound/i);
    expect(row!.methodNote).toMatch(/undated/i);
  });

  it('does not call an exact figure a lower bound', () => {
    const [row] = ownSiteReachRows({ ...base, pages: [page('Available in 30,000 stores.')] });
    expect(row).toMatchObject({ metricType: 'distribution', value: 30000 });
    expect(row!.methodNote).not.toMatch(/lower bound/i);
  });

  it('refuses a page that is not on the company\'s own host', () => {
    expect(ownSiteReachRows({ ...base, pages: [page('Trusted by 10,000 customers.', 'https://news.example/acme')] })).toEqual([]);
  });

  it('only builds the types asked for', () => {
    const rows = ownSiteReachRows({ ...base, types: ['distribution'], pages: [page('Trusted by 10,000 customers. Available in 30,000 stores.')] });
    expect(rows.map((r) => r.metricType)).toEqual(['distribution']);
  });

  it('survives the card-side read path: stored row re-passes strict, lenient and stored checks', () => {
    const [row] = ownSiteReachRows({ ...base, pages: [page('Trusted by 10,000+ customers worldwide.')] });
    const stored = { metricType: row!.metricType, value: row!.value, reportedSupport: row!.reportedSupport, citations: row!.citations };
    expect(reportedMetricCitations('Acme', base.website, stored)).not.toEqual([]);
    expect(reportedSupportCitations('Acme', base.website, stored)).not.toEqual([]);
    expect(reportedStoredCitations('Acme', base.website, stored)).not.toEqual([]);
  });
});

describe('data-integrity gates stay shut for everything that is not the company\'s own page', () => {
  const undated = (provider: 'google-search' | 'page-quote', url: string, text: string) => ({
    metricType: 'users' as const, value: 10000,
    reportedSupport: { provider, companyName: 'Acme', basis: 'users' as const, value: 10000, unit: 'count' as const, asOf: null, definition: 'customers' as const,
      support: { supportIndex: 0, text, sources: [{ chunkIndex: 0, url, title: 'src' }] } },
    citations: [{ url, title: 'src' }],
  });
  const quote = 'Acme is trusted by 10,000 customers.';

  it('an undated users figure from a grounded search answer is still refused', () => {
    const metric = undated('google-search', 'https://acme.example/', quote);
    expect(reportedMetricCitations('Acme', 'https://acme.example', metric)).toEqual([]);
    expect(reportedSupportCitations('Acme', 'https://acme.example', metric)).toEqual([]);
  });

  it('an undated users figure quoted from a third-party page is still refused', () => {
    const metric = undated('page-quote', 'https://blog.example/acme', quote);
    expect(reportedMetricCitations('Acme', 'https://acme.example', metric)).toEqual([]);
    expect(reportedSupportCitations('Acme', 'https://acme.example', metric)).toEqual([]);
  });

  it('a forward-looking own-site sentence is refused even if a row was somehow stored', () => {
    const metric = undated('page-quote', 'https://acme.example/', 'We will reach 10,000 customers soon.');
    expect(reportedMetricCitations('Acme', 'https://acme.example', metric)).toEqual([]);
  });
});

describe('ownSiteLeadUrls', () => {
  it('follows only same-origin about / customers links, at most two', () => {
    const html = '<a href="/about">About</a><a href="https://other.example/about">x</a><a href="/blog/post">b</a><a href="/customers">c</a><a href="/company">d</a>';
    expect(ownSiteLeadUrls(page(html))).toEqual(['https://acme.example/about', 'https://acme.example/customers']);
  });
  it('has no links to follow in plain extracted text', () => {
    expect(ownSiteLeadUrls(page('Plain text homepage'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Repository wiring: the asset lane already reads the homepage; it now also
// fills Users / Distribution from it.
// ---------------------------------------------------------------------------
const now = new Date().toISOString();
function snapshotFor(metrics: CompanyMetric[] = []): RepoSnapshot {
  return {
    markets: [], decks: [], cards: [], metrics, researchJobs: [], originalSourceAttempts: [], researchEvidence: [], companyMarket: {},
    companies: [{ id: 'cmp_1', name: 'Acme', websiteUrl: 'https://acme.example', oneLiner: 'Acme makes things.', logoUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Acme.svg',
      brandTheme: { primary: '#111111', secondary: '#222222', accent: '#333333', text: '#000000', background: '#ffffff', fontFamily: null, source: 'scraped' } }],
  } as unknown as RepoSnapshot;
}
function memoryStore(initial: RepoSnapshot): ResearchStore & { snap: () => RepoSnapshot | null } {
  let data: RepoSnapshot | null = initial;
  return { read: () => data, write: (snap: RepoSnapshot) => { data = structuredClone(snap); }, snap: () => data };
}
const receipt = (url: string, text: string): OriginalSourceReceipt => ({
  requestedUrl: url, finalUrl: url, status: 'retrieved', retrievedAt: now, httpStatus: 200, text, truncated: false,
});
const client = { ground: vi.fn(), structure: vi.fn() } as unknown as LlmClient;

describe('GeminiRepository.fillCompanyAssets — own-site reach', () => {
  const homepage = '<html><body><h1>Acme</h1><p>Trusted by 10,000+ customers worldwide.</p><p>Available in 30,000 stores.</p><a href="/about">About</a></body></html>';

  it('fills users and distribution from the homepage as estimated, undated, own-site rows', async () => {
    const store = memoryStore(snapshotFor());
    const repo = new GeminiRepository({ apiKey: 'k', store, client });
    const read = vi.fn(async (url: string) => receipt(url, url.endsWith('/about') ? '<p>About Acme.</p>' : homepage));
    await repo.fillCompanyAssets('cmp_1', read);
    const rows = store.snap()!.metrics.filter((m) => m.companyId === 'cmp_1');
    const users = rows.find((m) => m.metricType === 'users');
    const distribution = rows.find((m) => m.metricType === 'distribution');
    expect(users).toMatchObject({ value: 10000, confidence: 'estimated' });
    expect(users!.methodNote).toMatch(/lower bound/i);
    expect(distribution).toMatchObject({ value: 30000, confidence: 'estimated' });
    // Read once per company: a second hydration does not re-read the site.
    const calls = read.mock.calls.length;
    await repo.fillCompanyAssets('cmp_1', read);
    expect(read.mock.calls.length).toBe(calls);
  });

  it('never overwrites a human figure or a verified one', async () => {
    const human: CompanyMetric = { id: 'm_u', companyId: 'cmp_1', metricType: 'users', value: 777, confidence: 'user_verified', source: 'Analyst', citations: [], methodNote: null, capturedAt: now };
    const store = memoryStore(snapshotFor([human]));
    const repo = new GeminiRepository({ apiKey: 'k', store, client });
    await repo.fillCompanyAssets('cmp_1', vi.fn(async (url: string) => receipt(url, homepage)));
    expect(store.snap()!.metrics.find((m) => m.metricType === 'users')).toMatchObject({ value: 777, confidence: 'user_verified' });
  });

  it('invents nothing from a site that states no reach', async () => {
    const store = memoryStore(snapshotFor());
    const repo = new GeminiRepository({ apiKey: 'k', store, client });
    await repo.fillCompanyAssets('cmp_1', vi.fn(async (url: string) => receipt(url, '<html><body><p>We make great things.</p></body></html>')));
    expect(store.snap()!.metrics.filter((m) => m.metricType === 'users' || m.metricType === 'distribution')).toEqual([]);
  });
});

describe('reachHuntRequest — the grounded hunt asks for the slot in every profile\'s own noun', () => {
  it('names customers, stores and units, and asks for nothing when neither slot is open', () => {
    const text = reachHuntRequest('Acme', ['users', 'distribution']).join('\n');
    expect(text).toMatch(/customers, users, merchants, clients/);
    expect(text).toMatch(/stores, stockists, retail doors/);
    expect(text).toMatch(/units shipped/);
    expect(reachHuntRequest('Acme', ['employees'])).toEqual([]);
  });
});
