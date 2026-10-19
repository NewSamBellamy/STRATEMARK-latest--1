import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResearchMarkdown, SafeMarkdown } from './ResearchMarkdown';

describe('ResearchMarkdown storage-artifact repair', () => {
  it('unescapes escaped newlines and asterisks in mixed content', () => {
    const raw = 'OpenAI operates three functions: ' + String.fromCharCode(92) + 'n* ' + String.fromCharCode(92) + '**Research Team:**' + String.fromCharCode(92) + 'n Advances foundational AI.';
    render(<ResearchMarkdown text={raw} />);
    expect(screen.getByText('Research Team:')).toBeInTheDocument();
    expect(screen.queryByText(/{''\*'}'/)).not.toBeInTheDocument();
  });
  it('keeps real markdown bold rendering as bold', () => {
    render(<ResearchMarkdown text={'Real **bold** text.'} />);
    expect(screen.getByText('bold')).toBeInTheDocument();
  });
});

describe('SafeMarkdown', () => {
  const hrefs = (root: ParentNode) => Array.from(root.querySelectorAll('a')).map((a) => a.getAttribute('href'));

  it('never loads an image, however it is written, and shows its alt text', () => {
    const md = [
      '![inline](https://evil.example/p.gif?x=1)',
      '![protocol-relative](//evil.example/p.png)',
      '![by-reference][r]',
      '![collapsed][]',
      '<img src="https://evil.example/raw.png">',
      '[r]: //evil.example/ref.png',
      '[collapsed]: https://evil.example/c.png',
    ].join('\n\n');
    const { container } = render(<SafeMarkdown>{md}</SafeMarkdown>);
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(screen.getByText('inline')).toBeInTheDocument();
    expect(screen.getByText('protocol-relative')).toBeInTheDocument();
    expect(screen.getByText('by-reference')).toBeInTheDocument();
  });

  it('links http and https addresses only, in a new tab without the opener', () => {
    const md = [
      '[web](https://www.sec.gov/x)',
      '[plain](http://example.com/a)',
      '[script](javascript:alert(1))',
      '[mixed](JaVaScRiPt:alert(1))',
      '[data](data:text/html,x)',
      '[pr](//evil.example/phish)',
      '[ref][r]',
      '[file](file:///etc/passwd)',
      '[rel](/#/settings)',
      '[r]: //evil.example/phish',
    ].join('\n\n');
    const { container } = render(<SafeMarkdown>{md}</SafeMarkdown>);
    expect(hrefs(container)).toEqual(['https://www.sec.gov/x', 'http://example.com/a']);
    for (const a of Array.from(container.querySelectorAll('a'))) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    }
    // A refused link keeps its words.
    expect(screen.getByText('pr')).toBeInTheDocument();
    expect(screen.getByText('ref')).toBeInTheDocument();
  });

  it('keeps a caller\'s own link class and element overrides but not their own a or img', () => {
    const { container } = render(
      <SafeMarkdown linkClassName="link" components={{ td: ({ children }) => <td data-cell="1">{children}</td> }}>
        {'| a |\n|---|\n| [x](https://example.com/) |\n\n![p](https://evil.example/p.png)'}
      </SafeMarkdown>,
    );
    expect(container.querySelector('a.link')).toHaveAttribute('href', 'https://example.com/');
    expect(container.querySelector('td[data-cell="1"]')).not.toBeNull();
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });
});

describe('every surface renders Markdown through the safe component', () => {
  // A bare ReactMarkdown loads images and keeps protocol-relative links, so no
  // file but the shared component may import it.
  const sources = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

  it('has no other importer of react-markdown', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !/\.test\.tsx?$/.test(path) && !path.endsWith('/components/ResearchMarkdown.tsx'))
      .filter(([, text]) => /from\s+['"]react-markdown['"]/.test(text))
      .map(([path]) => path);
    expect(Object.keys(sources).length).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });
});
