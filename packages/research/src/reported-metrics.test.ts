import { describe, expect, it, vi } from 'vitest';
import { companyMetricSchema, comparableMetricBasis, metricDefinitionLabel, metricObservationIdentity, reportedMetricSupportSchema } from '@mi/contracts';
import { reportedCompanyMetrics, reportedMetricCitations, sentenceAround } from './reported-metrics';
import { EQUINIX_ANSWER_TEXT, EQUINIX_SUPPORTS } from './equinix-live-fixture';
import { enrichmentOutSchema } from './schemas';
import { METRIC_MEASUREMENT_INSTRUCTIONS } from './prompts';
import { extractProviderGrounding } from './grounding-support';
import { hydrateCompanyCard, verifyCompanyCardOriginals } from './company-agent';
import { projectCompanyFacts } from './company-facts';
import type { LlmClient, MarketPlan } from './types';
import type { OriginalSourceServices } from './original-source';

vi.mock('./logos', () => ({ faviconUrl: () => null, resolveLogo: async () => ({ url: null }) }));
const url = 'https://acme.com/investors/results';
const description = 'Acme builds collaboration software for product teams.';
const report = 'Acme reported annual revenue of $40 million for the year ended September 30, 2026. Its customers include product teams.';
const plan: MarketPlan = { marketName: 'Software', vertical: 'SaaS', geography: null, notes: null, searchThemes: [] };
const candidate = { name: 'Acme', domain: 'acme.com', descriptor: 'UNSUPPORTED FALLBACK', cardTypes: ['company' as const] };
// Exact retained Google support text supplied from the completed market run.
const openAiSegments = {
  description: '**Company Description**\nOpenAI is an artificial intelligence research and deployment company focused on developing safe and beneficial artificial general intelligence (AGI)',
  employees: '**Headcount / Number of Employees**\nOpenAI employed approximately 4,500 employees as reported by the *Financial Times* on March 21, 2026',
  valuation: '**Valuation**\nOpenAI is a privately held company that was valued at a post-money valuation of $852 billion USD upon closing a $122 billion funding round on March 31, 2026, with Bloomberg reporting on September 29, 2026, that the company entered preliminary discussions for new financing at a $1.4 trillion USD valuation',
  revenue: '**Annual Revenue & Recurring Revenue (ARR)**\nOpenAI achieved an estimated full-year 2025 annual revenue of $13.1 billion USD',
  mixedEmployees: '**Headcount / Number of Employees**\nOpenAI employed approximately 4,500 employees as reported by the *Financial Times* on March 21, 2026 (with total global workforce estimates including contractors and operations reaching 8,171 per Revelio Labs as of March 2026)',
};
function openAiFixture(metrics: Record<string, unknown> = {}, segments = Object.values(openAiSegments)) {
  const text = segments.join('\n\n');
  const sourceUrl = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/openai-retained-fixture';
  const grounding = extractProviderGrounding(text, {
    groundingChunks: [{ web: { uri: sourceUrl, title: 'ft.com' } }],
    // True sequential offsets: a support whose text prefixes a later support
    // must not have its startIndex alias to the earlier occurrence.
    groundingSupports: segments.map((passage, index) => {
      const start = text.indexOf(passage, index === 0 ? 0 : text.indexOf(segments[index - 1]!) + segments[index - 1]!.length);
      return { segment: { text: passage, startIndex: start, endIndex: start + passage.length }, groundingChunkIndices: [0] };
    }),
  });
  const client: LlmClient = { ground: vi.fn(async () => ({ text, citations: [{ url: sourceUrl, title: 'ft.com' }], queries: [], grounding })),
    structure: vi.fn(async (_prompt, schema) => schema.parse({ website: 'https://openai.com', metrics })) as LlmClient['structure'] };
  const claim = (value: number, basis: 'employees' | 'valuation' | 'arr', quote: string, asOf: string | null = null) => ({
    value, confidence: 'estimated', reportedClaim: { sourceUrl, quote, asOf, basis,
      definition: basis === 'arr' ? 'annual_revenue' : basis, unit: basis === 'employees' ? 'count' : 'USD' },
  });
  const hydrate = () => hydrateCompanyCard({ candidate: { ...candidate, name: 'OpenAI', domain: 'openai.com' }, client, plan });
  return { client, claim, hydrate, grounding };
}
function fixture(text = report, value = 40_000_000) {
  const answer = `${description}\n${text}`;
  const grounding = extractProviderGrounding(answer, {
    groundingChunks: [{ web: { uri: url, title: 'Acme results' } }],
    groundingSupports: [description, text].map((passage, index) => ({
      segment: { text: passage, startIndex: index * 100, endIndex: index * 100 + passage.length }, groundingChunkIndices: [0],
    })),
  });
  const client: LlmClient = {
    ground: vi.fn(async () => ({ text: answer, citations: [{ url, title: 'Acme results' }], queries: [], grounding })),
    structure: vi.fn(async (_prompt, schema) => schema.parse({
      oneLiner: 'MODEL INVENTED SUMMARY', website: 'https://acme.com', facts: { headcount: 1000 },
      metrics: { arr: { value, confidence: 'verified', sourceIndex: 0, passageSupport: {
        sourceUrl: url, quote: text, asOf: '2026-09-30', periodStart: '2025-10-01', basis: 'arr', definition: 'annual_revenue', unit: 'USD',
      } } },
    })) as LlmClient['structure'],
  };
  const originals: OriginalSourceServices = { retrieve: vi.fn(async () => { throw new Error('Reads must not block publication'); }),
    save: vi.fn(async () => {}), list: vi.fn(async () => []) };
  return { client, originals };
}
async function hydrate(client: LlmClient, originals?: OriginalSourceServices) {
  return hydrateCompanyCard({ candidate, client, plan, originalSources: originals, recoverMissingMetrics: true });
}
describe('provider-supported fast company hydration', () => {
  it('recovers retained revenue when a numeric proposal omits its selector', async () => {
    const { hydrate } = openAiFixture({ arr: { value: 13_100_000_000, confidence: 'estimated' } }, [openAiSegments.revenue]);
    expect((await hydrate()).metrics.find(row => row.metricType === 'arr')).toMatchObject({
      value: 13_100_000_000, confidence: 'estimated', reportedSupport: { definition: 'annual_revenue', asOf: null },
    });
  });
  it('keeps mixed annual revenue and ARR ambiguous within one support segment', async () => {
    const { hydrate } = openAiFixture({}, [`${openAiSegments.revenue}. OpenAI reported ARR of USD 70 billion.`]);
    expect((await hydrate()).metrics.find(row => row.metricType === 'arr')).toMatchObject({ value: null, confidence: 'unknown' });
  });
  it.each([false, true])('recovers clean employee support with the actual mixed-scope duplicate (reverse order: %s) through empty-selector offline recovery', reverse => {
    const segments = [openAiSegments.employees, openAiSegments.mixedEmployees];
    if (reverse) segments.reverse();
    const { grounding } = openAiFixture({}, segments);
    const before = structuredClone(grounding);
    const rows = reportedCompanyMetrics({ companyId: 'openai', companyName: 'OpenAI', website: 'https://openai.com',
      enrichment: enrichmentOutSchema.parse({ metrics: {} }), text: grounding!.answerText, grounding,
      capturedAt: '2026-10-06T00:00:00.000Z' });
    expect(rows.find(row => row.metricType === 'employees')).toMatchObject({ value: 4500, confidence: 'estimated',
      reportedSupport: { asOf: null, support: { text: openAiSegments.employees } } });
    expect(grounding).toEqual(before);
  });
  it('does not recover an employee figure from the mixed employees-plus-contractors passage alone', () => {
    const { grounding } = openAiFixture({}, [openAiSegments.mixedEmployees]);
    const rows = reportedCompanyMetrics({ companyId: 'openai', companyName: 'OpenAI', website: 'https://openai.com',
      enrichment: enrichmentOutSchema.parse({ metrics: {} }), text: grounding!.answerText, grounding,
      capturedAt: '2026-10-06T00:00:00.000Z' });
    expect(rows.find(row => row.metricType === 'employees')).toMatchObject({ value: null, confidence: 'unknown' });
  });
  it('keeps annual revenue versus ARR unknown during empty-selector recovery rather than selecting or dating either', () => {
    const recurringRevenue = 'OpenAI reported ARR of USD 70 billion.';
    const { grounding } = openAiFixture({}, [openAiSegments.employees, openAiSegments.mixedEmployees,
      openAiSegments.revenue, recurringRevenue]);
    const rows = reportedCompanyMetrics({ companyId: 'openai', companyName: 'OpenAI', website: 'https://openai.com',
      enrichment: enrichmentOutSchema.parse({ metrics: {} }), text: grounding!.answerText, grounding,
      capturedAt: '2026-10-06T00:00:00.000Z' });
    expect(rows.find(row => row.metricType === 'employees')!.value).toBe(4500);
    expect(rows.find(row => row.metricType === 'arr')).toMatchObject({ value: null, confidence: 'unknown', reportedSupport: null });
  });
  it('accepts the retained OpenAI description/headcount headings while retaining the exact provider segment', async () => {
    const fixture = openAiFixture();
    fixture.client.structure = vi.fn(async (_prompt, schema) => schema.parse({ metrics: {
      employees: fixture.claim(4500, 'employees', openAiSegments.employees),
    } })) as LlmClient['structure'];
    const result = await fixture.hydrate();
    expect(result.company.oneLiner).toBe(openAiSegments.description.split('\n')[1]);
    expect(result.metrics.find(row => row.metricType === 'employees')).toMatchObject({ value: 4500, confidence: 'estimated',
      lastVerifiedAt: null, reportedSupport: { asOf: null, support: fixture.grounding!.supports[1] } });
  });
  it('recovers omitted OpenAI reported counts/revenue, but does not choose among mixed valuation/funding contexts or invent dates', async () => {
    const { hydrate } = openAiFixture({ employees: null, arr: null, valuation: null, market_cap: null });
    const result = await hydrate();
    expect(result.metrics.find(row => row.metricType === 'employees')).toMatchObject({ value: 4500,
      confidence: 'estimated', reportedSupport: { asOf: null, support: { text: openAiSegments.employees } } });
    expect(result.metrics.find(row => row.metricType === 'arr')).toMatchObject({ value: 13_100_000_000,
      confidence: 'estimated', reportedSupport: { asOf: null, definition: 'annual_revenue', support: { text: openAiSegments.revenue } } });
    expect(result.metrics.find(row => row.metricType === 'valuation')).toMatchObject({ value: null, confidence: 'unknown' });
    expect(result.metrics.find(row => row.metricType === 'market_cap')).toMatchObject({ value: null, confidence: 'unknown' });
    expect(result.metrics.find(row => row.metricType === 'arr')!.reportedSupport!.periodStart).toBeUndefined();
  });
  it('does not let a finance paragraph become the summary merely because it says is a', async () => {
    const { hydrate } = openAiFixture({}, [openAiSegments.valuation, openAiSegments.description, openAiSegments.employees]);
    expect((await hydrate()).company.oneLiner).toBe(openAiSegments.description.split('\n')[1]);
    expect((await openAiFixture({}, [openAiSegments.valuation]).hydrate()).company.oneLiner).toBe('No source-backed company snapshot is ready yet.');
  });
  it.each([1_400_000_000_000, 122_000_000_000])('does not turn financing discussion/funding amount %s into a completed valuation', async value => {
    const fixture = openAiFixture();
    fixture.client.structure = vi.fn(async (_prompt, schema) => schema.parse({ metrics: {
      valuation: fixture.claim(value, 'valuation', openAiSegments.valuation, '2026-09-29'),
    } })) as LlmClient['structure'];
    expect((await fixture.hydrate()).metrics.find(row => row.metricType === 'valuation')!.value).toBeNull();
  });
  it('allows an explicitly selected completed valuation without substituting the later speculative number', async () => {
    const fixture = openAiFixture();
    fixture.client.structure = vi.fn(async (_prompt, schema) => schema.parse({ metrics: {
      valuation: fixture.claim(852_000_000_000, 'valuation', openAiSegments.valuation, '2026-03-31'),
    } })) as LlmClient['structure'];
    expect((await fixture.hydrate()).metrics.find(row => row.metricType === 'valuation')).toMatchObject({ value: 852_000_000_000,
      confidence: 'estimated', reportedSupport: { asOf: '2026-03-31', support: { text: openAiSegments.valuation } } });
  });
  it('does not attach the later discussion date to the earlier completed valuation', async () => {
    const fixture = openAiFixture();
    fixture.client.structure = vi.fn(async (_prompt, schema) => schema.parse({ metrics: {
      valuation: fixture.claim(852_000_000_000, 'valuation', openAiSegments.valuation, '2026-09-29'),
    } })) as LlmClient['structure'];
    expect((await fixture.hydrate()).metrics.find(row => row.metricType === 'valuation')!.value).toBeNull();
  });
  it.each(['other-company', 'wrong-date'] as const)('retains attribution/date rejection beneath a stripped heading: %s', async fault => {
    const text = fault === 'other-company' ? openAiSegments.employees.replace('OpenAI employed', 'Otherco employed') : openAiSegments.employees;
    const fixture = openAiFixture({}, [text]);
    fixture.client.structure = vi.fn(async (_prompt, schema) => schema.parse({ metrics: {
      employees: fixture.claim(4500, 'employees', text, fault === 'wrong-date' ? '2026-10-06' : null),
    } })) as LlmClient['structure'];
    expect((await fixture.hydrate()).metrics.find(row => row.metricType === 'employees')!.value).toBeNull();
  });
  it('accepts actual Google heading-prefixed attribution without deleting provider text', async () => {
    const text = 'Original source: https://www.microsoft.com/investor\n* **Employees (Headcount):** Microsoft Corporation employed approximately 228,000 full-time employees worldwide as of June 30, 2025, according to its Human Rights Transparency Report 2025 and Form 10-K disclosures';
    const summary = '* **Company Description:** Microsoft Corporation is a multinational technology provider that develops software products and cloud-computing services';
    const answer = `${summary}\n${text}`;
    const sourceUrl = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/microsoft-fixture';
    const grounding = extractProviderGrounding(answer, {
      groundingChunks: [{ web: { uri: sourceUrl, title: 'microsoft.com' } }],
      groundingSupports: [summary, text].map(passage => ({ segment: { text: passage }, groundingChunkIndices: [0] })),
    });
    const client: LlmClient = {
      ground: vi.fn(async () => ({ text: answer, citations: [{ url: sourceUrl, title: 'microsoft.com' }], queries: [], grounding })),
      structure: vi.fn(async (prompt, schema) => {
        expect(prompt).toContain('PROVIDER SUPPORT CATALOG');
        expect(prompt).toContain(sourceUrl);
        return schema.parse({ website: 'https://www.microsoft.com', metrics: { employees: {
          value: 228000, confidence: 'estimated', reportedClaim: { sourceUrl, quote: text, asOf: '2025-06-30', basis: 'employees', unit: 'count', definition: 'employees' },
        } } });
      }) as LlmClient['structure'],
    };
    const result = await hydrateCompanyCard({ candidate: { ...candidate, name: 'Microsoft Corporation', domain: 'microsoft.com' }, client, plan });
    expect(result.metrics.find(row => row.metricType === 'employees')).toMatchObject({ value: 228000, confidence: 'estimated', reportedSupport: { support: { text } } });
    expect(result.company.oneLiner).toBe('Microsoft Corporation is a multinational technology provider that develops software products and cloud-computing services');
  });
  it('requires selectors in the documented metric JSON shape, not an optional afterthought', async () => {
    const { client } = fixture(); await hydrate(client);
    const prompt = vi.mocked(client.structure).mock.calls[0]![0];
    expect(prompt).toContain('"reportedClaim":');
    expect(prompt).toContain('PROVIDER SUPPORT CATALOG');
  });
  it('recovers an omitted extraction only from an unambiguous literal provider measurement', async () => {
    const { client } = fixture('Microsoft Corporation generated total annual revenue of $281.7 billion USD for the entire legal company in the fiscal year ended June 30, 2025, according to its 2025 Annual Report published on June 30, 2025', 281700000000);
    client.structure = vi.fn(async (_prompt, schema) => schema.parse({ metrics: { arr: null } })) as LlmClient['structure'];
    const result = await hydrateCompanyCard({ candidate: { ...candidate, name: 'Microsoft Corporation' }, client, plan });
    expect(result.metrics.find(row => row.metricType === 'arr')).toMatchObject({ value: 281700000000, confidence: 'estimated', reportedSupport: { definition: 'annual_revenue', asOf: '2025-06-30' } });
  });
  it.each([null, undefined])('recovers the worldwide employee total with an omitted selector (%s), not parenthetical country counts', async selector => {
    const text = 'Microsoft Corporation employed approximately 228,000 full-time personnel worldwide (125,000 in the United States and 103,000 internationally) as of June 30, 2025, according to its Annual Report on Form 10-K published on July 30, 2025';
    const { client } = fixture(text, 228000);
    client.structure = vi.fn(async (_prompt, schema) => schema.parse({ metrics: selector === null ? { employees: null } : {} })) as LlmClient['structure'];
    const result = await hydrateCompanyCard({ candidate: { ...candidate, name: 'Microsoft Corporation' }, client, plan });
    expect(result.metrics.find(row => row.metricType === 'employees')).toMatchObject({ value: 228000, confidence: 'estimated',
      lastVerifiedAt: null, reportedSupport: { asOf: '2025-06-30', support: { text } } });
  });
  it('does not infer a worldwide employee total from parenthetical country counts alone', async () => {
    const text = 'Microsoft Corporation employed full-time personnel worldwide (125,000 in the United States and 103,000 internationally) as of June 30, 2025';
    const { client } = fixture(text);
    client.structure = vi.fn(async (_prompt, schema) => schema.parse({ metrics: { employees: null } })) as LlmClient['structure'];
    const result = await hydrateCompanyCard({ candidate: { ...candidate, name: 'Microsoft Corporation' }, client, plan });
    expect(result.metrics.find(row => row.metricType === 'employees')).toMatchObject({ value: null, confidence: 'unknown', reportedSupport: null });
  });
  it.each([
    ['employees', 228000, 'count', 'Microsoft Corporation employed approximately 228,000 full-time personnel worldwide (125,000 in the United States and 103,000 internationally) as of June 30, 2025, according to its Annual Report on Form 10-K published on July 30, 2025'],
    ['arr', 281724000000, 'USD', 'Microsoft Corporation generated total annual consolidated revenue of $281.724 billion for its full fiscal year ended June 30, 2025, according to its Form 10-K published on July 30, 2025 (within which its Azure cloud business accounted for more than $75 billion)'],
  ] as const)('retains the actual %s phrasing without binding a subdivision figure', async (type, value, unit, text) => {
    const { client } = fixture(text, value);
    client.structure = vi.fn(async (_prompt, schema) => schema.parse({ metrics: { [type]: { value, confidence: 'estimated', reportedClaim: {
      sourceUrl: url, quote: text, asOf: '2025-06-30', basis: type, unit, definition: type === 'arr' ? 'annual_revenue' : type,
    } } } })) as LlmClient['structure'];
    const result = await hydrateCompanyCard({ candidate: { ...candidate, name: 'Microsoft Corporation' }, client, plan });
    expect(result.metrics.find(row => row.metricType === type)).toMatchObject({ value, confidence: 'estimated' });
  });
  it('does not relabel selected product-feature users as whole-company users', async () => {
    const text = 'Acme reported 800 million monthly active users engaging with AI-powered features across its software portfolio and 100 million monthly active users across its Copilot suite as of September 30, 2026.';
    const { client } = fixture(text);
    client.structure = vi.fn(async (_prompt, schema) => schema.parse({ metrics: { users: { value: 800000000, confidence: 'estimated', reportedClaim: {
      sourceUrl: url, quote: text, asOf: '2026-09-30', basis: 'users', unit: 'count', definition: 'monthly_active_users',
    } } } })) as LlmClient['structure'];
    expect((await hydrate(client)).metrics.find(row => row.metricType === 'users')!.value).toBeNull();
  });
  it.each([
    'Otherco reported annual revenue of $40 million as of September 30, 2026.',
    'Acme reported annual revenue of CAD $40 million as of September 30, 2026.',
    'Acme reported annual revenue of $40 million and annual revenue of $50 million as of September 30, 2026.',
  ])('does not recover an omitted but ambiguous/misattributed figure: %s', async text => {
    const { client } = fixture(text);
    client.structure = vi.fn(async (_prompt, schema) => schema.parse({ metrics: { arr: null } })) as LlmClient['structure'];
    expect((await hydrate(client)).metrics.find(row => row.metricType === 'arr')!.value).toBeNull();
  });
  it('requests reported facts without proxy hunts or contradictory strict original-date instructions', async () => {
    const { client } = fixture(); await hydrate(client);
    const researchPrompt = vi.mocked(client.ground).mock.calls[0]![0];
    expect(researchPrompt).not.toContain('ALWAYS search for these');
    expect(researchPrompt).not.toContain('reasonably estimated');
    expect(researchPrompt).not.toContain('grounded proxy estimates');
    const structurePrompt = vi.mocked(client.structure).mock.calls[0]![0];
    expect(structurePrompt).not.toContain(METRIC_MEASUREMENT_INSTRUCTIONS);
    expect(structurePrompt).not.toContain('if derived');
    expect(structurePrompt).toContain('otherwise null (undated)');
    expect(structurePrompt).toContain('not verified');
  });
  it('publishes after ground/structure with actual per-claim support, before original reads or recovery', async () => {
    const { client, originals } = fixture(); const result = await hydrate(client, originals);
    expect(client.ground).toHaveBeenCalledTimes(1); expect(client.structure).toHaveBeenCalledTimes(1);
    expect(originals.retrieve).not.toHaveBeenCalled(); expect(originals.save).not.toHaveBeenCalled();
    expect(result.metrics.find(row => row.metricType === 'arr')).toMatchObject({ value: 40_000_000,
      confidence: 'estimated', lastVerifiedAt: null, passageSupport: null, reportedSupport: {
        provider: 'google-search', companyName: 'Acme', basis: 'arr', definition: 'annual_revenue', asOf: '2026-09-30',
        support: { supportIndex: 1, text: report, sources: [{ chunkIndex: 0, url }] },
      } });
    expect(result.metrics.find(row => row.metricType === 'arr')!.methodNote).toContain('not verified');
    expect(result.company.oneLiner).toBe(description);
    expect(result.card.citations).toEqual([expect.objectContaining({ url })]);
    expect(result.primaryCard.metrics).toEqual(result.metrics); expect(result.memory.card.metrics).toEqual(result.metrics);
    expect(result.metrics.find(row => row.metricType === 'employees')!.value).toBeNull();
  });
  it.each(['citation-only', 'forged-model', 'wrong-value', 'wrong-company', 'wrong-basis', 'wrong-date', 'invalid-url', 'detached-answer', 'partner-figure'])(
    'withholds a %s numeric proposal', async fault => {
      const text = fault === 'wrong-company' ? report.replaceAll('Acme', 'Otherco')
        : fault === 'wrong-basis' ? report.replace('annual revenue', 'valuation')
          : fault === 'wrong-date' ? report.replace('September 30, 2026', 'September 30, 2025')
            : fault === 'partner-figure' ? 'Acme partners with Otherco. Otherco reported annual revenue of $40 million for the year ended September 30, 2026.' : report;
      const { client } = fixture(text, fault === 'wrong-value' ? 90_000_000 : 40_000_000);
      const ground = await client.ground('fixture');
      if (fault === 'citation-only' || fault === 'forged-model') delete ground.grounding;
      if (fault === 'invalid-url') ground.grounding!.supports[1]!.sources[0]!.url = 'javascript:alert(1)';
      if (fault === 'detached-answer') ground.grounding!.answerText = 'Different provider response';
      client.ground = vi.fn(async () => ground);
      if (fault === 'forged-model') client.structure = vi.fn(async (_prompt, schema) => schema.parse({ metrics: { arr: {
        value: 40_000_000, confidence: 'verified', sourceIndex: 0, reportedSupport: { provider: 'google-search', support: { text: report } },
        passageSupport: { sourceUrl: url, quote: report, asOf: '2026-09-30', basis: 'arr', unit: 'USD' },
      } } })) as LlmClient['structure'];
      const result = await hydrate(client);
      expect(result.metrics.find(row => row.metricType === 'arr')).toMatchObject({ value: null, confidence: 'unknown' });
    });
  it('does not publish model summaries or discovery descriptors without eligible provider support', async () => {
    const { client } = fixture(); const ground = await client.ground('fixture'); delete ground.grounding;
    client.ground = vi.fn(async () => ground); const result = await hydrate(client);
    expect(result.company.oneLiner).toBe('No source-backed company snapshot is ready yet.'); expect(result.card.citations).toEqual([]);
  });
  it('preserves reported support through schema parsing and offline projection without promoting verification', async () => {
    const { client } = fixture(); const result = await hydrate(client);
    const row = companyMetricSchema.parse(result.metrics.find(metric => metric.metricType === 'arr'));
    expect(row.reportedSupport).toBeDefined();
    expect(metricDefinitionLabel(row)).toBe('Annual revenue');
    expect(comparableMetricBasis(row)).toBe(false);
    expect(metricObservationIdentity(row)).toContain('annual_revenue');
    expect(projectCompanyFacts(result.company, [row], [])[0]).toMatchObject({ value: 40_000_000, confidence: 'estimated', reportedSupport: row.reportedSupport });
    expect(projectCompanyFacts(result.company, [{ ...row, value: 90_000_000 }], [])[0]!.value).toBeNull();
    const human = { ...row, value: 55_000_000, confidence: 'user_verified' as const, reportedSupport: null };
    expect(projectCompanyFacts(result.company, [row, human], [])[0]).toEqual(human);
  });
  it.each([
    ['- **Acme** reported annual revenue of $40 million. Reporting date was September 30, 2026.', '2026-09-30'],
    ['Annual revenue of $40 million as of September 30, 2026.', '2026-09-30'],
    ['Acme reported annual revenue of $40 million.', null],
  ] as const)('accepts a realistic provider segment without inventing a date: %s', async (text, asOf) => {
    const { client } = fixture(text);
    client.structure = vi.fn(async (_prompt, schema) => schema.parse({ metrics: { arr: { value: 40_000_000,
      confidence: 'estimated', reportedClaim: { sourceUrl: url, quote: text, asOf, basis: 'arr', definition: 'annual_revenue', unit: 'USD' },
    } } })) as LlmClient['structure'];
    const result = await hydrate(client);
    expect(result.metrics.find(row => row.metricType === 'arr')).toMatchObject({ value: 40_000_000,
      confidence: 'estimated', reportedSupport: { asOf } });
    if (!asOf) expect(result.metrics.find(row => row.metricType === 'arr')!.methodNote).toContain('undated');
  });
  it('recognizes a legal suffix alias without accepting an unrelated company', async () => {
    const { client } = fixture('- **Acme** reported annual revenue of $40 million as of September 30, 2026.');
    const result = await hydrateCompanyCard({ candidate: { ...candidate, name: 'Acme, Inc.' }, client, plan });
    expect(result.metrics.find(row => row.metricType === 'arr')!.value).toBe(40_000_000);
  });
  it('binds each number to its measurement, not every metric in the passage', async () => {
    const { client } = fixture(); const result = await hydrate(client);
    const base = result.metrics.find(row => row.metricType === 'arr')!;
    const text = 'Acme has 200 employees and 5 million users as of September 30, 2026.';
    const row = { ...base, metricType: 'employees' as const, value: 5_000_000,
      reportedSupport: { ...base.reportedSupport!, basis: 'employees' as const, definition: 'employees' as const,
        unit: 'count' as const, value: 5_000_000, support: { ...base.reportedSupport!.support, text } } };
    expect(reportedMetricCitations('Acme', 'https://acme.com', row)).toEqual([]);
    expect(reportedMetricCitations('Acme', 'https://acme.com', { ...row, value: 200,
      reportedSupport: { ...row.reportedSupport, value: 200 } })).toHaveLength(1);
  });
  it.each([
    'Acme reported annual revenue of CAD $40 million as of September 30, 2026.',
    'Acme said that Otherco reported annual revenue of $40 million as of September 30, 2026.',
    'Acme reported annual revenue of $40 million in an article published September 30, 2026.',
  ])('does not misattribute currency, company, or publication date: %s', async text => {
    const { client } = fixture(text); const result = await hydrate(client);
    expect(result.metrics.find(row => row.metricType === 'arr')!.value).toBeNull();
  });
  it('keeps a human correction during hydration and does not mutate the prior memory', async () => {
    const { client } = fixture(); const first = await hydrate(client);
    const human = { ...first.metrics[0]!, value: 55_000_000, confidence: 'user_verified' as const, reportedSupport: null };
    first.memory.card.metrics = [human];
    const next = await hydrateCompanyCard({ candidate, client, plan, existingMemory: first.memory });
    expect(next.metrics.find(row => row.metricType === human.metricType)).toEqual(human);
    expect(first.memory.card.metrics).toEqual([human]);
  });
  it('saves supplementary originals before interpretation; only originals earn verified', async () => {
    const { client, originals } = fixture(); const result = await hydrate(client); const events: string[] = [];
    const quote = 'Acme reported ARR of USD 40 million as of 2026-09-30.';
    originals.retrieve = vi.fn(async requestedUrl => ({ requestedUrl, finalUrl: requestedUrl, status: 'retrieved' as const, httpStatus: 200,
      text: quote, contentHash: 'a'.repeat(64), retrievedAt: '2026-10-06T00:00:00.000Z' }));
    originals.save = vi.fn(async () => { events.push('saved'); });
    client.structure = vi.fn(async (_prompt, schema) => { events.push('interpreted'); return schema.parse({ metrics: { arr: {
      value: 40_000_000, confidence: 'verified', passageSupport: { sourceUrl: url, quote, asOf: '2026-09-30', basis: 'arr', unit: 'USD' },
    } } }); }) as LlmClient['structure'];
    const verified = await verifyCompanyCardOriginals(result, client, { originalSources: originals });
    expect(events).toEqual(['saved', 'interpreted']);
    expect(verified.metrics.find(row => row.metricType === 'arr')).toMatchObject({ value: 40_000_000, confidence: 'verified', passageSupport: { quote } });
    expect(result.metrics.find(row => row.metricType === 'arr')!.confidence).toBe('estimated');
    result.metrics[0] = { ...result.metrics[0]!, value: 55_000_000, confidence: 'user_verified' };
    const locked = await verifyCompanyCardOriginals(result, client, { originalSources: originals });
    expect(locked.metrics[0]!.value).toBe(55_000_000); expect(locked.metrics[0]!.confidence).toBe('user_verified');
  });
});

// Shape of the 2026-10-05 Frontier AI run's retained evidence: the answer is
// the company's profile and names it in the header, but every metric support
// is an anonymous catalog section citing third-party sources. Schema-valid
// claims die at the identity gate in reportedMetricCitations, so hydration
// recovers nothing and every stored metric row for evidence-backed companies
// stayed null (235/235 rows on the owner's machine, confirmed by replay).
describe('catalog-style retained evidence without in-passage identity', () => {
  const catalogSegments = {
    arr: 'Revenue & Annual Recurring Revenue (ARR)\n* **Annualized Recurring Revenue (ARR):** Approaching **~$70 Billion ARR** as of September 2026, driven by a surge in enterprise contracts and multi-tier subscriptions (Axios / Reuters / Bloomberg)',
    bookedRevenue: 'Historical Booked Annual Revenue: Booked **$13.07 Billion** in revenue for fiscal year 2025 (leaked financial statements verified by Financial Times / Fortune)',
    headcount: 'Employee Count\n* **Estimated Headcount:** Approximately **4,500 to ~7,850 employees** (as of mid-2026), with active hiring plans targeting **8,000 employees** by year-end 2026 (Financial Times / Revelio Labs)',
  };
  const catalogHeader = '### Company Profile: OpenAI, Inc. / OpenAI Group PBC\n**Market Context:** Frontier Artificial Intelligence (AI) Development';
  function catalogGrounding(segments: string[] = Object.values(catalogSegments)) {
    const answer = `${catalogHeader}\n\n${segments.join('\n')}`;
    const sourceUrl = 'https://www.axios.com/2026/09/openai-arr';
    return extractProviderGrounding(answer, {
      groundingChunks: [{ web: { uri: sourceUrl, title: 'axios.com' } }],
      groundingSupports: segments.map(passage => ({ segment: { text: passage,
        startIndex: answer.indexOf(passage), endIndex: answer.indexOf(passage) + passage.length }, groundingChunkIndices: [0] })),
    });
  }
  const catalogRows = (grounding: NonNullable<ReturnType<typeof extractProviderGrounding>>,
    identity?: { answerText?: string; otherCompanies?: readonly string[] }) =>
    reportedCompanyMetrics({ companyId: 'openai', companyName: 'OpenAI, Inc.', website: 'https://openai.com',
      enrichment: enrichmentOutSchema.parse({ metrics: {} }), text: grounding.answerText, grounding,
      capturedAt: '2026-10-06T00:00:00.000Z', identity });
  // The Frontier AI deck's discovered sibling entities, as the repository
  // would supply them for answer-level identity.
  const deckRoster = ['Anthropic PBC', 'Google', 'Microsoft Corporation', 'Mistral AI SAS', 'Meta AI'];

  it('without an identity roster a schema-valid anonymous claim cannot bind and stays unknown (legacy behavior)', () => {
    const grounding = catalogGrounding([catalogSegments.arr]);
    const support = grounding!.supports[0]!;
    const proof = reportedMetricSupportSchema.safeParse({ provider: 'google-search', companyName: 'OpenAI, Inc.',
      basis: 'arr', value: 70_000_000_000, unit: 'USD', definition: 'arr', asOf: null, support });
    expect(proof.success).toBe(true);
    expect(reportedMetricCitations('OpenAI, Inc.', 'https://openai.com',
      { metricType: 'arr', value: 70_000_000_000, reportedSupport: proof.data! })).toEqual([]);
    expect(catalogRows(grounding!).find(row => row.metricType === 'arr'))
      .toMatchObject({ value: null, confidence: 'unknown', reportedSupport: null });
  });

  it('binds an anonymous catalog metric once the answer names the subject and the deck roster is supplied', () => {
    const grounding = catalogGrounding([catalogSegments.arr]);
    expect(catalogRows(grounding!, { answerText: grounding!.answerText, otherCompanies: deckRoster })
      .find(row => row.metricType === 'arr')).toMatchObject({
      value: 70_000_000_000, confidence: 'estimated', reportedSupport: { definition: 'arr' },
    });
  });

  it('recovers booked annual revenue for the arr slot through answer-level identity', () => {
    const grounding = catalogGrounding([catalogSegments.bookedRevenue]);
    expect(catalogRows(grounding!, { answerText: grounding!.answerText, otherCompanies: deckRoster })
      .find(row => row.metricType === 'arr')).toMatchObject({
      value: 13_070_000_000, confidence: 'estimated', reportedSupport: { definition: 'annual_revenue' },
    });
  });

  it('keeps an anonymous claim unknown when the answer never names the subject', () => {
    const grounding = catalogGrounding([catalogSegments.arr]);
    expect(catalogRows(grounding!, { answerText: '**Market Context:** Frontier Artificial Intelligence (AI) Development\n\n' + catalogSegments.arr,
      otherCompanies: deckRoster }).find(row => row.metricType === 'arr'))
      .toMatchObject({ value: null, confidence: 'unknown', reportedSupport: null });
  });

  it('rejects a catalog sentence naming a rival deck company even with answer-level identity', () => {
    const rivalClaim = 'Anthropic approaches ~$70 Billion ARR as of September 2026, driven by a surge in enterprise contracts and multi-tier subscriptions (Axios / Reuters / Bloomberg)';
    const grounding = catalogGrounding([rivalClaim]);
    expect(catalogRows(grounding!, { answerText: grounding!.answerText, otherCompanies: deckRoster })
      .find(row => row.metricType === 'arr'))
      .toMatchObject({ value: null, confidence: 'unknown', reportedSupport: null });
  });

  it('control: the same figure recovers once the support sentence names the company', () => {
    // Sentence starts with the company name, mirroring the synthetic
    // openAiSegments that already recover through the identity gate.
    const named = 'OpenAI approaches ~$70 Billion ARR as of September 2026, driven by a surge in enterprise contracts and multi-tier subscriptions (Axios / Reuters / Bloomberg)';
    const grounding = catalogGrounding([named]);
    expect(catalogRows(grounding!).find(row => row.metricType === 'arr')).toMatchObject({
      value: 70_000_000_000, confidence: 'estimated', reportedSupport: { definition: 'arr' },
    });
  });

  it('fails closed on an off-roster rival even when the answer names the subject (audit BLOCKER)', () => {
    // Anthropic is never researched, so the roster cannot vouch against it.
    // A sentence opening with that name must not bind to the subject.
    const rivalClaim = 'Anthropic approaches ~$70 Billion ARR as of September 2026, driven by a surge in enterprise contracts and multi-tier subscriptions (Axios / Reuters / Bloomberg)';
    const grounding = catalogGrounding([rivalClaim]);
    expect(catalogRows(grounding!, { answerText: grounding!.answerText, otherCompanies: ['Mistral AI SAS', 'Google'] })
      .find(row => row.metricType === 'arr'))
      .toMatchObject({ value: null, confidence: 'unknown', reportedSupport: null });
  });

  it('rejects a labeled sentence whose rival appears under a colloquial alias of a roster entry', () => {
    // "Meta Platforms, Inc." is written "Meta" in prose; the roster only has
    // the long form, and the alias must still be caught mid-sentence.
    const mixedClaim = 'Revenue & Annual Recurring Revenue (ARR): Approaching ~$70 Billion ARR (Meta reported annual revenue of $164.5 billion for fiscal year 2025)';
    const grounding = catalogGrounding([mixedClaim]);
    expect(catalogRows(grounding!, { answerText: grounding!.answerText, otherCompanies: ['Meta Platforms, Inc.'] })
      .find(row => row.metricType === 'arr'))
      .toMatchObject({ value: null, confidence: 'unknown', reportedSupport: null });
  });

  it('binds the real Anthropic-style labeled ARR section through answer-level identity', () => {
    // Regression guard for label anchoring: the July 2026 retained support
    // opens with its label and recovers with the '+' scale intact.
    const labeled = '* **Annual Revenue & ARR:**\n* **Annualized Run Rate (ARR):** **$65+ billion ARR** as of July/August 2026 (accelerating from $1B in late 2024 and $30B–$47B in Q1–Q2 2026)';
    const grounding = catalogGrounding([labeled]);
    expect(catalogRows(grounding!, { answerText: grounding!.answerText, otherCompanies: deckRoster })
      .find(row => row.metricType === 'arr'))
      .toMatchObject({ value: 65_000_000_000, confidence: 'estimated', reportedSupport: { definition: 'arr' } });
  });

  it('keeps a source-reported zero figure unknown instead of publishing 0', () => {
    const zero = '* **Annual Revenue / ARR:** **$0 (Pre-revenue)** (The company has no commercialized products and explicitly does not generate recurring revenue)';
    const grounding = catalogGrounding([zero]);
    expect(catalogRows(grounding!, { answerText: grounding!.answerText, otherCompanies: deckRoster })
      .find(row => row.metricType === 'arr'))
      .toMatchObject({ value: null, confidence: 'unknown', reportedSupport: null });
  });

  it('does not anchor identity on a subject mention buried deep in the answer', () => {
    const rivalClaim = 'Anthropic approaches ~$70 Billion ARR as of September 2026, driven by a surge in enterprise contracts and multi-tier subscriptions (Axios / Reuters / Bloomberg)';
    const filler = 'General industry commentary. '.repeat(30) + 'A later aside mentions OpenAI in comparison.';
    const grounding = catalogGrounding([rivalClaim]);
    expect(catalogRows(grounding!, { answerText: filler + '\n\n' + grounding!.answerText, otherCompanies: ['Mistral AI SAS', 'Google'] })
      .find(row => row.metricType === 'arr'))
      .toMatchObject({ value: null, confidence: 'unknown', reportedSupport: null });
  });
});

describe('sentence-expanded identity binding (live Equinix fixture)', () => {
  const source = (title: string) => `https://vertexaisearch.cloud.google.com/grounding-api-redirect/equinix-fixture-${title}`;
  // The supports are the API's own sub-sentence fragments captured live: each
  // metric sentence's subject sits OUTSIDE the span, so unexpanded they bind
  // to nothing.
  const equinixGrounding = () => extractProviderGrounding(EQUINIX_ANSWER_TEXT, {
    groundingChunks: EQUINIX_SUPPORTS.map((support, index) => ({ web: { uri: source(String(index)), title: support.sources[0]?.title ?? 'web' } })),
    groundingSupports: EQUINIX_SUPPORTS.map((support, index) => ({
      segment: { text: support.text, startIndex: EQUINIX_ANSWER_TEXT.indexOf(support.text),
        endIndex: EQUINIX_ANSWER_TEXT.indexOf(support.text) + support.text.length },
      groundingChunkIndices: [index],
    })),
  });
  const rows = (grounding: NonNullable<ReturnType<typeof extractProviderGrounding>>, otherCompanies: readonly string[]) =>
    reportedCompanyMetrics({ companyId: 'equinix', companyName: 'Equinix, Inc.', website: 'https://www.equinix.com',
      enrichment: enrichmentOutSchema.parse({ metrics: { arr: {}, employees: {}, market_cap: {} } }),
      text: grounding.answerText, grounding, capturedAt: '2026-10-08T00:00:00.000Z',
      identity: { answerText: grounding.answerText, otherCompanies } });

  it('expands a truncated fragment to its sentence without cutting at "Inc."', () => {
    expect(sentenceAround(EQUINIX_SUPPORTS[0]!.text, EQUINIX_ANSWER_TEXT)).toBe(
      'Equinix, Inc. holds a public market capitalization of $100.98 billion USD on the NASDAQ exchange under ticker symbol EQIX as of October 5, 2026, as reported by Stock Analysis via Nasdaq Data Link.');
    const revenue = sentenceAround(EQUINIX_SUPPORTS[1]!.text, EQUINIX_ANSWER_TEXT);
    expect(revenue.startsWith('For the fiscal year ended December 31, 2025, Equinix, Inc. generated')).toBe(true);
    expect(sentenceAround(EQUINIX_SUPPORTS[2]!.text, EQUINIX_ANSWER_TEXT).startsWith('Equinix, Inc. employed 13,716 employees')).toBe(true);
  });

  it('returns the fragment unchanged when the answer text does not contain it', () => {
    expect(sentenceAround('not present in the answer', EQUINIX_ANSWER_TEXT)).toBe('not present in the answer');
    expect(sentenceAround(EQUINIX_SUPPORTS[0]!.text)).toBe(EQUINIX_SUPPORTS[0]!.text);
  });

  it('recovers the three real Equinix figures the live run dropped', () => {
    const found = rows(equinixGrounding()!, ['Digital Realty Trust, Inc.', 'Colovore, LLC']);
    expect(found.find(row => row.metricType === 'employees')).toMatchObject({
      value: 13_716, confidence: 'estimated', reportedSupport: { definition: 'employees', asOf: '2025-12-31' } });
    expect(found.find(row => row.metricType === 'market_cap')).toMatchObject({
      value: 100.98 * 1e9, confidence: 'estimated', reportedSupport: { definition: 'market_cap', asOf: '2026-10-05' } });
    expect(found.find(row => row.metricType === 'arr')).toMatchObject({
      value: 9.217 * 1e9, confidence: 'estimated', reportedSupport: { definition: 'annual_revenue', asOf: '2025-12-31' } });
  });

  it('fails closed when the expanded sentences name a roster rival instead of the subject', () => {
    const swapped = EQUINIX_ANSWER_TEXT
      .replace('Equinix, Inc. holds', 'Digital Realty Trust, Inc. holds')
      .replace('Equinix, Inc. generated', 'Digital Realty Trust, Inc. generated')
      .replace('Equinix, Inc. employed', 'Digital Realty Trust, Inc. employed');
    expect(swapped).toContain(EQUINIX_SUPPORTS[0]!.text);
    const grounding = extractProviderGrounding(swapped, {
      groundingChunks: EQUINIX_SUPPORTS.map((_support, index) => ({ web: { uri: source(String(index)), title: 'web' } })),
      groundingSupports: EQUINIX_SUPPORTS.map((support, index) => ({
        segment: { text: support.text, startIndex: swapped.indexOf(support.text),
          endIndex: swapped.indexOf(support.text) + support.text.length },
        groundingChunkIndices: [index],
      })),
    });
    const found = rows(grounding!, ['Digital Realty Trust, Inc.', 'Colovore, LLC']);
    expect(found.find(row => row.metricType === 'employees')).toMatchObject({ value: null, confidence: 'unknown' });
    expect(found.find(row => row.metricType === 'market_cap')).toMatchObject({ value: null, confidence: 'unknown' });
    expect(found.find(row => row.metricType === 'arr')).toMatchObject({ value: null, confidence: 'unknown' });
  });

  it('does not bind a lead-in sentence whose measurement basis precedes the subject mention', () => {
    const answer = 'Digital Realty Trust, Inc. reported annual revenues of $2.5 billion USD for fiscal year 2025, while Equinix, Inc. grew faster.';
    const fragment = 'reported annual revenues of $2.5 billion USD for fiscal year 2025';
    const grounding = extractProviderGrounding(answer, {
      groundingChunks: [{ web: { uri: source('rival'), title: 'web' } }],
      groundingSupports: [{ segment: { text: fragment, startIndex: answer.indexOf(fragment),
        endIndex: answer.indexOf(fragment) + fragment.length }, groundingChunkIndices: [0] }],
    });
    const found = reportedCompanyMetrics({ companyId: 'equinix', companyName: 'Equinix, Inc.', website: 'https://www.equinix.com',
      enrichment: enrichmentOutSchema.parse({ metrics: { arr: {} } }), text: answer, grounding,
      capturedAt: '2026-10-08T00:00:00.000Z',
      identity: { answerText: answer, otherCompanies: ['Digital Realty Trust, Inc.'] } });
    expect(found.find(row => row.metricType === 'arr')).toMatchObject({ value: null, confidence: 'unknown' });
  });
});

describe('regional employee breakdowns', () => {
  it('keeps the whole-company count from a comma-list breakdown unambiguous', () => {
    const answer = 'Equinix, Inc. employed 13,716 employees globally, with 5,917 based in the Americas, 4,706 in EMEA, and 3,093 in Asia-Pacific, as disclosed in its Annual Report on Form 10-K.';
    const fragment = 'employed 13,716 employees globally, with 5,917 based in the Americas, 4,706 in EMEA, and 3,093 in Asia-Pacific, as disclosed in its Annual Report on Form 10-K';
    const grounding = extractProviderGrounding(answer, {
      groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/comma-list', title: 'sec.gov' } }],
      groundingSupports: [{ segment: { text: fragment, startIndex: answer.indexOf(fragment),
        endIndex: answer.indexOf(fragment) + fragment.length }, groundingChunkIndices: [0] }],
    });
    const rows = reportedCompanyMetrics({ companyId: 'eq', companyName: 'Equinix, Inc.', website: 'https://www.equinix.com',
      enrichment: enrichmentOutSchema.parse({ metrics: {} }), text: answer, grounding,
      capturedAt: '2026-10-08T00:00:00.000Z',
      identity: { answerText: answer, otherCompanies: ['Digital Realty Trust, Inc.'] } });
    expect(rows.find(row => row.metricType === 'employees')).toMatchObject({
      value: 13_716, confidence: 'estimated', reportedSupport: { definition: 'employees' } });
  });
});
