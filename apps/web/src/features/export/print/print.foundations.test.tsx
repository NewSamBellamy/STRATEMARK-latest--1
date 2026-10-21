import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { cssString, paperFor, printPageCss, printTitleOf } from './pageStyle';
import { Row, Section } from './Section';
import type { PrintJob } from '../PrintDocument';

describe('per-job page style', () => {
  it('uses Letter for en-US and en-CA and A4 elsewhere', () => {
    expect(printPageCss({ locale: 'en-US', title: 'T' })).toContain('size: Letter;');
    expect(printPageCss({ locale: 'en-CA', title: 'T' })).toContain('size: Letter;');
    expect(printPageCss({ locale: 'en-GB', title: 'T' })).toContain('size: A4;');
    expect(printPageCss({ locale: 'fr-CA', title: 'T' })).toContain('size: Letter;');
    expect(paperFor('de-DE')).toBe('A4');
    expect(paperFor('en')).toBe('A4');
    expect(paperFor(undefined)).toBe('A4');
    expect(paperFor('en_us')).toBe('Letter');
  });

  it('puts the title bottom left, the page count bottom right, and no footer on the cover', () => {
    const css = printPageCss({ locale: 'en-GB', title: 'Frontier AI' });
    expect(css).toContain('@bottom-left { content: "Stratemark \\00b7  Frontier AI"');
    expect(css).toContain('counter(page)');
    expect(css).toContain('counter(pages)');
    expect(css).toMatch(/@page :first \{ @bottom-left \{ content: ""; \}/);
  });

  it('escapes quotes, backslashes and line breaks in the title', () => {
    expect(cssString('a"b')).toBe('a\\"b');
    expect(cssString('a\\b')).toBe('a\\\\b');
    expect(cssString('a\nb')).toBe('a b');
    const css = printPageCss({ locale: 'en-GB', title: 'x"; } body { display:none } /* \\' });
    // The injected quote cannot close the string: every quote inside the footer text is backslash-escaped.
    expect(css).toContain('x\\"; } body { display:none } /* \\\\');
    expect(css.split('\n')).toHaveLength(5);
  });

  it('names the subject of each report kind', () => {
    const job = { kind: 'transcript', title: 'Chat', scopeLabel: null, dateText: '', messages: [] } as PrintJob;
    expect(printTitleOf(job)).toBe('Chat');
  });
});

describe('Section', () => {
  it('renders its running head in a thead and its rows in the tbody', () => {
    const { container } = render(
      <Section id="s" className="sm-signals" head={<h2>Market signals</h2>}>
        <Row>First block</Row>
        <Row>Second block</Row>
      </Section>,
    );
    const section = container.querySelector('section#s');
    expect(section?.className).toBe('sm-signals');
    expect(container.querySelector('table.sm-run > thead th')?.textContent).toBe('Market signals');
    expect(container.querySelectorAll('table.sm-run > tbody > tr')).toHaveLength(2);
    expect(container.querySelector('header')).toBeNull();
  });
});
