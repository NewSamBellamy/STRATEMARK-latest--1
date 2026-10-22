import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { DashboardTab } from '@mi/contracts';
import { useDashboardTab } from '@/hooks/data';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { LeaderFace, MarketPeers, OverviewSnapshot, columnScales } from './OverviewSnapshot';

vi.mock('./LeaderGrid', () => ({
  useWikiHeadshot: () => null,
  photoCredit: () => 'Photo: Wikipedia',
  initialsOf: (name: string) => name.split(' ').map((w) => w[0]).join(''),
}));

const NOW = '2026-10-01T00:00:00.000Z';
const content: Partial<Record<DashboardTab, unknown>> = {
  team_org: { nodes: [
    { id: 'a', name: 'Pat Cfo', role: 'Chief Financial Officer', group: 'exec', parentId: null, bio: '' },
    { id: 'b', name: 'Sam Ceo', role: 'Chief Executive Officer', group: 'exec', parentId: null, bio: '' },
  ] },
  mission_governance: {
    mission: '', ethos: '', governanceStructure: '', board: [], positives: ['Shipped a major model'], negatives: ['Regulatory probe opened'],
    fundingRounds: [
      { round: 'Series A', amountUsd: 20e6, date: '2022', leadInvestors: ['Sequoia'] },
      { round: 'Series B', amountUsd: 300e6, date: '2025 Mar', leadInvestors: ['Thrive', 'a16z'] },
    ],
    investors: [],
  },
  live_intel: { items: [
    { id: '1', source: 'news', title: 'a', url: 'https://x.test/a', summary: '', detail: null, publishedDate: null, sentiment: 'positive', publishedAt: NOW, stale: false },
    { id: '2', source: 'news', title: 'b', url: 'https://x.test/b', summary: '', detail: null, publishedDate: null, sentiment: 'negative', publishedAt: NOW, stale: false },
  ], lastRefreshedAt: NOW, cadence: 'weekly' },
};

function Filled({ tabs, companyId }: { tabs: DashboardTab[]; companyId: string }) {
  // The tabs fill the shared cache the way they do when a reader visits them.
  for (const tab of tabs) useDashboardTab(companyId, tab); // eslint-disable-line react-hooks/rules-of-hooks
  return <OverviewSnapshot companyId={companyId} companyName="Acme" />;
}

function Filling({ companyId }: { companyId: string }) {
  useDashboardTab(companyId, 'team_org');
  return <OverviewSnapshot companyId={companyId} companyName="Acme" />;
}

function show(tabs: DashboardTab[]) {
  const repository = Object.assign(makeRepo(), {
    getDashboardTab: vi.fn(async (companyId: string, tab: DashboardTab) => (content[tab]
      ? { companyId, tab, content: content[tab], citations: [], lastRefreshedAt: NOW } : null)),
  });
  return renderWithProviders(<Filled tabs={tabs} companyId="cmp_1" />, { repository });
}

describe('overview: section headers', () => {
  it('uses the shared 16px header, not the 11px uppercase label', async () => {
    show(['team_org', 'mission_governance', 'live_intel']);
    const heading = await screen.findByRole('heading', { name: 'Leadership, funding & signals' });
    expect(heading.className).toContain('text-base');
    expect(heading.className).not.toContain('uppercase');
  });
});

describe('overview: leadership, funding and signals', () => {
  it('shows who leads, the latest round and the mood of the coverage from the researched tabs', async () => {
    show(['team_org', 'mission_governance', 'live_intel']);
    expect(await screen.findByText('Sam Ceo')).toBeInTheDocument();
    const names = screen.getAllByText(/^(Sam Ceo|Pat Cfo)$/).map((node) => node.textContent);
    expect(names).toEqual(['Sam Ceo', 'Pat Cfo']);
    expect(screen.getByText('$300M')).toBeInTheDocument();
    expect(screen.getByText('Series B')).toBeInTheDocument();
    expect(screen.getByText('Led by Thrive, a16z')).toBeInTheDocument();
    expect(screen.getByText(/2 stories \(dates not reported\): 1 positive · 0 neutral · 1 negative/)).toBeInTheDocument();
    expect(screen.getByText('Shipped a major model')).toBeInTheDocument();
    expect(screen.getByText('Regulatory probe opened')).toBeInTheDocument();
  });

  it('omits a panel whose tab is not researched rather than guessing', async () => {
    show(['team_org']);
    expect(await screen.findByText('Sam Ceo')).toBeInTheDocument();
    expect(screen.queryByText('Funding')).not.toBeInTheDocument();
    expect(screen.queryByText('Signals')).not.toBeInTheDocument();
  });

  it('says it is gathering while the dashboard researches its tabs in the background', async () => {
    const repository = Object.assign(makeRepo(), { getDashboardTab: vi.fn(() => new Promise(() => {})) });
    renderWithProviders(<Filling companyId="cmp_1" />, { repository });
    expect(await screen.findByText(/Gathering who runs Acme/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Team & org' })).not.toBeInTheDocument();
  });

  it('points at the tabs that fill it when nothing is researched yet', () => {
    show([]);
    expect(screen.getByRole('link', { name: 'Team & org' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mission & governance' })).toBeInTheDocument();
  });
});

describe('overview: in this market', () => {
  it('shows nothing without a deck to compare against', () => {
    renderWithProviders(<MarketPeers companyId="cmp_1" />);
    expect(screen.queryByText('In this market')).not.toBeInTheDocument();
  });
});

describe('overview: how they compare scales', () => {
  const cell = (value: number, currency: string | null = null) => ({ value, confidence: 'verified' as const, display: String(value), currency, converted: false });
  const row = (id: string, cells: Array<ReturnType<typeof cell> | null>) => ({ companyId: id, name: id, isSelf: id === 'me', cells });

  it('places each sourced figure among the comparable ones and scales bars to the largest', () => {
    const table = [row('a', [cell(100), null]), row('me', [cell(40), cell(7)]), row('c', [cell(10, 'EUR'), cell(9)]), row('d', [null, null])];
    const scales = columnScales(table);
    expect(scales.lead).toBe(0);
    expect(scales[0]!.max).toBe(100);
    expect(scales[0]!.count).toBe(2);
    expect(scales[0]!.rankOf(table[1]!.cells[0])).toBe(2);
    // Another currency and a missing figure take no place.
    expect(scales[0]!.rankOf(table[2]!.cells[0])).toBeNull();
    expect(scales[0]!.rankOf(null)).toBeNull();
    expect(scales[1]!.rankOf(table[1]!.cells[1])).toBe(2);
  });

  it('orders by the first column that has a comparable figure', () => {
    expect(columnScales([row('a', [null, cell(3)]), row('b', [cell(5, 'EUR'), cell(4)])]).lead).toBe(1);
  });
});

describe('overview: leader faces', () => {
  it('shows the photo stored with the person, and initials when there is none', () => {
    const { container } = renderWithProviders(<>
      <LeaderFace person={{ name: 'Sam Ceo', photoUrl: 'https://upload.wikimedia.org/sam.jpg' }} companyName="Acme" />
      <LeaderFace person={{ name: 'Pat Cfo', photoUrl: null }} companyName="Acme" />
    </>);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://upload.wikimedia.org/sam.jpg');
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(screen.getByText('PC')).toBeInTheDocument();
  });
});
