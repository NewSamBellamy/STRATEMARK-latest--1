import { describe, expect, it } from 'vitest';
import {
  MARKDOWN_CHUNK_CAP, MARKDOWN_TRUSTED_BUDGET, PLAIN_MAX_CHARS, PLAIN_MAX_PARAGRAPHS, nestsTooDeep, planMarkdown, plainParagraphs,
  type MarkdownPart,
} from './boundedMarkdown';

const parsedText = (parts: MarkdownPart[]) => parts.flatMap((part) => (part.plain ? [] : [part.text]));
const plainText = (parts: MarkdownPart[]) => parts.flatMap((part) => (part.plain ? part.paragraphs : []));

/** Several thousand characters of ordinary research prose with headings, lists, links and a table. */
function honestReport(sections: number): string {
  return Array.from({ length: sections }, (_unused, i) => [
    `## Section ${i + 1}`,
    `Acme **grew** revenue in 2025, according to its [annual report](https://www.acme.example/ar-${i}). The company says demand is steady and notes a *modest* margin gain over the prior year, which analysts called in line with the sector.`,
    '- First point about the business, stated plainly.\n- Second point, with a figure: 12,000 customers.\n- Third point.',
    '| Year | Revenue |\n|---|---|\n| 2024 | 1.2B |\n| 2025 | 1.5B |',
  ].join('\n\n')).join('\n\n');
}

describe('how much text the markdown parser is handed in one piece', () => {
  it('parses ordinary text exactly as it is, in one piece', () => {
    const text = honestReport(3);
    expect(text.length).toBeLessThan(MARKDOWN_CHUNK_CAP);
    expect(planMarkdown(text)).toEqual([{ plain: false, text }]);
    expect(planMarkdown('')).toEqual([{ plain: false, text: '' }]);
  });

  it('shows text past the cap as plain paragraphs when the budget covers only one piece', () => {
    const text = '*a'.repeat(80_000);
    expect(text.length).toBeGreaterThan(MARKDOWN_CHUNK_CAP);
    const parts = planMarkdown(text);
    expect(parsedText(parts)).toEqual([]);
    expect(plainText(parts).join('')).toContain('*a*a*a');
    const paragraphs = 'First paragraph.\n\nSecond *paragraph*.\n\n\n\nThird.'.padEnd(MARKDOWN_CHUNK_CAP + 10, ' ');
    expect(plainText(planMarkdown(paragraphs))).toEqual(['First paragraph.', 'Second *paragraph*.', 'Third.']);
  });

  it('keeps a long honest report formatted by parsing it in pieces no larger than the cap', () => {
    const text = honestReport(40);
    expect(text.length).toBeGreaterThan(15_000);
    expect(text.length).toBeLessThan(MARKDOWN_TRUSTED_BUDGET);
    const parts = planMarkdown(text, { budget: MARKDOWN_TRUSTED_BUDGET });
    expect(plainText(parts)).toEqual([]);
    expect(parts.length).toBeGreaterThan(1);
    for (const piece of parsedText(parts)) expect(piece.length).toBeLessThanOrEqual(MARKDOWN_CHUNK_CAP);
    // Nothing lost and nothing reordered: the pieces read back as the text.
    expect(parsedText(parts).join('\n\n')).toBe(text);
  });

  it('never cuts inside a fenced code block, even one with blank lines in it', () => {
    const code = ['```', 'line one', '', 'line three', '```'].join('\n');
    const text = `${honestReport(8)}\n\n${code}\n\n${honestReport(8)}`;
    const parts = planMarkdown(text, { budget: MARKDOWN_TRUSTED_BUDGET });
    expect(parsedText(parts).filter((piece) => piece.includes('line one'))).toHaveLength(1);
    expect(parsedText(parts).find((piece) => piece.includes('line one'))).toContain(code);
  });

  it('shows only the pathological piece of a long text as plain, and parses the rest', () => {
    const hostile = '*a'.repeat(4_000);
    const text = `${honestReport(2)}\n\n${hostile}\n\n${honestReport(2)}`;
    const parts = planMarkdown(text, { budget: MARKDOWN_TRUSTED_BUDGET, chunk: 3_000 });
    expect(plainText(parts)).toEqual([hostile]);
    expect(parsedText(parts).join('\n\n')).toBe(`${honestReport(2)}\n\n${honestReport(2)}`);
    // In reading order: parsed, plain, parsed.
    expect(parts.map((part) => part.plain)).toEqual([false, true, false]);
  });

  it('stops parsing when the budget is spent and shows the rest as plain text', () => {
    const text = honestReport(80);
    const parts = planMarkdown(text, { budget: 8_000 });
    const parsed = parsedText(parts).reduce((total, piece) => total + piece.length, 0);
    expect(parsed).toBeLessThanOrEqual(8_000);
    expect(parsed).toBeGreaterThan(4_000);
    expect(plainText(parts).length).toBeGreaterThan(0);
  });

  it('refuses nesting no honest text has, wherever it sits', () => {
    expect(nestsTooDeep('> '.repeat(16))).toBe(true);
    expect(nestsTooDeep(`${'- '.repeat(20)}x`)).toBe(true);
    expect(nestsTooDeep(`${'1. '.repeat(17)}x`)).toBe(true);
    expect(nestsTooDeep('- a list item\n  - a nested item\n    - and another\n\n> a quote\n> > a quote in a quote')).toBe(false);
    expect(nestsTooDeep(honestReport(5))).toBe(false);
    // Short, but too deep to hand to the parser: it overflows the stack long before it is slow.
    expect(parsedText(planMarkdown(`${'> '.repeat(900)}x`))).toEqual([]);
    expect(plainText(planMarkdown(`${'> '.repeat(900)}x`)).join('')).toContain('> > >');
  });
});

describe('how much plain text one render will show', () => {
  it('drops the tail of an enormous text rather than building a hundred thousand elements', () => {
    const many = planMarkdown('a\n\n'.repeat(200_000));
    expect(plainText(many).length).toBeLessThanOrEqual(PLAIN_MAX_PARAGRAPHS);
    const long = planMarkdown(`${'word '.repeat(500_000)}`);
    expect(plainText(long).join('').length).toBeLessThanOrEqual(PLAIN_MAX_CHARS);
    const huge = planMarkdown('x'.repeat(5_000_000), { budget: MARKDOWN_TRUSTED_BUDGET });
    expect(plainText(huge).join('').length).toBeLessThanOrEqual(PLAIN_MAX_CHARS);
  });

  it('splits on blank lines and reads nothing', () => {
    expect(plainParagraphs('one\r\n\r\ntwo\nstill two\n \n\nthree\n\n\n')).toEqual(['one', 'two\nstill two', 'three']);
  });

  it('plans a two-megabyte hostile text in well under a second', () => {
    for (const text of ['*a'.repeat(1_000_000), '[a](b'.repeat(400_000), '> '.repeat(1_000_000), `${'a\n\n'.repeat(700_000)}`]) {
      const started = performance.now();
      planMarkdown(text, { budget: MARKDOWN_TRUSTED_BUDGET });
      planMarkdown(text);
      expect(performance.now() - started).toBeLessThan(1_000);
    }
  });
});
