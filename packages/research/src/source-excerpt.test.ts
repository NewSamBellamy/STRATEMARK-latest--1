import { describe, expect, it } from 'vitest';
import { selectSourceExcerpt } from './source-excerpt';
import { acceptedMetricPassage } from './metric-support';

describe('bounded contiguous source excerpt', () => {
  it('keeps the actual workforce disclosure over a named benefits section with incidental numbers', () => {
    const wanted = 'As of June 30, 2026, we had approximately 223,000 full-time employees.';
    const text = `Acme Inc. pays employees benefits in 2026.${' filler '.repeat(1100)}${wanted}${' appendix '.repeat(600)}`;
    const result = selectSourceExcerpt(text, { companyName: 'Acme Inc.', metricType: 'employees' });
    expect(result).toContain(wanted);
    expect(text).toContain(result);
    expect(result).toHaveLength(4000);
  });
  it('selects a full-time-basis workforce disclosure ahead of incidental employees in a company introduction', () => {
    const wanted = 'As of June 30, 2026, we employed approximately 223,000 people on a full-time basis, 121,000 in the U.S. and 102,000 internationally.';
    const text = `Microsoft Corporation empowers employees through its 2026 products.${' filler '.repeat(1100)}${wanted}${' appendix '.repeat(600)}`;
    const result = selectSourceExcerpt(text, { companyName: 'Microsoft Corporation', metricType: 'employees' });
    expect(result).toContain(wanted);
    expect(text).toContain(result);
  });
  it('targets product/roadmap research rather than a richer financial section', () => {
    const wanted = 'Acme Inc. says Atlas is now available. Atlas Connect is on the announced roadmap. Product pricing and documentation are published here.';
    const text = `Acme Inc. has 900 employees, USD 20 million ARR and 500 active users.${' filler '.repeat(1100)}${wanted}${' appendix '.repeat(600)}`;
    const result = selectSourceExcerpt(text, { companyName: 'Acme Inc.', metricType: 'products_roadmap' });
    expect(result).toContain(wanted);
    expect(result).not.toContain('900 employees');
    expect(text).toContain(result);
    expect(result).toHaveLength(4000);
  });
  it('prioritizes the requested company over a richer unrelated company section', () => {
    const wanted = 'Acme Inc. reported 450 employees on October 1, 2026.';
    const text = `Other Inc. has 900 employees, USD 20 million ARR and 500 active users.${' filler '.repeat(1100)}${wanted}${' appendix '.repeat(600)}`;
    const result = selectSourceExcerpt(text, { companyName: 'Acme Inc.', metricType: 'employees' });
    expect(result).toContain(wanted);
    expect(result).not.toContain('Other Inc.');
    expect(text).toContain(result);
    expect(result.length).toBeLessThanOrEqual(4000);
  });
  it('prioritizes the requested metric when the company has distant sections', () => {
    const wanted = 'Acme Inc. reported USD 50 million ARR on October 1, 2026.';
    const text = `Acme Inc. has 450 employees, 1000 active users and a valuation of USD 200 million.${' filler '.repeat(1100)}${wanted}${' appendix '.repeat(600)}`;
    expect(selectSourceExcerpt(text, { companyName: 'Acme Inc.', metricType: 'arr' })).toContain(wanted);
  });
  it('retains the requested metric in first-person filings without inventing company attribution', () => {
    const wanted = 'As of October 1, 2026, we had 450 employees.';
    const text = `Products have 1000 users and annual revenue of USD 50 million, at a valuation of USD 200 million.${' filler '.repeat(1100)}${wanted}${' appendix '.repeat(600)}`;
    const result = selectSourceExcerpt(text, { companyName: 'Acme Inc.', metricType: 'employees' });
    expect(result).toContain(wanted);
    expect(result).not.toContain('Products have');
    expect(text).toContain(result);
    expect(result).toHaveLength(4000);
    const url = 'https://sec.gov/report';
    expect(acceptedMetricPassage({ companyName: 'Acme Inc.', metricType: 'employees', value: 450,
      support: { sourceUrl: url, quote: wanted, asOf: '2026-10-01', basis: 'employees', unit: 'count' },
      originals: [{ requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200,
        contentHash: 'a'.repeat(64), text: result, retrievedAt: '2026-10-02T00:00:00.000Z' }] })).toEqual([]);
  });
  it('matches a company name literally, not as a regular expression', () => {
    const wanted = 'Acme (UK) Ltd. has 40 employees on October 1, 2026.';
    const text = `Wrong Ltd. has 500 employees and 40 users.${' filler '.repeat(1100)}${wanted}${' appendix '.repeat(600)}`;
    expect(selectSourceExcerpt(text, { companyName: 'Acme (UK) Ltd.', metricType: 'employees' })).toContain(wanted);
  });
  it('preserves short pages exactly', () => {
    const text = 'Acme Inc. has 450 employees. Published October 1, 2026.';
    expect(selectSourceExcerpt(text)).toBe(text);
  });
  it('keeps the old prefix when no business figures are found', () => {
    const text = 'General narrative. '.repeat(600);
    expect(selectSourceExcerpt(text)).toBe(text.slice(0, 4000));
  });
  it('keeps preceding company and reporting date with a late metric', () => {
    const text = `${'Menu content. '.repeat(600)}Acme Inc. on October 1, 2026 reported annual recurring revenue of USD 20 million.${' Appendix.'.repeat(600)}`;
    const result = selectSourceExcerpt(text);
    expect(result).toContain('Acme Inc. on October 1, 2026 reported annual recurring revenue of USD 20 million.');
    expect(result.length).toBeLessThanOrEqual(4000);
    expect(text).toContain(result);
  });
  it('prefers a cluster of different business figures over repetitive navigation', () => {
    const early = 'Menu: 5 employees links. '.repeat(170);
    const late = 'Acme Inc. reported 450 employees, USD 20 million ARR and 10000 active users on October 1, 2026.';
    const text = `${early}${' Plain text.'.repeat(500)}${late}${' Appendix.'.repeat(500)}`;
    expect(selectSourceExcerpt(text)).toContain(late);
  });
  it('never stitches distant company, date and metric fragments into a new quote', () => {
    const text = `Acme Inc. October 1, 2026 ${'Unrelated prose. '.repeat(500)}Other Inc. has 99 employees.${' Appendix.'.repeat(500)}`;
    const result = selectSourceExcerpt(text);
    expect(text).toContain(result);
    expect(result).not.toContain('Acme Inc.');
  });
  it('does not focus a page on metric labels without nearby numeric information', () => {
    const text = `${'Introduction. '.repeat(500)}Employees and annual recurring revenue are not disclosed.${' Appendix.'.repeat(500)}`;
    expect(selectSourceExcerpt(text)).toBe(text.slice(0, 4000));
  });
  it('uses stable earliest-window tie breaking and keeps the hard text ceiling', () => {
    const text = `${'Start. '.repeat(800)}First Inc. has 40 employees.${' Middle.'.repeat(700)}Second Inc. has 50 employees.${' End.'.repeat(600)}`;
    expect(selectSourceExcerpt(text)).toContain('First Inc. has 40 employees.');
    expect(selectSourceExcerpt(text)).not.toContain('Second Inc.');
    expect(selectSourceExcerpt(text)).toHaveLength(4000);
  });

  it('includes a metric at the very end without shrinking the saved window', () => {
    const quote = 'Société Acme reported a valuation of USD 20 million on October 1, 2026.';
    const text = `${'Earlier prose. '.repeat(700)}${quote}`;
    expect(selectSourceExcerpt(text)).toHaveLength(4000);
    expect(selectSourceExcerpt(text)).toContain(quote);
    expect(text.endsWith(selectSourceExcerpt(text))).toBe(true);
  });
});
