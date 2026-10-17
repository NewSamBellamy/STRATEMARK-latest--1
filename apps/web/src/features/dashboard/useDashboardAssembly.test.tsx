import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { sectionFilled, useDashboardAssembly } from './useDashboardAssembly';

describe('sectionFilled', () => {
  it('counts a section only when it holds real content', () => {
    expect(sectionFilled('overview', { markdown: '  ' })).toBe(false);
    expect(sectionFilled('overview', { markdown: 'A brief.' })).toBe(true);
    expect(sectionFilled('team_org', { nodes: [] })).toBe(false);
    expect(sectionFilled('team_org', { nodes: [{ id: 'a' }] })).toBe(true);
    expect(sectionFilled('history', { timeline: [], founderStory: '' })).toBe(false);
    expect(sectionFilled('history', { timeline: [], founderStory: 'Founded in a garage.' })).toBe(true);
    expect(sectionFilled('metrics', { rows: [1] })).toBe(true);
    expect(sectionFilled('live_intel', null)).toBe(false);
  });
});

function Probe({ finish }: { finish: Promise<void> }) {
  // A tab research in flight, as the dashboard's own query would be.
  useQuery({ queryKey: ['dashboard', 'cmp', 'history'], queryFn: async () => { await finish; return { content: {} }; } });
  const a = useDashboardAssembly('cmp');
  return (
    <div>
      <p data-testid="state">{a.state('history')}</p>
      <p data-testid="count">{a.filled} of {a.total}</p>
      <p data-testid="landed">{[...a.landed].join(',')}</p>
      <p data-testid="working">{String(a.working)}</p>
    </div>
  );
}

describe('useDashboardAssembly', () => {
  it('shows a section being researched, then filled and briefly highlighted once it lands', async () => {
    let filled = false;
    const peekDashboardTab = vi.fn(async (_id: string, tab: string) => (tab === 'history' && filled
      ? { companyId: 'cmp', tab, content: { timeline: [{ date: '2020', title: 'x', detail: '' }], founderStory: '', quotes: [] }, lastRefreshedAt: null }
      : null));
    const repo = Object.assign(makeRepo(), { peekDashboardTab });
    let release!: () => void;
    const finish = new Promise<void>((r) => { release = r; });
    renderWithProviders(<Probe finish={finish} />, { repository: repo });

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('researching'));
    expect(screen.getByTestId('count')).toHaveTextContent('0 of 7');

    filled = true;
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('filled'));
    expect(screen.getByTestId('count')).toHaveTextContent('1 of 7');
    await waitFor(() => expect(screen.getByTestId('landed')).toHaveTextContent('history'));
    expect(screen.getByTestId('working')).toHaveTextContent('false');
  });
});
