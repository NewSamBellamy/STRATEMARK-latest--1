import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ReadOnlyProvider } from '@/lib/readOnly';
import { MARKDOWN_TRUSTED_BUDGET } from '@/lib/boundedMarkdown';
import { BoundedMarkdown } from './BoundedMarkdown';
import { ResearchMarkdown } from './ResearchMarkdown';

const NL = '\n';
/** A nest of `step` more spaces per line, each line opening a list item, up to `length` characters. */
function nested(length: number, step: number, marker: string): string {
  const lines: string[] = [];
  let size = 0;
  for (let depth = 0; size < length; depth++) {
    const line = `${' '.repeat(step * depth)}${marker} x`;
    lines.push(line);
    size += line.length + 1;
  }
  return lines.join(NL);
}

/** Text a stranger could put in a share, each the pattern the parser is slow on (or cannot nest) at its length. */
const HOSTILE: Array<[string, string]> = [
  ['unmatched emphasis', '*a'.repeat(10_000)],
  ['unmatched strike-through', '~~a'.repeat(6_700)],
  ['unmatched strong', '**a'.repeat(6_700)],
  ['open bracket and parenthesis', '[a](b'.repeat(4_000)],
  ['table rows', `| a | b |${NL}|---|---|${NL}${`| 1 | 2 |${NL}`.repeat(2_000)}`],
  ['image references', `![a][b]${NL}`.repeat(2_500)],
  ['footnote references', '[^a]'.repeat(5_000)],
  ['a long flat list', `- x${NL}`.repeat(5_000)],
  ['an ordered list nested line by line', nested(20_000, 3, '1.')],
  ['a bullet list nested line by line', nested(20_000, 2, '-')],
  ['blockquotes nested nine hundred deep (short, but overflows the stack)', `${'> '.repeat(900)}x`],
  ['list items nested on one line (short, but overflows the stack)', `${'- '.repeat(1_500)}x`],
];

function openedAsPlainText(container: HTMLElement): boolean {
  return container.querySelectorAll('p.whitespace-pre-line').length > 0 && !container.querySelector('em, strong, del, table, ul, ol, blockquote, a, sup');
}

describe('a share cannot make research prose freeze the tab', () => {
  for (const [name, text] of HOSTILE) {
    it(`shows ${name} as plain text, at once`, () => {
      const started = performance.now();
      const view = render(<ReadOnlyProvider><ResearchMarkdown text={text} /></ReadOnlyProvider>);
      const elapsed = performance.now() - started;
      expect(openedAsPlainText(view.container)).toBe(true);
      expect(view.container.textContent!.length).toBeGreaterThan(Math.min(text.length, 1_000) / 2);
      // The slowest of these took seconds to minutes to render before; a loaded machine still does this in tens of milliseconds.
      expect(elapsed).toBeLessThan(1_500);
    }, 60_000);
  }

  it('does the same outside the viewer (the app\'s own research, and a private link\'s report)', () => {
    const started = performance.now();
    const view = render(<BoundedMarkdown text={'*a'.repeat(80_000)} />);
    expect(performance.now() - started).toBeLessThan(1_500);
    expect(openedAsPlainText(view.container)).toBe(true);
  }, 60_000);

  it('drops the tail of an enormous text instead of building an element for each line of it', () => {
    const view = render(<ReadOnlyProvider><ResearchMarkdown text={'a\n\n'.repeat(100_000)} /></ReadOnlyProvider>);
    expect(view.container.querySelectorAll('p').length).toBeLessThanOrEqual(300);
  }, 60_000);
});

describe('honest research text is still formatted', () => {
  const overview = 'Acme **grew** in 2025 ([annual report](https://www.acme.example/ar)).\n\n- Customers: 12,000\n- Staff: 900\n\nA closing *note*.';

  it('shows an ordinary overview with its bold, link and list, in the viewer and in the app', () => {
    for (const inside of [true, false]) {
      const view = render(inside ? <ReadOnlyProvider><ResearchMarkdown text={overview} /></ReadOnlyProvider> : <ResearchMarkdown text={overview} />);
      expect(view.container.querySelector('strong')?.textContent).toBe('grew');
      expect(view.container.querySelector('a')?.getAttribute('href')).toBe('https://www.acme.example/ar');
      expect(view.container.querySelectorAll('li')).toHaveLength(2);
      expect(view.container.querySelector('em')?.textContent).toBe('note');
      view.unmount();
    }
  });

  it('formats a long report in a private link, section by section', () => {
    const report = Array.from({ length: 120 }, (_unused, i) => `## Section ${i + 1}${NL}${NL}Revenue was **steady** in the year, per the [filing](https://www.acme.example/f${i}).${NL}${NL}| Year | Revenue |${NL}|---|---|${NL}| 2025 | 1.5B |`).join(NL + NL);
    expect(report.length).toBeGreaterThan(15_000);
    expect(report.length).toBeLessThan(MARKDOWN_TRUSTED_BUDGET);
    const view = render(<BoundedMarkdown text={report} />);
    expect(view.container.querySelectorAll('h2')).toHaveLength(120);
    expect(view.container.querySelectorAll('table')).toHaveLength(120);
    expect(view.container.querySelectorAll('p.whitespace-pre-line')).toHaveLength(0);
  });

  it('keeps links to web pages only, as before', () => {
    const view = render(<ReadOnlyProvider><ResearchMarkdown text="[ok](https://www.acme.example) and [bad](javascript:alert(1))" /></ReadOnlyProvider>);
    expect(Array.from(view.container.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(['https://www.acme.example']);
  });
});
