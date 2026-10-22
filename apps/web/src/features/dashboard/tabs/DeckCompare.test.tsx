import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { CompanyMetric, MetricType } from '@mi/contracts';
import { renderWithProviders } from '@/test/test-utils';
import type { PeerEntry } from '../dashboardModel';
import { DeckCompare } from './DeckCompare';

function metric(companyId: string, type: MetricType, value: number | null): CompanyMetric {
  return {
    id: `m_${companyId}_${type}`, companyId, metricType: type, value, confidence: value == null ? 'unknown' : 'verified',
    source: 'https://www.reuters.com/a', citations: value == null ? [] : [{ title: 'Reuters', url: 'https://www.reuters.com/a' }],
    methodNote: null, capturedAt: '2026-10-01T00:00:00.000Z',
  } as CompanyMetric;
}
const PEERS: PeerEntry[] = [
  { companyId: 'a', name: 'Acme', metrics: [metric('a', 'valuation', 50e9), metric('a', 'employees', 100)] },
  { companyId: 'b', name: 'Beta', metrics: [metric('b', 'valuation', 80e9), metric('b', 'employees', 900)] },
  { companyId: 'c', name: 'Gamma', metrics: [metric('c', 'valuation', null), metric('c', 'employees', 300)] },
];
const href = (id: string) => `/company/${id}`;

function view(type: MetricType, status: 'ready' | 'no_deck' = 'ready') {
  return (
    <DeckCompare type={type} selfId="a" selfName="Acme" peerStatus={status} peers={status === 'ready' ? PEERS : []}
      hrefFor={href} figureTypes={['valuation', 'employees']} />
  );
}

function Switcher() {
  const [type, setType] = useState<MetricType>('valuation');
  return <>{view(type)}<button type="button" onClick={() => setType('employees')}>switch</button></>;
}

describe('DeckCompare', () => {
  it('ranks this company and names companies without a figure as not charted', () => {
    renderWithProviders(view('valuation'));
    expect(screen.getByText('#2')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: /Valuation by company/ });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).queryByText('Gamma')).not.toBeInTheDocument();
    expect(screen.getByText(/Not charted, no sourced figure/).parentElement).toHaveTextContent('Gamma');
  });

  it('keeps each company row when the figure changes, so it can slide to its new place', async () => {
    const { user } = renderWithProviders(<Switcher />);
    const rows = () => within(screen.getByRole('list', { name: /by company/ })).getAllByRole('listitem');
    const acmeBefore = rows().find((li) => li.textContent?.includes('Acme'))!;
    await user.click(screen.getByRole('button', { name: 'switch' }));
    const acmeAfter = rows().find((li) => li.textContent?.includes('Acme'))!;
    expect(acmeAfter).toBe(acmeBefore);
    expect(acmeAfter.style.transform).toBe('translateY(68px)');
    expect(rows()).toHaveLength(3);
  });

  it('gives each bar its value and source for screen readers and links peers to their metrics', () => {
    renderWithProviders(view('valuation'));
    const link = screen.getByRole('link', { name: /Beta/ });
    expect(link).toHaveAttribute('href', '/company/b');
    expect(link).toHaveTextContent(/source .*reuters/i);
  });

  it('offers the two-figure view and plots only companies with both figures', async () => {
    const { user } = renderWithProviders(view('valuation'));
    await user.click(screen.getByRole('button', { name: 'Two figures' }));
    expect(screen.getAllByRole('img', { name: /^(Acme|Beta|Gamma):/ })).toHaveLength(2);
    expect(screen.getByText(/Not plotted:/).parentElement).toHaveTextContent('Gamma');
  });

  it('asks for the deck when opened outside one', () => {
    renderWithProviders(view('valuation', 'no_deck'));
    expect(screen.getByText(/Open this company from its deck/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
