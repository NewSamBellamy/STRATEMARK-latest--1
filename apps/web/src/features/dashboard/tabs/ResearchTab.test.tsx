import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { DashboardTab, DashboardTabResult } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { ResearchTab } from './ResearchTab';

const tab = (companyId: string, t: DashboardTab, content: unknown) =>
  ({ companyId, tab: t, content, lastRefreshedAt: '2026-10-01T00:00:00.000Z' }) as unknown as DashboardTabResult<DashboardTab>;

describe('Research & sources tab', () => {
  it('lists the sources behind news and people, and says nothing about retained records when there are none', async () => {
    const repository = Object.assign(makeRepo(), {
      getResearchEvidence: () => [],
      peekDashboardTab: vi.fn(async (id: string, t: DashboardTab) =>
        t === 'live_intel'
          ? tab(id, t, { items: [{ url: 'https://www.reuters.com/a', title: 'Raises a round', publisher: 'Reuters', publishedDate: '2026-08-19' }] })
          : t === 'team_org'
            ? tab(id, t, { nodes: [{ sourceUrl: 'https://example.org/bio' }] })
            : null),
    });
    renderWithProviders(<ResearchTab companyId="cmp_x" />, { repository });
    expect(await screen.findByRole('link', { name: 'Raises a round' })).toHaveAttribute('href', 'https://www.reuters.com/a');
    expect(screen.getByText(/2 sources behind/)).toBeInTheDocument();
    expect(screen.queryByText(/retained record/)).toBeNull();
  });

  it('shows a compact empty state when nothing is held', async () => {
    const repository = Object.assign(makeRepo(), { getResearchEvidence: () => [], peekDashboardTab: vi.fn(async () => null) });
    renderWithProviders(<ResearchTab companyId="cmp_x" />, { repository });
    expect(await screen.findByText('No sources held yet')).toBeInTheDocument();
    expect(screen.queryByText(/retained record/)).toBeNull();
  });
});
