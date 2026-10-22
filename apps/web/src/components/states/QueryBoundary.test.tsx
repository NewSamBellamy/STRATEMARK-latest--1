import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';
import { QueryBoundary } from './QueryBoundary';

const missing = { isPending: false, isError: false, data: null } as unknown as UseQueryResult<null>;

function show(notFoundIsPage?: boolean) {
  render(
    <MemoryRouter>
      <QueryBoundary query={missing} notFoundIsPage={notFoundIsPage}>{() => null}</QueryBoundary>
    </MemoryRouter>,
  );
}

describe('QueryBoundary not-found', () => {
  it('is the page h1 when the boundary wraps a whole page', () => {
    show(true);
    expect(screen.getByRole('heading', { level: 1, name: 'Not found' })).toBeTruthy();
  });

  it('stays a section heading by default, inside a page that has its own h1', () => {
    show();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'Not found' })).toBeTruthy();
  });
});
