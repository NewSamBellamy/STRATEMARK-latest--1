import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { DashboardSources } from './DashboardSources';

function show(citations?: Array<{ title: string; url: string }>) {
  const getDashboardTab = vi.fn().mockResolvedValue({ companyId: 'cmp', tab: 'overview', content: { markdown: 'Notes' },
    lastRefreshedAt: '2026-10-01T00:00:00.000Z', ...(citations ? { citations } : {}) });
  const rendered = renderWithProviders(<DashboardSources companyId="cmp" tab="overview" />, {
    repository: Object.assign(makeRepo(), { getDashboardTab }),
  });
  return { ...rendered, getDashboardTab };
}

describe('dashboard research source disclosure', () => {
  it('reveals real sources on demand without calling research again or claiming verified prose', async () => {
    const { user, getDashboardTab } = show([{ title: 'Annual report', url: 'https://example.com/report' }]);
    const toggle = await screen.findByText('Research sources · 1');
    expect(toggle.closest('details')).not.toHaveAttribute('open');
    await user.click(toggle);
    expect(toggle.closest('details')).toHaveAttribute('open');
    expect(screen.getByRole('link', { name: 'Annual report' })).toHaveAttribute('href', 'https://example.com/report');
    expect(screen.getByText(/not independent verification of every claim/)).toBeInTheDocument();
    expect(screen.getByText(/Research collected/)).toBeInTheDocument();
    expect(getDashboardTab).toHaveBeenCalledTimes(1);
  });
  it('deduplicates unsafe/imported source links before displaying counts', async () => {
    show([{ title: 'Good', url: 'https://example.com' }, { title: 'Duplicate', url: 'https://example.com' },
      { title: 'Script', url: 'javascript:alert(1)' }, { title: 'Credentials', url: 'https://user:secret@example.com' }]);
    await screen.findByText('Research sources · 1');
    expect(screen.queryByRole('link', { name: 'Script' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Credentials' })).not.toBeInTheDocument();
  });
  it('labels a legacy section as unattributed without auto-spending to replace it', async () => {
    const { getDashboardTab } = show();
    expect(await screen.findByText(/No research sources were retained for this section/)).toBeInTheDocument();
    expect(getDashboardTab).toHaveBeenCalledTimes(1);
  });
  it('keeps imported malformed source metadata from crashing the company dashboard', async () => {
    show([null, { title: 'Broken', url: 42 }, { title: 42, url: 'https://example.com/report' }] as unknown as Array<{ title: string; url: string }>);
    expect(await screen.findByText('Research sources · 1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'example.com' })).toBeInTheDocument();
  });
});
