import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { BackLink } from './BackLink';
import { EmptyState } from '../states/EmptyState';

describe('BackLink', () => {
  it('is a link to the given route with the given label', () => {
    render(
      <MemoryRouter>
        <BackLink to="/history">Back to all decks</BackLink>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Back to all decks' })).toHaveAttribute('href', '/history');
  });
});

describe('EmptyState page', () => {
  it('uses one narrow centred width on a page', () => {
    const { container } = render(<EmptyState title="Nothing yet" page />);
    expect(container.firstElementChild?.className).toContain('max-w-xl');
  });
});
