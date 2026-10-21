import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SafeLink } from './SafeLink';

describe('SafeLink', () => {
  it('opens a normal source in a new tab without leaking the opener', () => {
    render(<SafeLink href="https://www.sec.gov/x" className="inline-flex text-primary-ink hover:underline">SEC</SafeLink>);
    const link = screen.getByRole('link', { name: 'SEC' });
    expect(link).toHaveAttribute('href', 'https://www.sec.gov/x');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveClass('hover:underline');
  });

  it('renders the same words as plain text when the target is not a web address', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,x', '//evil.example/x', '', undefined, null]) {
      const { container, unmount } = render(
        <SafeLink href={href} className="inline-flex text-primary-ink hover:underline" data-testid="src">Publisher</SafeLink>,
      );
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      const text = screen.getByTestId('src');
      expect(text.tagName).toBe('SPAN');
      expect(text).toHaveTextContent('Publisher');
      // Same box, but nothing that invites a click.
      expect(text).toHaveClass('inline-flex', 'text-primary-ink');
      expect(text).not.toHaveClass('hover:underline');
      expect(container.querySelector('[href]')).toBeNull();
      unmount();
    }
  });
});
