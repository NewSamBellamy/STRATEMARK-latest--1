import { describe, expect, it, vi } from 'vitest';
import type { CompanyMetric } from '@mi/contracts';
import { renderCompanyOverview, overviewFigures } from './company-overview';
import type { LlmClient } from './types';
import type { OriginalSourceAttempt } from './original-source';
import { companyOriginalReceipts } from './company-facts';

const company = { id: 'cmp', name: 'Acme', websiteUrl: 'https://acme.com', oneLiner: 'Legacy $999B story', logoUrl: null, hqLocation: null, brandTheme: null };
const quote = 'Acme builds research software for independent analysts.';
const metricQuote = 'Acme reports USD 10 million ARR as of October 1, 2026.';
const sourceUrl = 'https://sec.gov/Archives/acme-report';
const attempt: OriginalSourceAttempt = { id: 'src', companyId: 'cmp', metricType: 'company_profile', capturedAt: '2026-10-02T00:00:00.000Z',
  receipts: [{ requestedUrl: sourceUrl, finalUrl: sourceUrl, status: 'retrieved', httpStatus: 200, contentHash: 'a'.repeat(64), retrievedAt: '2026-10-02T00:00:00.000Z', text: `${quote} ${metricQuote}` }] };
const metric: CompanyMetric = { id: 'met', companyId: 'cmp', metricType: 'arr', value: 10_000_000, confidence: 'verified', source: sourceUrl,
  citations: [{ title: 'Company report', url: sourceUrl }], methodNote: null, capturedAt: attempt.capturedAt,
  passageSupport: { sourceUrl, quote: metricQuote, asOf: '2026-10-01', basis: 'arr', unit: 'USD' } };
const client = { ground: vi.fn(), structure: vi.fn() } as unknown as LlmClient;
const args = (metrics: CompanyMetric[] = [metric]) => ({ company, marketName: 'Research', storedMetrics: metrics, client });
const originals = (attempts: OriginalSourceAttempt[] = [attempt]) => companyOriginalReceipts(company.id, attempts);

describe('legacy original-excerpt overview projection', () => {
  it('revalidates saved excerpts and shared figures without provider work', () => {
    const result = renderCompanyOverview(args(), originals(), [{ sourceUrl, quote }]);
    expect(result.content.markdown).toContain(quote);
    expect(result.content.markdown).toContain('10,000,000');
    expect(result.content.markdown).toContain('2026-10-01');
    expect(result.content.markdown).not.toContain('999B');
    expect(result.citations).toEqual([expect.objectContaining({ url: sourceUrl })]);
    expect(client.ground).not.toHaveBeenCalled();
    expect(client.structure).not.toHaveBeenCalled();
  });
  it.each(['other-company', 'wrong-value', 'wrong-basis', 'missing-proof', 'estimate', 'ambiguous', 'missing-original'])(
    'does not repeat a %s figure as a company fact', fault => {
      const rows: CompanyMetric[] = [{ ...metric,
        ...(fault === 'other-company' ? { companyId: 'other' } : {}),
        ...(fault === 'wrong-value' ? { value: 20_000_000 } : {}),
        ...(fault === 'wrong-basis' ? { passageSupport: { ...metric.passageSupport!, basis: 'valuation' as const } } : {}),
        ...(fault === 'missing-proof' ? { passageSupport: undefined } : {}),
        ...(fault === 'estimate' ? { confidence: 'estimated' as const } : {}) }];
      if (fault === 'ambiguous') rows.push({ ...rows[0]!, id: 'tie', value: 20_000_000 });
      const result = overviewFigures(args(rows), originals(fault === 'missing-original' ? [{ ...attempt, companyId: 'other' }] : [attempt]));
      expect(result).not.toContain('10,000,000');
      expect(result).not.toContain('20,000,000');
      expect(result).toContain('Unknown');
    });
  it('rejects invented, numeric and wrong-source legacy quotations', () => {
    const result = renderCompanyOverview(args([]), originals(), [
      { sourceUrl, quote: 'Made up company story' }, { sourceUrl, quote: metricQuote },
      { sourceUrl: 'https://invented.example', quote },
    ]);
    expect(result.content.markdown).not.toContain('Made up');
    expect(result.content.markdown).not.toContain('10 million');
    expect(result.content.markdown).not.toContain('invented.example');
    expect(result.content.markdown).toContain('Background unavailable');
  });
  it('retains sanitized source-read diagnostics without transport details', () => {
    const receipts = [...originals(), { requestedUrl: 'https://acme.com/?private=secret', status: 'blocked' as const,
      httpStatus: 403, retrievedAt: attempt.capturedAt, reason: 'private adapter detail' }];
    const result = renderCompanyOverview(args([]), receipts, []);
    expect(result.sourceDiagnostics).toMatchObject({ reads: expect.arrayContaining([
      expect.objectContaining({ host: 'acme.com', outcome: 'blocked', httpStatus: 403 }),
    ]), eligibleSourceCount: 1, acceptedExcerptCount: 0 });
    expect(JSON.stringify(result.sourceDiagnostics)).not.toContain('private');
    expect(result.citations).toEqual([]);
  });
  it('rejects a regulator quote about a different company and ignores invented human confirmation', () => {
    const text = 'Beta builds research software for independent analysts.';
    const result = renderCompanyOverview(args([]), [{ ...attempt.receipts[0]!, text }], [{ sourceUrl, quote: text }]);
    expect(result.content.markdown).not.toContain(text);
    expect(result.content.markdown).not.toContain('human-confirmed');
  });
  it('preserves explicit human-confirmed values with an honest label', () => {
    const result = overviewFigures(args([{ ...metric, confidence: 'user_verified', passageSupport: undefined }]), []);
    expect(result).toContain('10,000,000 — human-confirmed, not independently verified');
  });
});
