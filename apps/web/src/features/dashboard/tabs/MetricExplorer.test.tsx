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

function Harness({ rows, missing = [] }: { rows: ExplorerRow[]; missing?: CompanyMetric[] }) {
  const [picked, setPicked] = useState<MetricType | null>(null);
  const current = rows.find((r) => r.metric.metricType === picked)?.metric ?? missing.find((m) => m.metricType === picked) ?? rows[0]?.metric ?? missing[0];
  return (
    <MetricExplorer rows={rows} missing={missing} selected={picked} onSelect={setPicked}>
      {current && <Detail metric={current} />}
    </MetricExplorer>
  );
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

/** A stand-in for the one detail panel the Metrics tab passes in. */
function Detail({ metric: m }: { metric: CompanyMetric }) {
  return <p data-testid="detail">{`detail for ${m.metricType}`}</p>;
}

describe('the metric explorer', () => {
  it('shows each major figure as a tile and changes the one panel when another is picked', async () => {
    const rows = [
      row(metric('valuation', 852e9), [{ id: 'cmp_a', name: 'Acme', value: 852e9, self: true }, { id: 'cmp_b', name: 'Beta', value: 380e9 }]),
      row(metric('employees', 4500), [{ id: 'cmp_a', name: 'Acme', value: 4500, self: true }, { id: 'cmp_b', name: 'Beta', value: 900 }]),
    ];
    const { user } = renderWithProviders(<Harness rows={rows} />);
    const tabs = screen.getByRole('tablist', { name: 'Pick a metric' });
    expect(within(tabs).getAllByRole('tab')).toHaveLength(2);
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Valuation detail');
    expect(screen.getByTestId('detail')).toHaveTextContent('detail for valuation');
    await user.click(within(tabs).getByRole('tab', { name: /Employees/ }));
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Employees detail');
    await waitFor(() => expect(screen.getByTestId('detail')).toHaveTextContent('detail for employees'));
  });

  it('draws no chart of its own: the deck ranking and history belong to the detail panel', () => {
    const rows = [row(metric('employees', 4500), [{ id: 'cmp_a', name: 'Acme', value: 4500, self: true }, { id: 'cmp_b', name: 'Beta', value: 900 }])];
    const { container } = renderWithProviders(<Harness rows={rows} />);
    expect(screen.queryByText('In this deck')).not.toBeInTheDocument();
    expect(container.querySelector('.recharts-wrapper')).toBeNull();
  });

  it('keeps a figure that was not found as a tab saying so, never as a number', async () => {
    const { user } = renderWithProviders(<Harness rows={[row(metric('employees', 4500))]} missing={[metric('valuation', null)]} />);
    const tabs = screen.getByRole('tablist', { name: 'Pick a metric' });
    const gap = within(tabs).getByRole('tab', { name: /Valuation/ });
    expect(gap).toHaveTextContent('Not found yet');
    await user.click(gap);
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Valuation detail');
    expect(screen.getByTestId('detail')).toHaveTextContent('detail for valuation');
  });

  it('renders nothing when there is nothing at all', () => {
    const { container } = renderWithProviders(<Harness rows={[]} />);
    expect(container.querySelector('section')).toBeNull();
  });
});
