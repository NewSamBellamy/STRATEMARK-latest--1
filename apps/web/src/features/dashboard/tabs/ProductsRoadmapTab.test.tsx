import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Product } from '@mi/contracts';
import { ProductsRoadmapTab } from './ProductsRoadmapTab';

const state = vi.hoisted(() => ({ products: [] as Product[] }));
vi.mock('@/hooks/data', () => ({ useCompany: () => ({ data: { name: 'Acme' } }), useDashboardTab: () => ({
  isPending: false, isError: false, data: { content: { products: state.products, roadmap: [] } },
}) }));
vi.mock('@/components/media/AiCover', () => ({ AiCover: () => null }));
vi.mock('@/features/deepdive/DeepDive', () => ({ DigDeeper: () => null, DigDeeperMenu: () => null }));
beforeEach(() => { state.products = []; });

describe('product evidence wording in the existing view', () => {
  it('does not promise a revenue ranking or silently treat empty research as complete', () => {
    render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.getByText(/No original-backed product details/)).toBeInTheDocument();
    expect(screen.queryByText(/Ranked by reported revenue/)).not.toBeInTheDocument();
  });
  it('opens the fetched official source without calling an announcement the live product', async () => {
    state.products = [{ name: 'Atlas', status: 'live', description: 'Company-reported: Atlas is now available.', revenueNote: '', url: 'https://acme.com/blog/atlas' }];
    render(<ProductsRoadmapTab companyId="cmp" />);
    expect(screen.getByText(/not a revenue ranking/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Atlas/ }));
    expect(await screen.findByRole('link', { name: 'Open official source' })).toHaveAttribute('href', 'https://acme.com/blog/atlas');
  });
});
