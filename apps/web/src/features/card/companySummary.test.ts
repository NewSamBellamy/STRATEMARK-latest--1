import { describe, expect, it } from 'vitest';
import type { CardView } from './card-view';
import { buildCompanySummary, leadSentences } from './companySummary';

type Item = CardView['faceMetrics'][number];

const reported = (label: string, display: string, url: string, asOf?: string): Item => ({
  key: label, label, display, confidence: 'Source reported',
  citations: [{ url, title: new URL(url).hostname, credibility: 'reputable_secondary' }],
  metric: { capturedAt: '2026-10-22T10:00:00.000Z', value: 1, ...(asOf ? { reportedSupport: { asOf } } : {}) },
} as unknown as Item);
const missing = (label: string): Item => ({ key: label, label, display: 'Not found yet', confidence: 'Unknown', citations: [] } as unknown as Item);

const base = { name: 'DeepSeek', summary: 'DeepSeek is headquartered in Hangzhou, Zhejiang, China.', hqLocation: 'Hangzhou, China', foundedYear: null, descriptionSources: [] };

describe('leadSentences: whole sentences only', () => {
  it('takes the first two sentences and never a cut one', () => {
    expect(leadSentences('A is one. B is two. C is three.', 2)).toEqual(['A is one.', 'B is two.']);
  });
  it('does not split after an abbreviation or an initial', () => {
    expect(leadSentences('Acme Inc. makes tools. It sells them. Third.', 2)).toEqual(['Acme Inc. makes tools.', 'It sells them.']);
  });
  it('keeps a single long sentence rather than nothing', () => {
    const long = `${'word '.repeat(120)}end.`;
    expect(leadSentences(long, 2, 100)).toEqual([long]);
  });
});

describe('the reader summary says only what the card holds', () => {
  it('states sourced figures with their caveat and date, and names the unknown ones without a value', () => {
    const out = buildCompanySummary({
      ...base,
      items: [
        reported('Valuation', '$50B', 'https://multiples.vc/deepseek', '2026-06-30'),
        reported('Employees', '160', 'https://en.wikipedia.org/wiki/DeepSeek', '2025-12-31'),
        missing('Revenue / ARR'),
      ],
    });
    const text = out.sentences.join(' ');
    expect(text).toContain('Sourced figures: Valuation $50B; Employees 160.');
    expect(text).toContain('All of them are source-reported and not independently verified.');
    expect(text).toContain('They are dated 30 Jun 2026 and 31 Dec 2025.');
    expect(text).toContain('No sourced figure was found yet for Revenue / ARR.');
    expect(out.sources.map((s) => [s.publisher, s.labels])).toEqual([['multiples.vc', ['Valuation']], ['en.wikipedia.org', ['Employees']]]);
    expect(out.sentences.length).toBeLessThanOrEqual(6);
  });

  it('names each source type on its own line when the figures differ, without a verb that has to agree', () => {
    const cited = (label: string, display: string, credibility: string): Item => ({
      key: label, label, display, confidence: 'Verified',
      citations: [{ url: 'https://' + label.toLowerCase() + '.example.org/a', title: label + ' source', credibility }],
      metric: { capturedAt: '2026-10-22T10:00:00.000Z', value: 1 },
    } as unknown as Item);
    const text = buildCompanySummary({ ...base, items: [cited('Valuation', '$1B', 'industry'), cited('Employees', '12', 'reputable_secondary')] }).sentences.join(' ');
    expect(text).toContain('Valuation: from an industry source.');
    expect(text).toContain('Employees: from independent reporting.');
  });

  it('gives no value for a figure the face shows as unsourced and says so when nothing is sourced', () => {
    const out = buildCompanySummary({ ...base, items: [missing('Valuation'), missing('Employees')] });
    const text = out.sentences.join(' ');
    expect(text).toContain('No sourced figure was found yet for Valuation and Employees.');
    expect(text).not.toMatch(/Sourced figures/);
    expect(out.sources).toEqual([]);
  });

  it('says the sources give no date rather than inventing one', () => {
    const out = buildCompanySummary({ ...base, items: [reported('Employees', '160', 'https://example.org/a')] });
    expect(out.sentences.join(' ')).toContain('The sources give no date for it (recorded 22 Oct 2026).');
  });

  it('adds where and when only from stored fields, and not where the description already says it', () => {
    const said = buildCompanySummary({ ...base, items: [] }).sentences.join(' ');
    expect(said).not.toContain('is based in');
    const added = buildCompanySummary({ ...base, summary: 'DeepSeek builds language models.', foundedYear: 2023, items: [] }).sentences.join(' ');
    expect(added).toContain('DeepSeek is based in Hangzhou, China and was founded in 2023.');
    const none = buildCompanySummary({ ...base, summary: 'DeepSeek builds language models.', hqLocation: null, foundedYear: null, items: [] }).sentences.join(' ');
    expect(none).not.toMatch(/based in|founded in/);
  });

  it('keeps the summary to six sentences, dropping the place and date lines first', () => {
    const out = buildCompanySummary({
      ...base, summary: 'One. Two.', hqLocation: 'Paris, France', foundedYear: 2020,
      items: [reported('Valuation', '$1B', 'https://a.example/x', '2026-01-01'), missing('Employees')],
    });
    expect(out.sentences.length).toBeLessThanOrEqual(6);
    expect(out.sentences.join(' ')).toContain('Sourced figures: Valuation $1B.');
    expect(out.sentences.join(' ')).toContain('No sourced figure was found yet for Employees.');
  });

  it('says plainly when no description was recorded', () => {
    expect(buildCompanySummary({ ...base, summary: '', items: [] }).sentences[0]).toBe('No concise research summary has been recorded for this card.');
  });
});
