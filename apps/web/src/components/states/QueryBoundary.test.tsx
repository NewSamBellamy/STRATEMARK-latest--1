import { render, screen } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { QueryBoundary } from './QueryBoundary';

describe('QueryBoundary', () => {
  it('does not describe an ordinary local read as live research', () => {
    const query = { isPending: true } as unknown as UseQueryResult<string>;

    render(<QueryBoundary query={query}>{() => null}</QueryBoundary>);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText(/live sources|grounded Google/i)).not.toBeInTheDocument();
  });

  it('turns a missing Gemini key into an actionable empty state', () => {
    const query = {
      isPending: false,
      isError: true,
      error: new Error('No Gemini API key configured'),
      refetch: vi.fn(),
    } as unknown as UseQueryResult<string>;

    render(<QueryBoundary query={query}>{() => null}</QueryBoundary>);

    expect(screen.getByText('Connect Gemini to research this view')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeInTheDocument();
    expect(screen.queryByText('Failed to load')).not.toBeInTheDocument();
  });
});
