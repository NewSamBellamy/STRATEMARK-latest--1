import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { DashboardSources } from './DashboardSources';

function show(citations?: Array<{ title: string; url: string }>, sourceDiagnostics?: {
  reads: Array<{ host: string; outcome: 'retrieved' | 'blocked' | 'unavailable'; httpStatus?: number }>;
  eligibleSourceCount: number;
  acceptedExcerptCount: number;
}) {
  const getDashboardTab = vi.fn().mockResolvedValue({ companyId: 'cmp', tab: 'overview', content: { markdown: 'Notes' },
    lastRefreshedAt: '2026-10-01T00:00:00.000Z', ...(citations ? { citations } : {}), ...(sourceDiagnostics ? { sourceDiagnostics } : {}) });
  const rendered = renderWithProviders(<DashboardSources companyId="cmp" tab="overview" />, {
    repository: Object.assign(makeRepo(), { getDashboardTab }),
  });
  return { ...rendered, getDashboardTab };
}

describe('dashboard research source disclosure', () => {
  it('shows real sources inline without calling research again or claiming verified prose', async () => {
    const { getDashboardTab } = show([{ title: 'Annual report', url: 'https://example.com/report' }]);
    expect(await screen.findByText('Research sources · 1')).toBeInTheDocument();
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
    expect(screen.getByText(/Some publisher pages can’t be read directly from this device/)).toBeInTheDocument();
    expect(getDashboardTab).toHaveBeenCalledTimes(1);
  });
  it('explains failed original reads separately from citation links', async () => {
    const { user } = show(undefined, { reads: [
      { host: 'example.com', outcome: 'blocked', httpStatus: 403 },
      { host: 'archive.example', outcome: 'unavailable' },
    ], eligibleSourceCount: 0, acceptedExcerptCount: 0 });
    expect(await screen.findByText(/No original page text was retained \(1 blocked, 1 unavailable\)/)).toBeInTheDocument();
    expect(screen.getByText(/does not by itself mean the publisher refused access/)).toBeInTheDocument();
    const checks = screen.getByText('Original source checks · 2');
    await user.click(checks);
    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.getByText('example.com').closest('li')).toHaveTextContent('blocked · HTTP 403');
    expect(screen.getByText('archive.example').closest('li')).toHaveTextContent('unavailable · no HTTP response recorded');
    expect(screen.queryByRole('link', { name: /example\.com/ })).not.toBeInTheDocument();
  });
  it('distinguishes retrieved pages from a quote accepted by the overview evidence checks', async () => {
    show(undefined, { reads: [{ host: 'example.com', outcome: 'retrieved', httpStatus: 200 }], eligibleSourceCount: 1, acceptedExcerptCount: 0 });
    expect(await screen.findByText('Readable originals were found, but no excerpt passed the overview checks.')).toBeInTheDocument();
  });
  it('keeps imported malformed source metadata from crashing the company dashboard', async () => {
    show([null, { title: 'Broken', url: 42 }, { title: 42, url: 'https://example.com/report' }] as unknown as Array<{ title: string; url: string }>);
    expect(await screen.findByText('Research sources · 1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'example.com' })).toBeInTheDocument();
  });
});
