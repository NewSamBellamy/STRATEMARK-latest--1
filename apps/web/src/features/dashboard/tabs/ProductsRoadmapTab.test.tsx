import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BusinessRelationship, Product } from '@mi/contracts';
import { ProductsRoadmapTab } from './ProductsRoadmapTab';

const state = vi.hoisted(() => ({ products: [] as Product[], relationships: undefined as BusinessRelationship[] | undefined, cached: {} as Record<string, unknown> }));
vi.mock('@/hooks/data', () => ({ useCompany: () => ({ data: { name: 'Acme' } }), useDashboardTab: () => ({
  isPending: false, isError: false, data: { content: { products: state.products, roadmap: [], relationships: state.relationships } },
}) }));
vi.mock('../useCachedTab', () => ({ useCachedDashboardTab: (_id: string, tab: string) => ({ data: state.cached[tab] }) }));
vi.mock('@/components/media/AiCover', () => ({ AiCover: () => null }));
vi.mock('./ProductPage', () => ({ ProductPage: ({ product }: { product: Product }) => <a href={product.url ?? undefined}>Official page</a> }));
vi.mock('@/features/deepdive/DeepDive', () => ({ DigDeeper: () => null, DigDeeperMenu: () => null }));
beforeEach(() => { state.products = []; state.relationships = undefined; state.cached = {}; });

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
  it('product cards carry no illustration hero and no SOURCE label', () => {
    state.products = [{ name: 'Atlas', status: 'live', description: 'Atlas is available.', revenueNote: '', url: null }];
    const { container } = render(<ProductsRoadmapTab companyId="cmp" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText(/^source$/i)).not.toBeInTheDocument();
  });
  it('says "Source not recorded" plainly when a product has no url', () => {
    state.products = [{ name: 'Atlas', status: 'live', description: 'Atlas is available.', revenueNote: '', url: null }];
    render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.getByText('Source not recorded')).toBeInTheDocument();
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
    expect(screen.getAllByText('None reported.')).toHaveLength(2);
  });
});
