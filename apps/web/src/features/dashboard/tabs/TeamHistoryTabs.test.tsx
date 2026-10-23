import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { TeamOrgTab } from './TeamOrgTab';
import { HistoryTab } from './HistoryTab';

vi.mock('./LeaderGrid', () => ({
  WikiAvatar: ({ name }: { name: string }) => <span>{name.charAt(0)}</span>,
  useWikiHeadshot: () => null,
  useWikiHeadshotResult: () => ({ shot: null, settled: true }),
  photoCredit: () => '',
  initialsOf: (n: string) => n.charAt(0),
}));

function repoWith(tab: string, content: unknown) {
  const getDashboardTab = vi.fn().mockResolvedValue({
    companyId: 'cmp', tab, content, lastRefreshedAt: '2026-10-01T00:00:00.000Z',
  });
  return Object.assign(makeRepo(), { getDashboardTab });
}

const orgNodes = [
  { id: 'a', name: 'Ada Lovelace', role: 'CEO', group: 'exec', parentId: null, bio: '' },
  { id: 'b', name: 'Bo Chen', role: 'CTO', group: 'ai', parentId: 'a', bio: '' },
];

describe('team & org tab', () => {
  it('defaults to people in sections, toggles to reporting lines and remembers the choice', async () => {
    localStorage.removeItem('mi.teamOrgView');
    const { user } = renderWithProviders(<TeamOrgTab companyId="cmp" />, {
      repository: repoWith('team_org', { nodes: orgNodes }),
    });
    expect(await screen.findByRole('group', { name: 'Org board' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-person-id]')).toHaveLength(2);
    expect(document.querySelector('path[data-string]')).toBeNull();
    expect(screen.getByRole('button', { name: 'People' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Reporting lines' }));
    expect(screen.queryByRole('group', { name: 'Org board' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Collapse Ada Lovelace/ })).toBeInTheDocument();
    expect(localStorage.getItem('mi.teamOrgView')).toBe('list');
    localStorage.removeItem('mi.teamOrgView');
  });

  it('offers no view toggle when research sourced no reporting lines', async () => {
    localStorage.setItem('mi.teamOrgView', 'list');
    const flat = orgNodes.map((n) => ({ ...n, parentId: null }));
    renderWithProviders(<TeamOrgTab companyId="cmp" />, { repository: repoWith('team_org', { nodes: flat }) });
    expect(await screen.findByRole('group', { name: 'Org board' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reporting lines' })).not.toBeInTheDocument();
    localStorage.removeItem('mi.teamOrgView');
  });

  it('migrates the old "chart" view choice to people', async () => {
    localStorage.setItem('mi.teamOrgView', 'chart');
    renderWithProviders(<TeamOrgTab companyId="cmp" />, { repository: repoWith('team_org', { nodes: orgNodes }) });
    expect(await screen.findByRole('group', { name: 'Org board' })).toBeInTheDocument();
    localStorage.removeItem('mi.teamOrgView');
  });

  it('filters by section with one segmented control, and says so when search finds no one', async () => {
    localStorage.removeItem('mi.teamOrgView');
    const nodes = [...orgNodes, { id: 'c', name: 'Cy Park', role: 'Head of Product', group: 'product', parentId: 'a', bio: '' }];
    const { user } = renderWithProviders(<TeamOrgTab companyId="cmp" />, { repository: repoWith('team_org', { nodes }) });
    await screen.findByRole('group', { name: 'Org board' });
    const picker = screen.getByRole('group', { name: 'Show section' });
    expect(screen.queryByRole('button', { name: /Moving/ })).not.toBeInTheDocument();
    await user.click(within(picker).getByRole('button', { name: /Product & design/ }));
    expect([...document.querySelectorAll('[data-person-id]')].map((e) => e.getAttribute('data-person-id'))).toEqual(['c']);
    await user.click(within(picker).getByRole('button', { name: /Everyone/ }));
    expect(document.querySelectorAll('[data-person-id]')).toHaveLength(3);
    await user.type(screen.getByLabelText('Search people'), 'zzzz');
    expect(await screen.findByText(/No one matches/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Clear search' }).at(-1)!);
    expect(screen.getByLabelText('Search people')).toHaveValue('');
  });

  it('charts reporting lines, collapses a branch and filters by search (list view)', async () => {
    localStorage.setItem('mi.teamOrgView', 'list');
    const { user } = renderWithProviders(<TeamOrgTab companyId="cmp" />, {
      repository: repoWith('team_org', {
        nodes: orgNodes }),
    });
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Bo Chen')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Collapse Ada Lovelace/ }));
    expect(screen.queryByText('Bo Chen')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Search people'), 'cto');
    expect(screen.getByText('Bo Chen')).toBeInTheDocument();
    localStorage.removeItem('mi.teamOrgView');
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

  it('never says "Amount not reported" under a description that states an amount', async () => {
    renderWithProviders(<HistoryTab companyId="cmp" />, {
      repository: repoWith('history', {
        founderStory: '',
        quotes: [],
        timeline: [
          { date: '2025', title: 'Series E funding', detail: 'Closes an oversubscribed $1.375 billion Series E round led by Zeta Ventures.' },
          { date: '2024', title: 'Series C funding', detail: 'Raises $50 million plus a $20 million extension.' },
          { date: '2023', title: 'Series D funding', detail: 'Announces a round.' },
          { date: '2022', title: 'Seed funding', detail: 'Raises a €105M seed round.' },
        ],
      }),
    });
    expect(await screen.findByText(/\$1\.4B/)).toBeInTheDocument();
    expect(screen.getByText(/Zeta Ventures/, { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('€105M')).toBeInTheDocument();
    // Only the round whose text states nothing is called "not reported".
    expect(screen.getAllByText('Amount not reported')).toHaveLength(1);
  });

  it('labels an empty timeline instead of leaving a blank panel', async () => {
    renderWithProviders(<HistoryTab companyId="cmp" />, {
      repository: repoWith('history', { founderStory: '', quotes: [], timeline: [] }),
    });
    expect(await screen.findByText('No dated milestones sourced yet')).toBeInTheDocument();
  });
});
