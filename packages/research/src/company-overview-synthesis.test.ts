import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompanyMetric } from '@mi/contracts';
import { researchDashboardWithSources } from './dashboard';
import type { LlmClient, ProviderGrounding } from './types';
import type { OriginalSourceAttempt } from './original-source';
import { savedOverviewNarrative, renderSourceReportedOverview } from './company-overview';

const company = { id: 'ms', name: 'Microsoft', websiteUrl: 'https://www.microsoft.com',
  oneLiner: 'Legacy ungrounded valuation $999B', logoUrl: null, hqLocation: null, brandTheme: null };
const urls = ['https://www.microsoft.com/en-us/microsoft-365', 'https://azure.microsoft.com/en-us/'];
const notes = [
  'Microsoft develops productivity software and cloud infrastructure for businesses and consumers.',
  'Microsoft 365 combines productivity applications and collaboration services; Azure supplies cloud computing services.',
  'Microsoft serves enterprise IT teams, developers and individual consumers through subscriptions, partners and direct sales.',
];
const text = notes.join('\n');
const grounding: ProviderGrounding = { provider: 'google-search', answerText: text,
  supports: notes.map((text, supportIndex) => ({ supportIndex, text,
    sources: [{ chunkIndex: supportIndex === 1 ? 1 : 0, url: urls[supportIndex === 1 ? 1 : 0]!, title: 'Microsoft product information' }] })) };
const paragraphs = [
  { section: 'background', text: 'Microsoft supplies software and cloud infrastructure to organizations and individual buyers.', supportIndices: [0], sourceUrls: [urls[0]] },
  { section: 'products', text: 'Its Microsoft 365 suite supports productivity and collaboration, while Azure provides cloud services.', supportIndices: [1], sourceUrls: [urls[1]] },
  { section: 'customers', text: 'Enterprise IT teams, developers and consumers use its offerings through subscriptions, partner channels and direct sales.', supportIndices: [2], sourceUrls: [urls[0]] },
];
function setup() {
  const ground = vi.fn().mockResolvedValue({ text, queries: [], citations: urls.map(url => ({ url, title: 'Microsoft' })), grounding });
  const structure = vi.fn().mockResolvedValue({ paragraphs });
  const originalSources = { list: vi.fn(() => new Promise<OriginalSourceAttempt[]>(() => undefined)),
    retrieve: vi.fn(() => new Promise(() => undefined)), save: vi.fn() };
  const client = { ground, structure } as unknown as LlmClient;
  const run = (extra: Record<string, unknown> = {}) => researchDashboardWithSources('overview', {
    company, marketName: 'Enterprise software', storedMetrics: [], client,
    ...extra,
  });
  return { ground, structure, originalSources, run, client };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('written source-reported overview', () => {
  it('writes products, positioning and customer context from Google support without waiting for original retrieval', async () => {
    const s = setup();
    let result: Awaited<ReturnType<typeof s.run>> | undefined;
    void s.run({ originalSources: s.originalSources }).then(value => { result = value; });
    // Flush provider promises without waiting for the deliberately hung originals.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(result).toBeDefined();
    expect(result!.content.markdown).toContain(paragraphs[0]!.text);
    expect(result!.content.markdown).toContain('Microsoft 365');
    expect(result!.content.markdown).toContain('Enterprise IT teams');
    expect(result!.content.markdown).toContain('not independently verified');
    expect(result!.content.markdown).not.toContain('999B');
    expect(result!.citations.map(c => c.url)).toEqual(expect.arrayContaining(urls));
    expect(s.ground).toHaveBeenCalledTimes(1);
    expect(s.structure).toHaveBeenCalledTimes(1);
    expect(s.structure.mock.calls[0]![0]).toContain('supportIndices');
    expect(s.structure.mock.calls[0]![0]).toContain(text);
    expect(s.originalSources.list).not.toHaveBeenCalled();
    expect(s.originalSources.retrieve).not.toHaveBeenCalled();
  });

  it('rejects invented source links/support IDs and model-produced financial totals, but keeps model names', async () => {
    const s = setup();
    s.structure.mockResolvedValue({ paragraphs: [...paragraphs,
      { section: 'background', text: 'Fabricated unrelated claim', sourceUrls: ['https://invented.example'], supportIndices: [0] },
      { section: 'products', text: 'Unbound fabricated product', sourceUrls: [urls[0]], supportIndices: [99] },
      { section: 'customers', text: 'Revenue was $999 billion.', sourceUrls: [urls[0]], supportIndices: [0] },
    ] });
    const result = await s.run();
    expect(result.content.markdown).toContain('Microsoft 365');
    expect(result.content.markdown).not.toContain('Fabricated');
    expect(result.content.markdown).not.toContain('Unbound');
    expect(result.content.markdown).not.toContain('999');
    expect(result.content.markdown).toContain('Unknown');
    expect(result.citations.some(c => c.url.includes('invented'))).toBe(false);
  });

  it.each(['missing-citations', 'empty-notes', 'provider-unavailable'])('keeps background unknown when %s', async mode => {
    const s = setup();
    if (mode === 'missing-citations') s.ground.mockResolvedValue({ text, queries: [], citations: [] });
    if (mode === 'empty-notes') s.ground.mockResolvedValue({ text: '', queries: [], citations: urls.map(url => ({ url, title: 'Microsoft' })) });
    if (mode === 'provider-unavailable') s.ground.mockRejectedValue(new Error('private provider details'));
    const result = await s.run();
    expect(result.content.markdown).toContain('Background unavailable');
    expect(result.content.markdown).not.toContain('Legacy');
    expect(result.content.markdown).not.toContain('private provider');
    expect(result.citations).toEqual([]);
    expect(s.structure).not.toHaveBeenCalled();
  });

  it('allows citation-attributed search notes when a provider has no segment metadata, without calling them verified', async () => {
    const s = setup();
    s.ground.mockResolvedValue({ text, queries: [], citations: urls.map(url => ({ url, title: 'Microsoft' })) });
    const result = await s.run();
    expect(result.content.markdown).toContain('Microsoft 365');
    expect(result.content.markdown).toContain('not independently verified');
    expect(result.content.markdown).toContain('search citation');
  });

  it.each(['throws', 'omits selectors'] as const)('falls back to literal company-scoped Google support when synthesis %s', async failure => {
    const s = setup();
    const openai = { ...company, id: 'openai', name: 'OpenAI, Inc.', websiteUrl: 'https://openai.com' };
    const url = 'https://openai.com/about';
    const supportText = '**Company Description**\nOpenAI is an artificial intelligence research and deployment company focused on developing safe and beneficial artificial general intelligence (AGI).';
    s.ground.mockResolvedValue({ text: supportText, queries: [], citations: [{ title: 'OpenAI', url }], grounding: {
      provider: 'google-search', answerText: supportText, supports: [{ supportIndex: 0, text: supportText,
        sources: [{ chunkIndex: 0, title: 'OpenAI', url }] }],
    } });
    if (failure === 'throws') s.structure.mockRejectedValue(new Error('invalid synthesis JSON'));
    else s.structure.mockResolvedValue({});

    const result = await s.run({ company: openai });

    expect(result.content.markdown).toContain('OpenAI is an artificial intelligence research and deployment company');
    expect(result.content.markdown).not.toContain('**Company Description**');
    expect(result.content.markdown).toContain('source-reported');
    expect(result.content.markdown).toContain('not independently verified');
    expect(result.citations.map(row => row.url)).toContain(url);
    expect(result.overviewNarrative).toMatchObject({ basis: 'google-search', paragraphs: [expect.objectContaining({
      section: 'background', text: expect.stringContaining('OpenAI is an artificial intelligence research'), sourceUrls: [url], supportIndices: [0],
    })], grounding: { supports: [expect.objectContaining({ text: supportText })] } });
    expect(s.structure).toHaveBeenCalledTimes(1);
  });

  it('reconstructs an empty v3 overview from an exactly scoped retained Google evidence record without provider calls', () => {
    const openai = { ...company, id: 'openai', name: 'OpenAI, Inc.', websiteUrl: 'https://openai.com' };
    const sourceUrl = 'https://openai.com/about';
    const supportText = '**Company Description**\nOpenAI is an artificial intelligence research and deployment company focused on developing safe and beneficial artificial general intelligence (AGI).';
    const evidence = { id: 'ev_openai', companyId: openai.id, companyName: openai.name, topic: 'overview',
      capturedAt: '2026-10-06T00:00:00.000Z', text: supportText, queries: [], citations: [{ title: 'OpenAI', url: sourceUrl }],
      grounding: { provider: 'google-search' as const, answerText: supportText, supports: [{ supportIndex: 0, text: supportText,
        sources: [{ chunkIndex: 0, title: 'OpenAI', url: sourceUrl }] }] } };
    const s = setup();
    const args = { company: openai, marketName: 'Frontier AI', storedMetrics: [], client: s.client };

    const narrative = savedOverviewNarrative(args, evidence);
    const recovered = narrative && renderSourceReportedOverview(args, [], narrative);

    expect(recovered?.content.markdown).toContain('OpenAI is an artificial intelligence research and deployment company');
    expect(recovered?.content.markdown).not.toContain('**Company Description**');
    expect(recovered?.content.markdown).toContain('source-reported');
    expect(recovered?.content.markdown).toContain('not independently verified');
    expect(recovered?.citations.map(row => row.url)).toContain(sourceUrl);
    expect(s.ground).not.toHaveBeenCalled();
    expect(s.structure).not.toHaveBeenCalled();
  });

  it.each([
    ['company id', { companyId: 'other' }],
    ['company name', { companyName: 'OpenAI Research' }],
    ['topic', { topic: 'team_org' }],
  ])('does not recover retained evidence with a mismatched %s', (_label, mismatch) => {
    const openai = { ...company, id: 'openai', name: 'OpenAI, Inc.', websiteUrl: 'https://openai.com' };
    const sourceUrl = 'https://openai.com/about';
    const supportText = 'OpenAI develops artificial intelligence models and related software products.';
    const evidence = { id: 'ev_openai', companyId: openai.id, companyName: openai.name, topic: 'overview',
      capturedAt: '2026-10-06T00:00:00.000Z', text: supportText, queries: [], citations: [{ title: 'OpenAI', url: sourceUrl }],
      grounding: { provider: 'google-search' as const, answerText: supportText, supports: [{ supportIndex: 0, text: supportText,
        sources: [{ chunkIndex: 0, title: 'OpenAI', url: sourceUrl }] }] }, ...mismatch };
    const s = setup();

    const args = { company: openai, marketName: 'Frontier AI', storedMetrics: [], client: s.client };
    expect(savedOverviewNarrative(args, evidence)).toBeUndefined();
    expect(savedOverviewNarrative(args, undefined)).toBeUndefined();
  });

  it('does not treat a company-looking source title as company evidence or accept unlisted source URLs', async () => {
    const s = setup();
    const counterparty = 'Acme provides software to research teams.';
    const url = 'https://acme.example/about';
    s.ground.mockResolvedValue({ text: counterparty, queries: [], citations: [{ title: 'Microsoft official company profile', url }], grounding: {
      provider: 'google-search', answerText: counterparty, supports: [{ supportIndex: 0, text: counterparty,
        sources: [{ chunkIndex: 0, title: 'Microsoft official company profile', url }] }],
    } });
    s.structure.mockRejectedValue(new Error('synthesis unavailable'));

    const result = await s.run();

    expect(result.content.markdown).toContain('Background unavailable');
    expect(result.content.markdown).not.toContain(counterparty);
    expect(result.citations).toEqual([]);
  });

  it('does not surface numeric population claims through the literal fallback', async () => {
    const s = setup();
    const claim = 'Microsoft serves 1,000,000 customers through its cloud services.';
    s.ground.mockResolvedValue({ text: claim, queries: [], citations: [{ title: 'Microsoft', url: urls[0]! }], grounding: {
      provider: 'google-search', answerText: claim, supports: [{ supportIndex: 0, text: claim,
        sources: [{ chunkIndex: 0, title: 'Microsoft', url: urls[0]! }] }],
    } });
    s.structure.mockRejectedValue(new Error('synthesis unavailable'));

    const result = await s.run();

    expect(result.content.markdown).toContain('Background unavailable');
    expect(result.content.markdown).not.toContain('1,000,000');
  });

  it('keeps numeric financial values in the shared company-facts lane with original support', async () => {
    const s = setup();
    const sourceUrl = 'https://www.microsoft.com/investor/report';
    const quote = 'Microsoft reports USD 10 million ARR as of October 1, 2026.';
    const capturedAt = '2026-10-02T00:00:00.000Z';
    const attempts: OriginalSourceAttempt[] = [{ id: 'src', companyId: 'ms', metricType: 'company_profile', capturedAt,
      receipts: [{ requestedUrl: sourceUrl, finalUrl: sourceUrl, status: 'retrieved', httpStatus: 200,
        contentHash: 'a'.repeat(64), retrievedAt: capturedAt, text: quote }] }];
    const metric: CompanyMetric = { id: 'arr', companyId: 'ms', metricType: 'arr', value: 10_000_000,
      confidence: 'verified', source: sourceUrl, citations: [{ title: 'Report', url: sourceUrl }], methodNote: null, capturedAt,
      passageSupport: { sourceUrl, quote, asOf: '2026-10-01', basis: 'arr', unit: 'USD' } };
    const result = await s.run({ originalAttempts: attempts, storedMetrics: [metric] });
    expect(result.content.markdown).toContain('10,000,000');
    expect(result.content.markdown).toContain('2026-10-01');
    expect(result.content.markdown).toContain('Microsoft 365');
  });

  it('uses an explicitly attributed saved card summary without a paid call, never an unsourced oneLiner', async () => {
    const s = setup();
    const result = await s.run({ overviewSeed: { companyId: 'ms', text: notes[0], citations: [{ title: 'Microsoft', url: urls[0] }],
      attribution: 'source-reported' } });
    expect(result.content.markdown).toContain(notes[0]!);
    expect(result.content.markdown).toContain('Saved card summary');
    expect(result.content.markdown).toContain('not independently verified');
    expect(s.ground).not.toHaveBeenCalled(); expect(s.structure).not.toHaveBeenCalled();
  });

  it.each(['2026-09-30', null])('shows checked source-reported annual revenue with reporting date %s, never as verified ARR', async asOf => {
    const s = setup();
    const url = 'https://www.microsoft.com/investor/results';
    const note = 'Annual revenue was $40 million for the fiscal year ended September 30, 2026.';
    const metric: CompanyMetric = { id: 'reported', companyId: 'ms', metricType: 'arr', value: 40_000_000,
      confidence: 'estimated', source: url, citations: [{ title: 'Results', url }], capturedAt: '2026-10-02T00:00:00.000Z', methodNote: null,
      reportedSupport: { provider: 'google-search', companyName: 'Microsoft', basis: 'arr', definition: 'annual_revenue', unit: 'USD',
        value: 40_000_000, asOf, support: { supportIndex: 0, text: note, sources: [{ chunkIndex: 0, title: 'Results', url }] } } };
    const result = await s.run({ storedMetrics: [metric] });
    expect(result.content.markdown).toContain('Annual revenue (USD): 40,000,000');
    expect(result.content.markdown).toContain('not verified');
    expect(result.content.markdown).not.toContain('reported null');
    expect(result.citations.map(row => row.url)).toContain(url);
    metric.reportedSupport!.value = 90_000_000;
    expect((await s.run({ storedMetrics: [metric] })).content.markdown).not.toContain('40,000,000');
  });

  it('propagates cancellation instead of publishing an unavailable response', async () => {
    const s = setup(); const controller = new AbortController();
    s.ground.mockImplementation(async () => { controller.abort(); throw new Error('cancelled'); });
    await expect(s.run({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.structure).not.toHaveBeenCalled();
  });
});
