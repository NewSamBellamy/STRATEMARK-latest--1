import { describe, expect, it } from 'vitest';
import { ACQUISITION_PRICE_NOTE, acquisitionPriceSentence, isAcquisitionPriceValuation, metricEvidenceTexts } from './acquisition-price';
import { DEAL_TIME_VALUATION_NOTE, enforceOwnershipProvenance, ownershipLabel, ownershipWithholdsValuation } from './ownership';
import { enforceMetricProvenance } from './provenance';
import { companySchema, ownershipSchema } from './schemas';
import type { CompanyMetric, Ownership } from './types';

const valuation = (over: Partial<CompanyMetric>): CompanyMetric => ({
  id: 'met_val', companyId: 'cmp_poppi', metricType: 'valuation', value: 1_950_000_000, confidence: 'estimated',
  source: null, citations: [{ url: 'https://www.cnbc.com/2025/03/17/pepsico-poppi.html', title: 'CNBC' }],
  methodNote: null, capturedAt: '2026-10-01T00:00:00.000Z', ...over,
});

const POPPI_DEAL = 'PepsiCo said Monday it will acquire prebiotic soda brand Poppi for $1.95 billion.';

describe('acquisition price is never a valuation', () => {
  it('finds the deal-price sentence for the stored figure', () => {
    expect(acquisitionPriceSentence(POPPI_DEAL, 1_950_000_000)).toBe(POPPI_DEAL);
    expect(acquisitionPriceSentence('The deal valued Poppi at $1.95 billion, including tax benefits.', 1_950_000_000)).not.toBeNull();
    // A different figure in the same sentence is not this metric's evidence.
    expect(acquisitionPriceSentence(POPPI_DEAL, 500_000_000)).toBeNull();
    // Any figure when the stored value was converted.
    expect(acquisitionPriceSentence(POPPI_DEAL, null)).toBe(POPPI_DEAL);
  });

  it('leaves funding-round valuations alone', () => {
    expect(acquisitionPriceSentence('Anysphere raised $900 million at a $9.9 billion valuation led by Thrive.', 9_900_000_000)).toBeNull();
    expect(acquisitionPriceSentence('Anysphere was valued at $29.3 billion in its Series D round.', 29_300_000_000)).toBeNull();
    expect(acquisitionPriceSentence(null, 1)).toBeNull();
  });

  it('a mixed sentence goes to whichever wording sits nearer the figure', () => {
    // Round valuation nearer the figure: still a valuation.
    expect(acquisitionPriceSentence('After it acquired Supermaven, Anysphere raised funding at a $9.9 billion valuation.', 9_900_000_000)).toBeNull();
    // Acquisition nearer: a price.
    expect(acquisitionPriceSentence('The company, last valued in a funding round, agreed to be acquired for $60 billion.', 60_000_000_000)).not.toBeNull();
  });

  it('enforceMetricProvenance rejects the acquisition price as a valuation (write and read)', () => {
    const row = valuation({ quotedSupport: { sourceUrl: 'https://www.cnbc.com/x', quote: POPPI_DEAL, asOf: '2025-03-17', value: 1.95e9, unit: 'USD' } });
    expect(isAcquisitionPriceValuation(row)).toBe(true);
    const out = enforceMetricProvenance(row);
    expect(out.confidence).toBe('unknown');
    expect(out.value).toBeNull();
    expect(out.methodNote).toBe(ACQUISITION_PRICE_NOTE);
    // The evidence is kept so the ownership lane can route the price.
    expect(metricEvidenceTexts(out)).toContain(POPPI_DEAL);
  });

  it('checks grounded and passage evidence as well, and only valuation rows', () => {
    const grounded = valuation({ reportedSupport: {
      value: 1.95e9, asOf: '2025-03-17',
      support: { text: POPPI_DEAL, sources: [{ url: 'https://www.cnbc.com/x', title: 'cnbc.com' }] },
    } as CompanyMetric['reportedSupport'] });
    expect(isAcquisitionPriceValuation(grounded)).toBe(true);
    expect(isAcquisitionPriceValuation({ ...grounded, metricType: 'funding_total' })).toBe(false);
    expect(isAcquisitionPriceValuation({ ...grounded, value: null })).toBe(false);
  });

  it('never overrides a human-verified figure', () => {
    const row = valuation({ confidence: 'user_verified', methodNote: POPPI_DEAL });
    expect(enforceMetricProvenance(row)).toMatchObject({ confidence: 'user_verified', value: 1.95e9 });
  });

  it('keeps an ordinary valuation', () => {
    const row = valuation({ methodNote: 'Anysphere raised $2.3 billion at a $29.3 billion post-money valuation.', value: 29.3e9 });
    expect(enforceMetricProvenance(row).value).toBe(29.3e9);
  });
});

const cite = { url: 'https://www.pepsico.com/newsroom/press-releases/2025/pepsico-completes-acquisition-of-poppi', title: 'PepsiCo' };
const acquired: Ownership = {
  status: 'acquired', acquirer: 'PepsiCo', announcedOn: '2025-03-17', closedOn: '2025-05-27',
  price: { value: 1.95e9, currency: 'USD' }, citations: [cite], confidence: 'verified',
};

describe('ownership provenance and label', () => {
  it('parses existing companies without ownership, and the new field', () => {
    const company = { id: 'c', name: 'Poppi', slug: 'poppi', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    const plain = companySchema.safeParse(company);
    if (plain.success) expect(plain.data.ownership).toBeUndefined();
    expect(ownershipSchema.parse(acquired).status).toBe('acquired');
    expect(ownershipSchema.safeParse({ ...acquired, closedOn: 'May 2025' }).success).toBe(false);
  });

  it('labels each status', () => {
    expect(ownershipLabel(acquired)).toBe('Acquired by PepsiCo · 2025');
    expect(ownershipLabel({ ...acquired, closedOn: null, announcedOn: '2024-12' })).toBe('Acquired by PepsiCo · 2024');
    expect(ownershipLabel({ ...acquired, closedOn: null, announcedOn: null })).toBe('Acquired by PepsiCo');
    expect(ownershipLabel({ ...acquired, status: 'acquisition_pending', acquirer: 'SpaceX' })).toBe('Acquisition by SpaceX pending');
    expect(ownershipLabel({ ...acquired, status: 'subsidiary', acquirer: 'Alphabet' })).toBe('Subsidiary of Alphabet');
    expect(ownershipLabel({ ...acquired, status: 'independent', acquirer: undefined })).toBeNull();
    expect(ownershipLabel(null)).toBeNull();
  });

  it('shows nothing a source does not state', () => {
    expect(enforceOwnershipProvenance({ ...acquired, citations: [] })).toBeNull();
    expect(enforceOwnershipProvenance({ ...acquired, confidence: 'unknown' })).toBeNull();
    expect(enforceOwnershipProvenance({ ...acquired, acquirer: '  ' })).toBeNull();
    // A pending deal cannot carry a closing date; a parent carries no price.
    expect(enforceOwnershipProvenance({ ...acquired, status: 'acquisition_pending' })?.closedOn).toBeNull();
    expect(enforceOwnershipProvenance({ ...acquired, status: 'subsidiary' })?.price).toBeNull();
  });

  it('automation cannot assert user_verified; a human record stands', () => {
    const human = { ...acquired, confidence: 'user_verified' as const, citations: [] };
    expect(enforceOwnershipProvenance(human)?.confidence).toBe('user_verified');
    const machine = enforceOwnershipProvenance({ ...acquired, confidence: 'user_verified' }, true);
    expect(machine?.confidence).toBe('verified');
    expect(machine?.methodNote).toMatch(/only a person/);
  });
});

describe('an acquired company shows no deal-time valuation', () => {
  // The stored live Poppi row: a provider-reported figure dated the announcement day.
  const POPPI_REPORTED = 'Poppi was valued at USD 1.95 billion as of March 17, 2025';
  const reportedRow = (value: number, asOf: string, over: Partial<CompanyMetric> = {}) => valuation({
    value,
    reportedSupport: {
      provider: 'google-search', companyName: 'Poppi', basis: 'valuation', value, unit: 'USD', asOf, definition: 'valuation' as never,
      support: { supportIndex: 0, text: POPPI_REPORTED, sources: [{ chunkIndex: 0, url: 'https://example.org/poppi', title: 'example.org' }] },
    } as CompanyMetric['reportedSupport'],
    ...over,
  });

  it('(a) a value matching the acquisition price within 0.5% is withheld', () => {
    const noDate = { ...acquired, announcedOn: null, closedOn: null };
    expect(ownershipWithholdsValuation(valuation({ value: 1.955e9 }), noDate)).toBe(true);
    expect(ownershipWithholdsValuation(reportedRow(2.2e9, '2024-06-01'), noDate)).toBe(false);
  });

  it('(c) the live Poppi row: undated, price unknown, still withheld', () => {
    // Stored state seen live: price null, figure reported with no reporting date.
    const live: Ownership = { ...acquired, price: null, announcedOn: '2025-05-19', closedOn: '2025-05' };
    const undated = valuation({ value: 1.95e9, methodNote: 'Source reported valuation (undated; reporting date not published).' });
    expect(ownershipWithholdsValuation(undated, live)).toBe(true);
    expect(enforceMetricProvenance(undated, null, live)).toMatchObject({ value: null, confidence: 'unknown', methodNote: DEAL_TIME_VALUATION_NOTE });
    // A support present but with no asOf is still undated.
    const supportNoDate = valuation({ value: 2e9, quotedSupport: { sourceUrl: 'https://example.org/p', quote: 'Poppi is valued at $2 billion.', value: 2e9, unit: 'USD' } as CompanyMetric['quotedSupport'] });
    expect(ownershipWithholdsValuation(supportNoDate, live)).toBe(true);
    // Unparseable dates count as no date.
    expect(ownershipWithholdsValuation(reportedRow(2e9, 'unknown'), live)).toBe(true);
  });

  it('(c) an undated figure stays for pending, uncited, human-verified, or independent', () => {
    const undated = valuation({ value: 1.95e9 });
    expect(ownershipWithholdsValuation(undated, { ...acquired, price: null, status: 'acquisition_pending' })).toBe(false);
    expect(ownershipWithholdsValuation(undated, { ...acquired, price: null, citations: [] })).toBe(false);
    expect(ownershipWithholdsValuation(undated, { ...acquired, price: null, confidence: 'user_verified', citations: [] })).toBe(false);
    expect(ownershipWithholdsValuation({ ...undated, confidence: 'user_verified' }, { ...acquired, price: null })).toBe(false);
    expect(ownershipWithholdsValuation(undated, { ...acquired, price: null, status: 'independent', acquirer: undefined })).toBe(false);
    expect(ownershipWithholdsValuation(undated, null)).toBe(false);
  });

  it('(b) the live Poppi row, dated on the announcement, is withheld', () => {
    const row = reportedRow(2e9, '2025-03-17');
    expect(ownershipWithholdsValuation(row, { ...acquired, price: null })).toBe(true);
    const gated = enforceMetricProvenance(row, null, acquired);
    expect(gated).toMatchObject({ value: null, confidence: 'unknown', methodNote: DEAL_TIME_VALUATION_NOTE });
  });

  it('(b) uses closedOn when announcedOn is null, with a 90-day window', () => {
    const closedOnly = { ...acquired, price: null, announcedOn: null, closedOn: '2025-05' };
    expect(ownershipWithholdsValuation(reportedRow(1e9, '2025-02-15'), closedOnly)).toBe(true);
    expect(ownershipWithholdsValuation(reportedRow(1e9, '2025-01-15'), closedOnly)).toBe(false);
  });

  it('an earlier funding-round valuation stands', () => {
    const row = reportedRow(5e8, '2024-06-01');
    expect(ownershipWithholdsValuation(row, acquired)).toBe(false);
    expect(enforceMetricProvenance(row, null, acquired).value).toBe(5e8);
  });

  it('never for a pending deal: Anysphere\'s pre-deal round stands', () => {
    const pending: Ownership = { ...acquired, status: 'acquisition_pending', acquirer: 'SpaceX', announcedOn: '2026-06-10', closedOn: null,
      price: { value: 6e10, currency: 'USD' } };
    const round = reportedRow(2.93e10, '2026-05-01', { companyId: 'cmp_anysphere' });
    expect(ownershipWithholdsValuation(round, pending)).toBe(false);
    expect(enforceMetricProvenance(round, null, pending).value).toBe(2.93e10);
  });

  it('(b) needs a cited ownership record; a human-verified figure is untouched', () => {
    const uncitedHuman: Ownership = { ...acquired, price: null, confidence: 'user_verified', citations: [] };
    expect(ownershipWithholdsValuation(reportedRow(2e9, '2025-03-17'), uncitedHuman)).toBe(false);
    // An uncited machine record is dropped entirely.
    expect(ownershipWithholdsValuation(reportedRow(2e9, '2025-03-17'), { ...acquired, citations: [] })).toBe(false);
    const human = reportedRow(1.95e9, '2025-03-17', { confidence: 'user_verified' });
    expect(ownershipWithholdsValuation(human, acquired)).toBe(false);
    expect(enforceMetricProvenance(human, null, acquired)).toMatchObject({ value: 1.95e9, confidence: 'user_verified' });
  });

  it('without ownership nothing changes', () => {
    const row = reportedRow(5e8, '2025-03-17');
    expect(enforceMetricProvenance(row, null, null).value).toBe(5e8);
    expect(enforceMetricProvenance(row).value).toBe(5e8);
  });
});
