import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Product } from '@mi/contracts';
import { ProductsRoadmapTab } from './ProductsRoadmapTab';

const state = vi.hoisted(() => ({ products: [] as Product[], cached: {} as Record<string, unknown> }));
vi.mock('@/hooks/data', () => ({ useCompany: () => ({ data: { name: 'Acme' } }), useDashboardTab: () => ({
  isPending: false, isError: false, data: { content: { products: state.products, roadmap: [] } },
}) }));
vi.mock('../useCachedTab', () => ({ useCachedDashboardTab: (_id: string, tab: string) => ({ data: state.cached[tab] }) }));
vi.mock('@/components/media/AiCover', () => ({ AiCover: () => null }));
vi.mock('@/features/deepdive/DeepDive', () => ({ DigDeeper: () => null, DigDeeperMenu: () => null }));
beforeEach(() => { state.products = []; state.cached = {}; });

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
  it('opens the fetched official source without calling an announcement the live product', async () => {
    state.products = [{ name: 'Atlas', status: 'live', description: 'Company-reported: Atlas is now available.', revenueNote: '', url: 'https://acme.com/blog/atlas' }];
    render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.getByText(/not a revenue ranking/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Atlas/ }));
    expect(await screen.findByRole('link', { name: 'Open official source' })).toHaveAttribute('href', 'https://acme.com/blog/atlas');
  });
});
