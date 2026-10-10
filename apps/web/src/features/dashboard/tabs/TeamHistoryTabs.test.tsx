import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { TeamOrgTab } from './TeamOrgTab';
import { HistoryTab } from './HistoryTab';

vi.mock('./LeaderGrid', () => ({ WikiAvatar: ({ name }: { name: string }) => <span>{name.charAt(0)}</span> }));

function repoWith(tab: string, content: unknown) {
  const getDashboardTab = vi.fn().mockResolvedValue({
    companyId: 'cmp', tab, content, lastRefreshedAt: '2026-10-01T00:00:00.000Z',
  });
  return Object.assign(makeRepo(), { getDashboardTab });
}

describe('team & org tab', () => {
  it('charts reporting lines, collapses a branch and filters by search', async () => {
    const { user } = renderWithProviders(<TeamOrgTab companyId="cmp" />, {
      repository: repoWith('team_org', {
        nodes: [
          { id: 'a', name: 'Ada Lovelace', role: 'CEO', group: 'exec', parentId: null, bio: '' },
          { id: 'b', name: 'Bo Chen', role: 'CTO', group: 'ai', parentId: 'a', bio: '' },
        ],
      }),
    });
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Bo Chen')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Collapse Ada Lovelace/ }));
    expect(screen.queryByText('Bo Chen')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Search people'), 'cto');
    expect(screen.getByText('Bo Chen')).toBeInTheDocument();
  });

  it('shows an intentional empty state when no one was sourced', async () => {
    renderWithProviders(<TeamOrgTab companyId="cmp" />, { repository: repoWith('team_org', { nodes: [] }) });
    expect(await screen.findByText('No leadership surfaced yet')).toBeInTheDocument();
  });
});

describe('history tab', () => {
  it('groups events by year, newest first, and says so when none exist', async () => {
    renderWithProviders(<HistoryTab companyId="cmp" />, {
      repository: repoWith('history', {
        founderStory: '',
        quotes: [],
        timeline: [
          { date: '2019', title: 'Founded', detail: '' },
          { date: '2024 Mar', title: 'Raised Series B', detail: '' },
        ],
      }),
    });
    const y24 = (await screen.findAllByText('2024'))[0]!;
    const y19 = screen.getAllByText('2019')[0]!;
    expect(y24.compareDocumentPosition(y19) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('No attributable quotes yet')).toBeInTheDocument();
  });

  it('labels an empty timeline instead of leaving a blank panel', async () => {
    renderWithProviders(<HistoryTab companyId="cmp" />, {
      repository: repoWith('history', { founderStory: '', quotes: [], timeline: [] }),
    });
    expect(await screen.findByText('No dated milestones sourced yet')).toBeInTheDocument();
  });
});
