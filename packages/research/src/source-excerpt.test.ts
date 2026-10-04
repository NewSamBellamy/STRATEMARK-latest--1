import { describe, expect, it } from 'vitest';
import { selectSourceExcerpt } from './source-excerpt';

describe('bounded contiguous source excerpt', () => {
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
