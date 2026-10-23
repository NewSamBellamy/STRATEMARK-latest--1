import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BusinessRelationship, Product, RoadmapItem } from '@mi/contracts';
import { ProductsRoadmapTab, isPastDue, targetEnd, uniformProductStatus } from './ProductsRoadmapTab';

const state = vi.hoisted(() => ({ products: [] as Product[], roadmap: [] as RoadmapItem[], refreshedAt: null as string | null, relationships: undefined as BusinessRelationship[] | undefined, cached: {} as Record<string, unknown>, rerun: undefined as unknown as () => void }));
vi.mock('@/hooks/data', () => ({ useCompany: () => ({ data: { name: 'Acme' } }), useRerunDashboardTab: () => ({ mutate: state.rerun, isPending: false }), useDashboardTab: () => ({
  isPending: false, isError: false, data: { lastRefreshedAt: state.refreshedAt, content: { products: state.products, roadmap: state.roadmap, relationships: state.relationships } },
}) }));
vi.mock('../useCachedTab', () => ({ useCachedDashboardTab: (_id: string, tab: string) => ({ data: state.cached[tab] }) }));
vi.mock('@/components/media/AiCover', () => ({ AiCover: () => null }));
vi.mock('../useProductsReportData', () => ({ useProductsReportData: () => ({ briefs: new Map(), intel: [], canResearch: false, bulk: { run: vi.fn(), pending: false, progress: null, failed: 0, remaining: 0 } }) }));
vi.mock('./ProductPage', () => ({ ProductPage: ({ product }: { product: Product }) => <a href={product.url ?? undefined}>Official page</a> }));
vi.mock('@/features/deepdive/DeepDive', () => ({ DigDeeper: () => null, DigDeeperMenu: () => null }));
beforeEach(() => { state.rerun = vi.fn(); state.products = []; state.roadmap = []; state.refreshedAt = null; state.relationships = undefined; state.cached = {}; });

describe('product evidence wording in the existing view', () => {
  it('does not promise a revenue ranking or silently treat empty research as complete', () => {
    render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.getByText('No product lineup confirmed yet')).toBeInTheDocument();
    expect(screen.queryByText(/Ranked by reported revenue/)).not.toBeInTheDocument();
  });
  it('falls back to the sourced research brief and dated product milestones, never inventing a lineup', () => {
    state.cached = {
      overview: { content: { markdown: '## Products and services\nAcme sells the Atlas platform to retailers.\n[acme.com](https://acme.com/atlas)' } },
      history: { content: { timeline: [
        { date: '2024 Mar', title: 'Atlas launch', detail: 'Acme launches Atlas.' },
        { date: '2023 Jan', title: 'Series B', detail: 'Acme raises a round.' },
      ] } },
    };
    render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.getByText(/Acme sells the Atlas platform/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /acme\.com/ })).toHaveAttribute('href', 'https://acme.com/atlas');
    expect(screen.getByText('Atlas launch')).toBeInTheDocument();
    expect(screen.queryByText('Series B')).not.toBeInTheDocument();
  });
  it('says "revenue not established" once in the header, not on every product card, and still shows a reported revenue note', () => {
    state.products = [
      { name: 'Atlas', status: 'live', description: 'Company-reported: Atlas is now available.', revenueNote: '', url: 'https://acme.com/blog/atlas' },
      { name: 'Beacon', status: 'live', description: 'Company-reported: Beacon ships.', revenueNote: 'Reported as 12% of 2025 sales.', url: null },
    ];
    render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.getByText(/Revenue contribution is not established/)).toBeInTheDocument();
    expect(screen.queryByText('Revenue role not disclosed')).not.toBeInTheDocument();
    expect(screen.getByText('Reported as 12% of 2025 sales.')).toBeInTheDocument();
  });
  it('says a status shared by every product once in the header and keeps a differing one on its card', () => {
    const prod = (name: string, status: Product['status']): Product => ({ name, status, description: 'Company-reported: ' + name, revenueNote: '', url: null });
    expect(uniformProductStatus([prod('A', 'live'), prod('B', 'live')])).toBe('live');
    expect(uniformProductStatus([prod('A', 'live')])).toBeNull();
    expect(uniformProductStatus([prod('A', 'live'), prod('B', null)])).toBeNull();
    expect(uniformProductStatus([prod('A', 'live'), prod('B', 'beta')])).toBeNull();
    state.products = [prod('Atlas', 'live'), prod('Beacon', 'live')];
    const { unmount } = render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.getByText(/All 2 are live\./)).toBeInTheDocument();
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
    unmount();
    state.products = [prod('Atlas', 'live'), prod('Beacon', 'beta')];
    render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.queryByText(/All 2 are/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Live').length).toBeGreaterThan(0);
  });
  it('shows a search-reported claim itself, with one small marker instead of the long wrapper', () => {
    state.products = [{ name: 'T380AMR', status: null, revenueNote: '', url: null,
      description: 'Google Search reports (original page not retrieved): “Tennant operates the T380AMR, an autonomous robotic floor scrubber”' }];
    render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.getByText('Tennant operates the T380AMR, an autonomous robotic floor scrubber')).toBeInTheDocument();
    expect(screen.getByText(/Search-reported · original not retrieved/)).toBeInTheDocument();
    expect(screen.queryByText(/Google Search reports/)).not.toBeInTheDocument();
  });
  it('opens the fetched official source without calling an announcement the live product', async () => {
    state.products = [{ name: 'Atlas', status: 'live', description: 'Company-reported: Atlas is now available.', revenueNote: '', url: 'https://acme.com/blog/atlas' }];
    render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.getByText(/not a revenue ranking/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Atlas/ }));
    expect(await screen.findByRole('link', { name: 'Official page' })).toHaveAttribute('href', 'https://acme.com/blog/atlas');
  });
  it('product cards carry no generated illustration and no SOURCE label', () => {
    state.products = [{ name: 'Atlas', status: 'live', description: 'Atlas is available.', revenueNote: '', url: null }];
    const { container } = render(<ProductsRoadmapTab companyId="cmp" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText(/^source$/i)).not.toBeInTheDocument();
  });
  it('summarises what is established at the top, counted only from retained research', () => {
    state.products = [
      { name: 'Atlas', status: 'live', description: 'd', revenueNote: '', url: null },
      { name: 'Beacon', status: 'beta', description: 'd', revenueNote: '', url: null },
    ];
    state.roadmap = [{ title: 'Atlas 2', horizon: 'next', detail: 'x', date: null }];
    render(<ProductsRoadmapTab companyId="cmp" />);
    const glance = screen.getByRole('region', { name: 'Lineup at a glance' });
    expect(glance).toHaveTextContent('Products');
    expect(glance).toHaveTextContent('1 live · 1 beta');
    expect(glance).toHaveTextContent('0 now · 1 next · 0 later');
  });

  it('shows no summary when nothing is established', () => {
    render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.queryByRole('region', { name: 'Lineup at a glance' })).not.toBeInTheDocument();
  });

  it('offers to research the lineup from the empty state, only when the user asks', () => {
    render(<ProductsRoadmapTab companyId="cmp" />);
    expect(state.rerun).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Research products and roadmap now' }));
    expect(state.rerun).toHaveBeenCalledTimes(1);
  });

  it('says "Source not recorded" plainly only where some other product has a source', () => {
    state.products = [
      { name: 'Atlas', status: 'live', description: 'Atlas is available.', revenueNote: '', url: null },
      { name: 'Beacon', status: 'live', description: 'Beacon ships.', revenueNote: '', url: 'https://acme.com/beacon' },
    ];
    render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.getByText('Source not recorded')).toBeInTheDocument();
  });
  it('drops the repeated "Source not recorded" when no product has a source', () => {
    state.products = [{ name: 'Atlas', status: 'live', description: 'Atlas is available.', revenueNote: '', url: null }];
    render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.queryByText('Source not recorded')).not.toBeInTheDocument();
  });
  it('defaults to a dense table for 21 products and can switch to cards and back', () => {
    state.products = Array.from({ length: 21 }, (_, i) => ({
      name: `Prod ${i}`, status: 'live' as const, description: `Does thing ${i}.`, revenueNote: '', url: i % 2 ? `https://acme.com/p${i}` : null,
    }));
    render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(22);
    expect(screen.getAllByText('Source not recorded').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
  it('hides the status chips with one status and shows them with two', () => {
    const mk = (name: string, status: 'live' | 'beta') => ({ name, status, description: 'd', revenueNote: '', url: null });
    state.products = [mk('A', 'live'), mk('B', 'live'), mk('C', 'live'), mk('D', 'live')];
    const { unmount } = render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.queryByRole('group', { name: 'Filter by status' })).not.toBeInTheDocument();
    unmount();
    state.products = [mk('A', 'live'), mk('B', 'beta')];
    render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.getByRole('group', { name: 'Filter by status' })).toBeInTheDocument();
  });
  it('keeps cards by default for a short lineup', () => {
    state.products = [{ name: 'Atlas', status: 'live', description: 'x', revenueNote: '', url: null }];
    render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('stamps roadmap items with the research date, flags past-due targets, and never invents a date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
    state.refreshedAt = '2026-03-02T10:00:00Z';
    state.roadmap = [
      { title: 'Old promise', horizon: 'now', detail: 'd', date: 'Q1 2026' },
      { title: 'Future plan', horizon: 'next', detail: 'd', date: '2027 H1' },
      { title: 'Undated plan', horizon: 'later', detail: 'd', date: null },
    ];
    render(<ProductsRoadmapTab companyId="cmp" />);
    vi.useRealTimers();
    expect(screen.getAllByText(/^stated .*2026/)).toHaveLength(3);
    expect(screen.getAllByText('past due')).toHaveLength(1);
    expect(screen.queryByText('No date reported')).not.toBeInTheDocument();
  });
  it('groups the roadmap Now / Next / Later, each with its own list, and omits an empty horizon', () => {
    state.roadmap = [
      { title: 'A', horizon: 'now', detail: 'd', date: null },
      { title: 'B', horizon: 'next', detail: 'd', date: '2027-02-01', sourceUrl: 'https://acme.com/plans', sourceTitle: 'Plans' },
    ];
    state.products = [{ name: 'Atlas', status: 'live', description: 'd', revenueNote: '', url: null }, { name: 'Beacon', status: 'beta', description: 'd', revenueNote: '', url: null }];
    state.roadmap.push({ title: 'Beacon 2 ships', horizon: 'later', detail: 'Plan for Beacon.', date: null });
    render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.getByRole('list', { name: 'Now roadmap items' })).toHaveTextContent('A');
    expect(screen.getByRole('list', { name: 'Next roadmap items' })).toHaveTextContent('2027-02-01');
    expect(screen.getByRole('link', { name: /acme.com/ })).toHaveAttribute('href', 'https://acme.com/plans');
    // The item that names a product links to it; an undated one says so plainly.
    expect(screen.getByRole('button', { name: 'Product: Beacon' })).toBeInTheDocument();
    expect(screen.getAllByText('No date stated').length).toBe(2);
  });
  it('says plainly that no public roadmap was found and offers to look again', () => {
    render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.getByText('No public roadmap found')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Research now' }));
    expect(state.rerun).toHaveBeenCalledTimes(1);
  });
  it('stamps nothing when no capture date was recorded', () => {
    state.roadmap = [{ title: 'Plan', horizon: 'next', detail: 'd', date: '2030' }];
    render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.queryByText(/^stated /)).not.toBeInTheDocument();
  });
  it('reads only dates it is sure of', () => {
    const now = new Date('2026-10-21T12:00:00Z');
    expect(isPastDue('2026-03-15', now)).toBe(true);
    expect(isPastDue('March 2026', now)).toBe(true);
    expect(isPastDue('2026 H2', now)).toBe(false);
    expect(isPastDue('Q3 2026', now)).toBe(true);
    expect(isPastDue('soon', now)).toBe(false);
    expect(targetEnd('later this year')).toBeNull();
    expect(isPastDue(null, now)).toBe(false);
  });
  it('does not guess a month from a longer word or a date that rolls over', () => {
    expect(targetEnd('Marketing 2026')).toBeNull();
    expect(targetEnd('Mayhem 2026')).toBeNull();
    expect(targetEnd('2026-13-45')).toBeNull();
    expect(targetEnd('2026-02-31')).toBeNull();
    expect(targetEnd('Sept 2026')).not.toBeNull();
    expect(targetEnd('September 2026')).not.toBeNull();
  });
  it('lists named relationships by kind with their reported sentence and source, and shows nothing when none are reported', () => {
    const { unmount } = render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.queryByRole('region', { name: 'Customers, suppliers and partners' })).not.toBeInTheDocument();
    unmount();
    state.relationships = [{ name: 'Globex', kind: 'customer', quote: 'Globex is a customer of Acme.', sourceUrl: 'https://reuters.com/acme', sourceTitle: 'Reuters' }];
    render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.getByRole('region', { name: 'Customers, suppliers and partners' })).toBeInTheDocument();
    expect(screen.getByText('Globex')).toBeInTheDocument();
    expect(screen.getByText('“Globex is a customer of Acme.”')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reuters' })).toHaveAttribute('href', 'https://reuters.com/acme');
    expect(screen.queryByText('None reported.')).not.toBeInTheDocument();
  });
});
