import { describe, expect, it } from 'vitest';
import { reportedCompanyMetrics } from './reported-metrics';
import { extractProviderGrounding } from './grounding-support';
import { enrichmentOutSchema } from './schemas';

// An official-domain source plus a deck roster is the live shape that let 'AG1' read as 1.
const sourceUrl = 'https://drinkag1.com/about';

function run(companyName: string, segments: string[], metrics: Record<string, unknown> = {}, website: string | null = null) {
  const text = segments.join('\n\n');
  let cursor = 0;
  const grounding = extractProviderGrounding(text, {
    groundingChunks: [{ web: { uri: sourceUrl, title: 'example.com' } }],
    groundingSupports: segments.map((passage) => {
      const start = text.indexOf(passage, cursor);
      cursor = start + passage.length;
      return { segment: { text: passage, startIndex: start, endIndex: start + passage.length }, groundingChunkIndices: [0] };
    }),
  });
  return reportedCompanyMetrics({ companyId: 'cmp_x', companyName, website, text, grounding, identity: { otherCompanies: ['Poppi', 'OLIPOP'] },
    capturedAt: '2026-10-13T00:00:00.000Z', enrichment: enrichmentOutSchema.parse({ metrics }) });
}

const row = (rows: ReturnType<typeof run>, type: string) => rows.find((metric) => metric.metricType === type)!;

describe('reported figure parsing', () => {
  it('never reads a digit inside a company name as a figure (AG1 is not 1 employee)', () => {
    const quote = '- ARR: not disclosed\n- Users: not disclosed\n- Employees: AG1 has over 300 team members as of 2025';
    const segments = ['AG1 is a maker of nutritional supplement drinks.', quote];
    expect(row(run('AG1', segments, {}, 'https://drinkag1.com'), 'employees').value).not.toBe(1);
    // The model's own selector proposing the glued digit is refused too.
    const proposed = run('AG1', segments, { employees: { value: 1, confidence: 'estimated',
      reportedClaim: { sourceUrl, quote, asOf: null, basis: 'employees', definition: 'employees', unit: 'count' } } }, 'https://drinkag1.com');
    expect(row(proposed, 'employees')).toMatchObject({ value: null, confidence: 'unknown' });
  });

  it('does not count countries where staff live as distribution', () => {
    const quote = '- Distribution: AG1 team members are home to over 16 countries as of 2025';
    const rows = run('AG1', ['AG1 is a maker of nutritional supplement drinks.', quote], {
      distribution: { value: 16, confidence: 'estimated', reportedClaim: { sourceUrl, quote, asOf: null, basis: 'distribution', definition: 'distribution', unit: 'count' } },
    }, 'https://drinkag1.com');
    expect(row(rows, 'distribution')).toMatchObject({ value: null, confidence: 'unknown' });
  });

  it('still accepts a sales-footprint distribution claim', () => {
    const rows = run('Kin Euphorics', [
      'Kin Euphorics is a maker of non-alcoholic functional drinks.',
      'Kin Euphorics ships to over 50 countries',
    ]);
    expect(row(rows, 'distribution')).toMatchObject({ value: 50, confidence: 'estimated' });
  });

  it('takes the date written in the claim when the selector omits it', () => {
    const quote = 'Kin Euphorics has a pre-money valuation of USD 59,015,064 as of September 29, 2025';
    const rows = run('Kin Euphorics', ['Kin Euphorics is a maker of non-alcoholic functional drinks.', quote], {
      valuation: { value: 59_015_064, confidence: 'estimated', reportedClaim: { sourceUrl, quote, asOf: null, basis: 'valuation', definition: 'valuation', unit: 'USD' } },
    });
    expect(row(rows, 'valuation')).toMatchObject({ value: 59_015_064, reportedSupport: { asOf: '2025-09-29' } });
  });
});
