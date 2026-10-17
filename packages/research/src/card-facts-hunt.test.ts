/**
 * Live-run regressions (non-alcoholic spirits deck): the metrics hunt asked only
 * the old metric list, native-currency figures with a USD conversion were
 * rejected, and a stored undated employees row showed Unknown on the card.
 * Every honesty gate stays as strict as before: ranges are never point values,
 * undated card facts stay Unknown, estimates stay rejected.
 */
import { describe, expect, it, vi } from 'vitest';
import { profileHuntTypes, profileMetricTypes, type Company, type CompanyMetric } from '@mi/contracts';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import { reportedCompanyMetrics, reportedMetricCitations, reportedStoredCitations } from './reported-metrics';
import { projectCompanyFacts } from './company-facts';
import { cardFactsHuntRequest } from './prompts';
import { enrichmentOutSchema } from './schemas';
import type { LlmClient, ProviderGrounding } from './types';

const SOURCE = 'https://www.just-drinks.com/lyres';
const NAME = "Lyre's Spirit Co.";
const KIN = 'Kin Euphorics';
// The exact grounded hunt lines from the live run, under a header naming the company.
const VALUATION = "*   **Valuation:** **£270 million (GBP) / ~$360 million to $362 million (USD)** as of **November 15, 2021**. This post-money valuation was established during its £20 million Series A/growth funding round led by D Squared Capital and Morgan Creek Capital Management.";
const DISTRIBUTION = "*   **Distribution:** The company's marketing statements cite distribution across 60+ countries.";
const EMPLOYEES = '*   **Employees:** **51 to 100 employees** (estimated ... range ...)';
const ANSWER = [`Here are the most current figures for ${NAME}:`, VALUATION, DISTRIBUTION, EMPLOYEES].join('\n');

const grounding = (): ProviderGrounding => ({ provider: 'google-search', answerText: ANSWER,
  supports: [VALUATION, DISTRIBUTION, EMPLOYEES].map((text, supportIndex) => ({ supportIndex, text,
    sources: [{ chunkIndex: 0, url: SOURCE, title: 'just-drinks.com' }] })) });

const rows = () => reportedCompanyMetrics({ companyId: 'cmp_l', companyName: NAME, website: 'https://lyres.com',
  enrichment: enrichmentOutSchema.parse({ metrics: {} }), text: ANSWER, grounding: grounding(), capturedAt: '2026-10-10T00:00:00.000Z',
  identity: { answerText: ANSWER, otherCompanies: [KIN] } });
const by = (type: string) => rows().find((r) => r.metricType === type)!;

describe("Lyre's grounded hunt answer, extracted through the reported gate", () => {
  it('stores the leading native-currency valuation (GBP, 2021-11-15), converted and labelled', () => {
    const v = by('valuation');
    expect(v).toMatchObject({ confidence: 'estimated' });
    expect(v.reportedSupport).toMatchObject({ value: 270_000_000, unit: 'GBP', asOf: '2021-11-15' });
    expect(v.value).toBeCloseTo(270_000_000 * 1.321849, 0);
    expect(v.methodNote).toContain('as of 2021-11-15');
    expect(v.methodNote).toContain('GBP');
    expect(v.methodNote).toContain('approximate');
  });
  it('stores the 20M Series A as last_round with the inherited date', () => {
    expect(by('last_round').reportedSupport).toMatchObject({ value: 20_000_000, unit: 'GBP', asOf: '2021-11-15' });
  });
  it('keeps undated distribution Unknown and never turns a 51-100 band into a point', () => {
    expect(by('distribution')).toMatchObject({ value: null, confidence: 'unknown' });
    expect(by('employees')).toMatchObject({ value: null, confidence: 'unknown' });
  });
  it('rows survive the stored-row projection (what the card face reads)', () => {
    const company: Company = { id: 'cmp_l', name: NAME, oneLiner: 'x', logoUrl: null, hqLocation: null, websiteUrl: 'https://lyres.com', brandTheme: null };
    const projected = projectCompanyFacts(company, rows(), []);
    expect(projected.find((m) => m.metricType === 'valuation')).toMatchObject({ confidence: 'estimated' });
    expect(projected.find((m) => m.metricType === 'valuation')!.value).toBeGreaterThan(3e8);
    expect(projected.find((m) => m.metricType === 'last_round')).toMatchObject({ confidence: 'estimated' });
  });
});

describe('gate strictness is unchanged', () => {
  const proof = (type: 'valuation' | 'last_round', value: number, text: string, asOf: string | null) => ({ metricType: type, value,
    reportedSupport: { provider: 'google-search' as const, companyName: 'Acme', basis: type, value, unit: 'GBP' as const, asOf, definition: type,
      support: { supportIndex: 0, text, sources: [{ chunkIndex: 0, url: SOURCE, title: 'just-drinks.com' }] } } });
  it('accepts a native-currency valuation with a trailing conversion', () => {
    expect(reportedMetricCitations('Acme', null, proof('valuation', 270e6,
      'Acme has a valuation of £270 million (GBP) / ~$360 million (USD) as of November 15, 2021.', '2021-11-15'))).not.toEqual([]);
  });
  it('still rejects an estimate word on the leading figure and a native figure with no currency', () => {
    expect(reportedMetricCitations('Acme', null, proof('last_round', 20e6,
      'Acme approximately raised £20 million in a Series A round on November 15, 2021.', '2021-11-15'))).toEqual([]);
    expect(reportedMetricCitations('Acme', null, proof('valuation', 270e6,
      'Acme has a valuation of 270 million as of November 15, 2021.', '2021-11-15'))).toEqual([]);
  });
  it('rejects the converted USD number as a native GBP figure', () => {
    expect(reportedMetricCitations('Acme', null, proof('valuation', 360e6,
      'Acme has a valuation of £270 million (GBP) / ~$360 million (USD) as of November 15, 2021.', '2021-11-15'))).toEqual([]);
  });
  it('rejects ranges at both ends', () => {
    const emp = (value: number) => ({ metricType: 'employees' as const, value,
      reportedSupport: { provider: 'google-search' as const, companyName: 'Acme', basis: 'employees' as const, value, unit: 'count' as const, asOf: null, definition: 'employees' as const,
        support: { supportIndex: 0, text: 'Acme has 51 to 100 employees.', sources: [{ chunkIndex: 0, url: SOURCE, title: 'x' }] } } });
    expect(reportedMetricCitations('Acme', null, emp(51))).toEqual([]);
    expect(reportedMetricCitations('Acme', null, emp(100))).toEqual([]);
  });
});

describe('stored-row projection: undated provider-grounded employees', () => {
  const company: Company = { id: 'cmp_k', name: KIN, oneLiner: 'x', logoUrl: null, hqLocation: null, websiteUrl: 'https://kineuphorics.com', brandTheme: null };
  const row = (text: string, value = 23): CompanyMetric => ({ id: 'met_k', companyId: 'cmp_k', metricType: 'employees', value, confidence: 'estimated',
    source: SOURCE, citations: [{ title: 'just-drinks.com', url: SOURCE }], methodNote: 'stored', capturedAt: '2026-10-05T00:00:00.000Z', lastVerifiedAt: null,
    passageSupport: null,
    reportedSupport: { provider: 'google-search', companyName: KIN, basis: 'employees', value, unit: 'count', asOf: null, definition: 'employees',
      support: { supportIndex: 0, text, sources: [{ chunkIndex: 0, url: SOURCE, title: 'just-drinks.com' }] } } });
  const employees = (metric: CompanyMetric) => projectCompanyFacts(company, [metric], []).find((m) => m.metricType === 'employees')!;
  it('shows an anonymous-bullet figure the write gate accepted (same as the card face recheck)', () => {
    const fact = employees(row('**Employees:** 23 employees (LinkedIn)'));
    expect(fact).toMatchObject({ value: 23, confidence: 'estimated' });
    expect(fact.methodNote).toContain('undated; reporting date not published');
  });
  it('still goes Unknown when the stored support text does not contain the figure, or it is a range end', () => {
    expect(employees(row('**Employees:** 40 employees'))).toMatchObject({ value: null, confidence: 'unknown' });
    expect(employees(row('**Employees:** 11 to 23 employees'))).toMatchObject({ value: null, confidence: 'unknown' });
    expect(reportedStoredCitations(KIN, null, row('**Employees:** 23 employees'))).not.toEqual([]);
  });
});

describe('hunt targeting and request', () => {
  it('derives hunt types from the face slots: every card-fact alternative is requested', () => {
    const operating = profileHuntTypes('operating_company');
    for (const type of ['revenue', 'funding_total', 'last_round', 'distribution', 'employees', 'valuation', 'users', 'arr', 'market_cap']) expect(operating).toContain(type);
    expect(profileMetricTypes('operating_company')).not.toContain('last_round');
    expect(profileHuntTypes('financial_firm')).toEqual(profileMetricTypes('financial_firm'));
  });
  it('words each card figure as one company+currency+date sentence with the no-estimate rule', () => {
    const text = cardFactsHuntRequest(NAME, ['revenue', 'funding_total', 'last_round', 'distribution']).join('\n');
    for (const needle of ['annual revenue', 'total funding', 'latest funding round', 'countries', 'not disclosed', 'no estimates of your own', 'names the company', 'currency']) expect(text).toContain(needle);
    expect(cardFactsHuntRequest(NAME, ['employees'])).toEqual([]);
  });

  const co = (id: string, name: string, site: string) => ({ id, name, oneLiner: `${name} makes spirits.`, websiteUrl: site, logoUrl: null, hqLocation: null, brandTheme: null });
  const snap = (): RepoSnapshot => ({
    schemaVersion: 2, markets: [], decks: [{ id: 'deck_1', marketId: 'mkt_1' }],
    companies: [co('cmp_l', NAME, 'https://lyres.com'), co('cmp_k', KIN, 'https://kineuphorics.com')],
    metrics: [], cards: [{ id: 'card_l', deckId: 'deck_1', cardType: 'company', companyId: 'cmp_l' }],
    viceClaims: [], dashboards: {}, companyMarket: { cmp_l: 'NA spirits', cmp_k: 'NA spirits' },
    opportunity: {}, reports: [], savedCards: [], researchJobs: [], threads: [], capturedAt: new Date().toISOString(),
  } as unknown as RepoSnapshot);
  const store = (s: RepoSnapshot): ResearchStore => { let d: RepoSnapshot | null = s; return { read: () => d, write: (x: RepoSnapshot) => { d = x; } }; };

  it('asks for funding figures while the face has a free place, even when their fixed slots are covered', async () => {
    const human = (metricType: string, value: number) => ({ id: `h_${metricType}`, companyId: 'cmp_l', metricType, value,
      confidence: 'user_verified', source: null, citations: [], methodNote: 'analyst', capturedAt: new Date().toISOString() });
    const prompts = async (metrics: unknown[]) => {
      const s = snap();
      s.metrics = metrics as RepoSnapshot['metrics'];
      const ground = vi.fn().mockResolvedValue({ text: 'nothing', citations: [], queries: [] });
      const repo = new GeminiRepository({ apiKey: 'k', store: store(s), client: { ground, structure: vi.fn().mockResolvedValue({ figures: [] }) } as unknown as LlmClient });
      await repo.huntCompanyMetrics('cmp_l');
      return String(ground.mock.calls[0]?.[0] ?? '');
    };
    // Three families on the face (employees, revenue via ARR, value): one free place.
    const three = [human('employees', 120), human('arr', 5e6), human('valuation', 4e8)];
    const asked = await prompts(three);
    expect(asked).toContain('total funding');
    expect(asked).toContain('latest funding round');
    expect(asked).not.toContain('annual revenue'); // revenue's family is already shown via ARR
    // Four families: the face is full, so the slot rule applies again.
    expect(await prompts([...three, human('distribution', 40)])).not.toContain('total funding');
  });

  it('pays for one hunt when several callers ask for the same company at once', async () => {
    const ground = vi.fn().mockResolvedValue({ text: 'nothing', citations: [], queries: [] });
    const repo = new GeminiRepository({ apiKey: 'k', store: store(snap()), client: { ground, structure: vi.fn().mockResolvedValue({ figures: [] }) } as unknown as LlmClient });
    await repo.huntCompanyMetrics('cmp_l');
    const single = ground.mock.calls.length;
    ground.mockClear();
    const [a, b] = await Promise.all([repo.huntCompanyMetrics('cmp_l'), repo.huntCompanyMetrics('cmp_l', { faceSlotsOnly: true })]);
    expect(b).toBe(a);
    expect(ground.mock.calls.length).toBe(single);
    // A more escalated request is a different approach: it runs after, not joined.
    ground.mockClear();
    await Promise.all([repo.huntCompanyMetrics('cmp_l'), repo.huntCompanyMetrics('cmp_l', { escalation: 1 })]);
    expect(ground.mock.calls.length).toBeGreaterThan(single);
  });

  describe('source binding after the hunt', () => {
    const bound = async (pageText: string) => {
      const ground = vi.fn().mockResolvedValue({ text: ANSWER, citations: [], queries: [], grounding: grounding() });
      const structure = vi.fn().mockResolvedValue({ figures: [] });
      // The grounded answer cites SOURCE but the hunt itself reads no original
      // (no grounded citations), so the reported lane fills; the background
      // binder then reads the cited page.
      const read = vi.fn(async (url: string) => url === SOURCE
        ? { requestedUrl: url, finalUrl: 'https://www.just-drinks.com/news/lyres-series-a', status: 'retrieved' as const, httpStatus: 200,
          text: pageText, contentHash: 'c'.repeat(64), retrievedAt: new Date().toISOString() }
        : { requestedUrl: url, status: 'unavailable' as const, retrievedAt: new Date().toISOString(), reason: 'x' });
      const repo = new GeminiRepository({ apiKey: 'k', store: store(snap()), client: { ground, structure } as unknown as LlmClient, originalSourceReader: read });
      await repo.huntCompanyMetrics('cmp_l');
      await repo.waitForBackgroundJobs();
      expect(read.mock.calls.some(([url]) => url === SOURCE)).toBe(true);
      return (await repo.getCompanyFacts('cmp_l')).find((m) => m.metricType === 'valuation');
    };

    it('links the reported figure to the real article that states it', async () => {
      const valuation = await bound("Lyre's raised £20 million in a round that valued it at £270 million.");
      expect(valuation).toMatchObject({ confidence: 'estimated', source: 'https://www.just-drinks.com/news/lyres-series-a' });
    });

    it('hides the figure when the article it cites does not state it', async () => {
      expect((await bound("Lyre's launched a new gin alternative this spring."))?.value ?? null).toBeNull();
    });
  });

  it('the live hunt asks for the card figures and fills valuation and last_round, nothing else', async () => {
    const ground = vi.fn().mockResolvedValue({ text: ANSWER, citations: [], queries: [], grounding: grounding() });
    const structure = vi.fn().mockResolvedValue({ figures: [] });
    const unreadable = async (url: string) => ({ requestedUrl: url, status: 'unavailable' as const, retrievedAt: new Date().toISOString(), reason: 'x' });
    const repo = new GeminiRepository({ apiKey: 'k', store: store(snap()), client: { ground, structure } as unknown as LlmClient, originalSourceReader: unreadable });
    const result = await repo.huntCompanyMetrics('cmp_l');
    const prompt = String(ground.mock.calls[0]![0]);
    for (const needle of ['CARD FIGURES', 'latest funding round', 'total funding', 'countries']) expect(prompt).toContain(needle);
    expect([...result.filledTypes].sort()).toEqual(['last_round', 'valuation']);
    const facts = await repo.getCompanyFacts('cmp_l');
    expect(facts.find((m) => m.metricType === 'valuation')).toMatchObject({ confidence: 'estimated' });
    expect(facts.find((m) => m.metricType === 'valuation')!.value).toBeGreaterThan(3e8);
    expect(facts.find((m) => m.metricType === 'distribution')?.value ?? null).toBeNull();
    expect(facts.find((m) => m.metricType === 'employees')?.value ?? null).toBeNull();
  });
});
