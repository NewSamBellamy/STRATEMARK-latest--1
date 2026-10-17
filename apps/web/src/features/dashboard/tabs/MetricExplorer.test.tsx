import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { CompanyMetric, MetricType } from '@mi/contracts';
import { renderWithProviders } from '@/test/test-utils';
import { MetricExplorer, historyFor, type ExplorerRow, type ExplorerSeries } from './MetricExplorer';

function metric(type: MetricType, value: number | null, over: Partial<CompanyMetric> = {}): CompanyMetric {
  return {
    id: `m_${type}`, companyId: 'cmp_a', metricType: type, value, confidence: value == null ? 'unknown' : 'verified', source: 'https://www.reuters.com/a',
    citations: value == null ? [] : [{ title: 'Reuters', url: 'https://www.reuters.com/a' }], methodNote: null, capturedAt: '2026-10-01T00:00:00.000Z', ...over,
  } as CompanyMetric;
}

function row(m: CompanyMetric, peers: Array<{ id: string; name: string; value: number; self?: boolean }> = []): ExplorerRow {
  const points = peers.map((p) => ({ companyId: p.id, name: p.name, value: p.value, confidence: 'verified' as const, isSelf: Boolean(p.self) })).sort((a, b) => b.value - a.value);
  const rank = points.findIndex((p) => p.isSelf);
  return {
    metric: m,
    ranking: { metricType: m.metricType, points, rank: rank >= 0 ? rank + 1 : null, of: points.length, unknownPeers: 0, percentile: null, includesEstimates: false },
  };
}

const SERIES: ExplorerSeries = {
  revenue: [{ period: '2023', value: 2e9 }, { period: '2024', value: 3.4e9 }, { period: '2025', value: 5e9 }],
  revenueQuarterly: [{ period: 'Q1 2026', value: 1e9 }, { period: 'Q2 2026', value: 1.2e9 }],
  users: [],
};

function Harness({ rows, missing = [], series = null }: { rows: ExplorerRow[]; missing?: CompanyMetric[]; series?: ExplorerSeries | null }) {
  const [picked, setPicked] = useState<MetricType | null>(null);
  return <MetricExplorer rows={rows} missing={missing} selected={picked} onSelect={setPicked} series={series} />;
}

describe('reported history for a figure', () => {
  it('is only what was found: annual and quarterly for revenue, users for users, nothing for the rest', () => {
    expect(historyFor('arr', SERIES).map((h) => h.key)).toEqual(['annual', 'quarterly']);
    expect(historyFor('revenue', SERIES).map((h) => h.key)).toEqual(['annual', 'quarterly']);
    expect(historyFor('valuation', SERIES)).toEqual([]);
    expect(historyFor('users', SERIES)).toEqual([]);
    expect(historyFor('users', { ...SERIES, users: [{ period: 'a', value: 1 }, { period: 'b', value: 2 }] }).map((h) => h.key)).toEqual(['users']);
  });

  it('needs at least two real points: one point is not a history', () => {
    expect(historyFor('arr', { revenue: [{ period: '2025', value: 5 }], revenueQuarterly: [], users: [] })).toEqual([]);
    expect(historyFor('arr', null)).toEqual([]);
  });
});

describe('the metric explorer', () => {
  it('shows each major figure as a tile and changes the panel when another is picked', async () => {
    const rows = [
      row(metric('valuation', 852e9), [{ id: 'cmp_a', name: 'Acme', value: 852e9, self: true }, { id: 'cmp_b', name: 'Beta', value: 380e9 }]),
      row(metric('employees', 4500), [{ id: 'cmp_a', name: 'Acme', value: 4500, self: true }, { id: 'cmp_b', name: 'Beta', value: 900 }]),
    ];
    const { user } = renderWithProviders(<Harness rows={rows} />);
    const tabs = screen.getByRole('tablist', { name: 'Pick a metric' });
    expect(within(tabs).getAllByRole('tab')).toHaveLength(2);
    const panel = () => screen.getByRole('tabpanel');
    expect(panel()).toHaveAccessibleName('Valuation chart');
    expect(within(panel()).getByText('In this deck')).toBeInTheDocument();
    await user.click(within(tabs).getByRole('tab', { name: /Employees/ }));
    expect(panel()).toHaveAccessibleName('Employees chart');
    await waitFor(() => expect(within(panel()).getByTestId('explorer-value')).toHaveTextContent('4.5K'));
  });

  it('draws the reported history, with a choice of how, when there is one', async () => {
    const rows = [row(metric('arr', 5e9))];
    const { user } = renderWithProviders(<Harness rows={rows} series={SERIES} />);
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByRole('tab', { name: 'Annual revenue' })).toBeInTheDocument();
    expect(within(panel).getByRole('tab', { name: 'Quarterly revenue' })).toBeInTheDocument();
    await user.click(within(panel).getByRole('tab', { name: 'Quarterly revenue' }));
    expect(within(panel).getByText(/Q1 2026 to Q2 2026/)).toBeInTheDocument();
    expect(within(panel).getByRole('tab', { name: 'Line' })).toBeInTheDocument();
  });

  it('says so, and draws nothing, when there is one figure and nothing to compare it with', () => {
    renderWithProviders(<Harness rows={[row(metric('employees', 4500), [{ id: 'cmp_a', name: 'Acme', value: 4500, self: true }])]} />);
    expect(screen.getByText(/One sourced figure so far/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is drawn to fill the space/)).toBeInTheDocument();
    expect(screen.queryByText('In this deck')).not.toBeInTheDocument();
  });

  it('keeps a figure that was not found as a labelled gap, with what would fill it, never as a number', async () => {
    const { user } = renderWithProviders(<Harness rows={[row(metric('employees', 4500))]} missing={[metric('valuation', null)]} />);
    const tabs = screen.getByRole('tablist', { name: 'Pick a metric' });
    const gap = within(tabs).getByRole('tab', { name: /Valuation/ });
    expect(gap).toHaveTextContent('Not found yet');
    await user.click(gap);
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('Not found yet')).toBeInTheDocument();
    expect(within(panel).getByText(/What would fill this/)).toBeInTheDocument();
    expect(within(panel).queryByTestId('explorer-value')).not.toBeInTheDocument();
  });

  it('renders nothing when there is nothing at all', () => {
    const { container } = renderWithProviders(<Harness rows={[]} />);
    expect(container.querySelector('section')).toBeNull();
  });
});
