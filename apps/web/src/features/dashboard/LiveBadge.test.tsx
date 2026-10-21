import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveBadge } from './LiveBadge';
import { featuredStories } from './tabs/LiveIntelTab';
import type { LiveIntelItem } from '@mi/contracts';

const NOW = Date.parse('2026-10-21T12:00:00Z');

describe('LiveBadge honesty', () => {
  it('says Live within 7 days', () => {
    render(<LiveBadge lastRefreshedAt="2026-10-20T12:00:00Z" now={NOW} />);
    expect(screen.getByText(/Live · updated/)).toBeInTheDocument();
  });
  it('says Last checked once data is older than 7 days', () => {
    render(<LiveBadge lastRefreshedAt="2026-07-30T12:00:00Z" now={NOW} />);
    expect(screen.getByText(/^Last checked/)).toBeInTheDocument();
    expect(screen.queryByText(/Live/)).toBeNull();
  });
});

describe('LiveBadge unparseable date', () => {
  it('never prints Invalid Date', () => {
    render(<LiveBadge lastRefreshedAt="not a date" now={NOW} />);
    expect(screen.getByText(/^Last checked/)).toBeInTheDocument();
    expect(screen.queryByText(/Invalid/)).toBeNull();
  });
});

describe('featuredStories', () => {
  it('takes the first four fresh stories, so the list below can leave them out', () => {
    const mk = (id: string, stale = false) => ({ id, stale }) as LiveIntelItem;
    const items = [mk('a'), mk('b', true), mk('c'), mk('d'), mk('e'), mk('f')];
    expect(featuredStories(items).map((i) => i.id)).toEqual(['a', 'c', 'd', 'e']);
  });
});
