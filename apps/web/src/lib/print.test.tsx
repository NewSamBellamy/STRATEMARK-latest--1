import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrintBrand, PrintColophon } from '@/components/PrintFrame';
import { printScoped, scopedPageCss } from './print';

afterEach(() => { document.head.querySelectorAll('[data-sm-print-page]').forEach((n) => n.remove()); document.body.className = ''; });

describe('branded scoped print', () => {
  it('puts Stratemark and the title in the running footer, with page numbers', () => {
    const css = scopedPageCss('Acme site audit', 'en-US');
    expect(css).toContain('size: Letter');
    expect(css).toContain('Stratemark \\00b7  Acme site audit');
    expect(css).toContain('counter(page)');
  });

  it('cannot be broken out of by a hostile title', () => {
    const css = scopedPageCss('x"; } body { display:none } "', 'en-GB');
    expect(css).not.toContain('body { display:none }"');
    expect(css).toContain('\\"');
  });

  it('adds the page rule and the print class only while printing, then removes them', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      expect(document.head.querySelector('[data-sm-print-page]')?.textContent).toContain('Stratemark');
      expect(document.body.classList.contains('brf-printing')).toBe(true);
    });
    printScoped('Daily briefing');
    expect(print).toHaveBeenCalled();
    window.dispatchEvent(new Event('afterprint'));
    expect(document.head.querySelector('[data-sm-print-page]')).toBeNull();
    expect(document.body.classList.contains('brf-printing')).toBe(false);
  });

  it('renders a print-only masthead and colophon carrying the brand', () => {
    render(<><PrintBrand kind="Site audit" /><PrintColophon /></>);
    expect(screen.getByTestId('print-brand')).toHaveTextContent('Stratemark');
    expect(screen.getByTestId('print-brand')).toHaveClass('hidden', 'print:block');
    expect(screen.getByTestId('print-colophon')).toHaveTextContent('getstratemark.com');
  });
});

describe('every on-screen report that prints carries the brand', () => {
  const sources = import.meta.glob('/src/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  // Printed through the designed-cover pipeline (features/export), which brands itself.
  const DESIGNED = new Set(['/src/features/reports/TopicReportPage.tsx']);

  it('has a branded masthead in each file that scopes a print to the page', () => {
    const roots = Object.entries(sources).filter(([path, src]) => !path.includes('.test.') && src.includes('brf-print-root'));
    expect(roots.length).toBeGreaterThanOrEqual(4);
    const unbranded = roots.filter(([path, src]) => !DESIGNED.has(path) && !src.includes('<PrintBrand')).map(([path]) => path);
    expect(unbranded, `Print roots with no PrintBrand: ${unbranded.join(', ')}`).toEqual([]);
  });

  it('never passes printScoped straight to onClick (it would receive the click event as its title)', () => {
    const bad = Object.entries(sources).filter(([path, src]) => !path.includes('.test.') && /onClick=\{printScoped\}/.test(src)).map(([path]) => path);
    expect(bad).toEqual([]);
  });
});
