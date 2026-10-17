import { describe, expect, it } from 'vitest';
import type { ReportedMetricSupport } from '@mi/contracts';
import { reportedRowNote } from './reported-metrics';

const proof = (definition: string, value = 1_200_000_000): ReportedMetricSupport => ({
  provider: 'google-search', companyName: 'Tennant Company', basis: 'revenue', value, unit: 'usd', asOf: '2026-08-31', definition,
  support: { supportIndex: 0, text: 'Tennant Company reported annual revenue of $1.2 billion.', sources: [{ chunkIndex: 0, url: 'https://investors.tennantco.com/', title: 'Investors' }] },
} as unknown as ReportedMetricSupport);

describe('reportedRowNote wording', () => {
  it('names the figure in words a reader would use, never as a code identifier', () => {
    const note = reportedRowNote('market_cap', proof('market_cap'));
    expect(note).toMatch(/^Source reported market cap \(/);
    expect(note).not.toMatch(/[a-z]_[a-z]/);
    expect(reportedRowNote('revenue', proof('annual_revenue'))).toMatch(/^Source reported annual revenue \(/);
  });
  it('still says the figure is provider-grounded and not verified against an original', () => {
    expect(reportedRowNote('employees', proof('employees', 4500))).toContain('provider-grounded, not verified against an original');
  });
});
