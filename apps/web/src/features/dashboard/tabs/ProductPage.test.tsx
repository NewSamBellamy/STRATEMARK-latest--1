import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { Product, ProductBrief } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { ProductPage } from './ProductPage';

vi.mock('@/components/media/AiCover', () => ({ AiCover: () => <div data-testid="cover" /> }));

const product: Product = { name: 'Astra', description: 'A planner for teams.', revenueNote: '', url: null, status: 'live' };
const company = { name: 'Acme', logoUrl: null, websiteUrl: null };
const brief: ProductBrief = {
  companyId: 'cmp', productName: 'Astra', generatedAt: '2026-10-17T00:00:00.000Z', overview: 'Astra schedules work across teams.',
  metrics: [{ label: 'Users', value: '10M', asOf: '2026', sourceUrl: 'https://data.example/u', sourceTitle: 'Data' }],
  sentiment: { summary: 'Mostly liked.', positive: ['Speed'], negative: ['Price'], sources: [{ title: 'Review', url: 'https://review.example/a' }] },
  timeline: [{ date: 'Nov 2022', title: 'Launch', detail: 'Public beta.', sourceUrl: 'https://news.example/l' }],
  citations: [],
};

describe('ProductPage', () => {
  it('opens from stored research alone: marks the unreported, offers research, spends nothing', async () => {
    const researchProductBrief = vi.fn();
    const repo = Object.assign(makeRepo(), { peekProductBrief: vi.fn().mockResolvedValue(null), researchProductBrief });
    renderWithProviders(<ProductPage product={product} companyId="cmp" company={company} roadmap={[]} onClose={vi.fn()} />, { repository: repo });
    expect(await screen.findByText('A planner for teams.')).toBeInTheDocument();
    expect(screen.getAllByText('Not reported').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Research this product/ })).toBeInTheDocument();
    expect(screen.getByText(/No reception research/)).toBeInTheDocument();
    expect(researchProductBrief).not.toHaveBeenCalled();
  });

  it('researches on request and shows sourced metrics, reception and the timeline', async () => {
    const researchProductBrief = vi.fn().mockResolvedValue(brief);
    const repo = Object.assign(makeRepo(), { peekProductBrief: vi.fn().mockResolvedValue(null), researchProductBrief });
    const { user } = renderWithProviders(<ProductPage product={product} companyId="cmp" company={company} roadmap={[]} onClose={vi.fn()} />, { repository: repo });
    await user.click(await screen.findByRole('button', { name: /Research this product/ }));
    await waitFor(() => expect(screen.getByText('10M')).toBeInTheDocument());
    expect(researchProductBrief).toHaveBeenCalledWith({ companyId: 'cmp', productName: 'Astra', force: false });
    expect(screen.getByText('Mostly liked.')).toBeInTheDocument();
    expect(screen.getByText('Launch')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Research again/ })).toBeInTheDocument();
  });

  it('links only web addresses from researched sources, the timeline and the product page', async () => {
    const hostile: ProductBrief = {
      ...brief,
      sentiment: { summary: 'Mostly liked.', positive: [], negative: [], sources: [{ title: 'Review', url: 'javascript:alert(1)' }, { title: 'Wire', url: 'https://wire.example/a' }] },
      timeline: [{ date: 'Nov 2022', title: 'Launch', detail: '', sourceUrl: 'javascript:alert(2)' }],
    };
    const repo = Object.assign(makeRepo(), { peekProductBrief: vi.fn().mockResolvedValue(hostile), researchProductBrief: vi.fn() });
    renderWithProviders(
      <ProductPage product={{ ...product, url: 'javascript:alert(3)' }} companyId="cmp" company={company} roadmap={[]} onClose={vi.fn()} />,
      { repository: repo },
    );
    expect(await screen.findByText('Launch')).toBeInTheDocument();
    const hrefs = Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.filter((href) => !/^https?:\/\//.test(href)), JSON.stringify(hrefs)).toEqual([]);
    // The source can appear in the reception list and in the page's source list; every copy is the safe address.
    const wire = screen.getAllByRole('link', { name: 'Wire' });
    expect(wire.length).toBeGreaterThan(0);
    for (const link of wire) expect(link).toHaveAttribute('href', 'https://wire.example/a');
    expect(screen.queryByRole('link', { name: /Official page/ })).not.toBeInTheDocument();
  });

  it('hides the research button when the engine cannot research', async () => {
    renderWithProviders(<ProductPage product={product} companyId="cmp" company={company} roadmap={[]} onClose={vi.fn()} />, { repository: makeRepo() });
    expect(await screen.findByText('A planner for teams.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Research this product/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download report/ })).toBeInTheDocument();
  });
});
