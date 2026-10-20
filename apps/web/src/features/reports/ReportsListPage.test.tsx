import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { Report } from '@mi/contracts';
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

  it('says plainly when there are no reports yet', async () => {
    const repository = makeRepo();
    vi.spyOn(repository, 'listReports').mockResolvedValue([]);
    renderWithProviders(<ReportsListPage />, { repository });
    expect(await screen.findByText('No reports yet')).toBeInTheDocument();
  });
});
