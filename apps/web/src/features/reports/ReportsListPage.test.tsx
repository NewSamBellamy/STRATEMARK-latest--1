import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { Market, Report } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import ReportsListPage from './ReportsListPage';

const report = (over: Partial<Report>): Report => ({
  id: 'rep_1', kind: 'company', subjectId: 'cmp_1', title: 'Acme: company report', markdown: '## Summary',
  citations: [{ title: 'Filing', url: 'https://example.com/filing' }], createdAt: '2026-10-01T09:00:00.000Z', ...over,
});

describe('the Reports page', () => {
  it('lists each report with what it is, when it was made and how many sources it has, as links', async () => {
    const repository = makeRepo();
    vi.spyOn(repository, 'listReports').mockResolvedValue([
      report({}),
      report({ id: 'rep_2', kind: 'deck', title: 'Solar: market report', citations: [] }),
    ]);
    renderWithProviders(<ReportsListPage />, { repository });
    const list = await screen.findByRole('list', { name: 'Your reports' });
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Acme: company report/ })).toHaveAttribute('href', '/reports/rep_1');
    expect(screen.getByText('Company report')).toBeInTheDocument();
    expect(screen.getByText('Market report')).toBeInTheDocument();
    expect(screen.getByText(/1 source$/)).toBeInTheDocument();
    expect(screen.getByText(/research plan$/)).toBeInTheDocument();
  });

  it('no longer offers to audit a website here', async () => {
    const repository = makeRepo();
    vi.spyOn(repository, 'listReports').mockResolvedValue([report({})]);
    renderWithProviders(<ReportsListPage />, { repository });
    await screen.findByRole('list', { name: 'Your reports' });
    expect(screen.queryByText(/audit a website/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /run the audit/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/competitor/i)).not.toBeInTheDocument();
  });

  const mkt = (id: string, name: string, createdAt: string) =>
    ({ id, name, scopeDefinition: { vertical: 'v', geography: null, notes: null }, refreshCadence: 'manual', createdAt }) as unknown as Market;

  it('offers Create a report that opens the most recent deck', async () => {
    const repository = makeRepo();
    vi.spyOn(repository, 'listReports').mockResolvedValue([]);
    vi.spyOn(repository, 'listMarkets').mockResolvedValue([
      mkt('old', 'Old deck', '2026-01-01T00:00:00Z'),
      mkt('new', 'New deck', '2026-05-01T00:00:00Z'),
    ]);
    renderWithProviders(<ReportsListPage />, { repository });
    const link = await screen.findByRole('link', { name: 'Create a report' });
    expect(link).toHaveAttribute('href', '/markets/new/deck');
    expect(link).toHaveAttribute('title', expect.stringMatching(/Opens New deck/));
  });

  it('with no decks, sends Create a report to All Decks with a hint', async () => {
    const repository = makeRepo();
    vi.spyOn(repository, 'listReports').mockResolvedValue([]);
    vi.spyOn(repository, 'listMarkets').mockResolvedValue([]);
    renderWithProviders(<ReportsListPage />, { repository });
    const link = await screen.findByRole('link', { name: 'Create a report' });
    expect(link).toHaveAttribute('href', '/history');
    expect(link).toHaveAttribute('title', expect.stringMatching(/You need a deck first/));
  });

  it('says plainly when there are no reports yet', async () => {
    const repository = makeRepo();
    vi.spyOn(repository, 'listReports').mockResolvedValue([]);
    renderWithProviders(<ReportsListPage />, { repository });
    expect(await screen.findByText('No reports yet')).toBeInTheDocument();
  });
});
