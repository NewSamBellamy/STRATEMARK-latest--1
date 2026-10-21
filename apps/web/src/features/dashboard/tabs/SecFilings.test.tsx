import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { CompanyFiling } from '@mi/research';
import { renderWithProviders } from '@/test/test-utils';
import { SecFilings } from './SecFilings';

const state = vi.hoisted(() => ({ filings: null as CompanyFiling[] | null }));
vi.mock('@/lib/ownership/secMajorShareholders', () => ({ lookupCompanyFilings: async () => state.filings }));

describe('recent SEC filings on Live Intel', () => {
  it('lists each filing with its plain-language name, filed events, and a link to the document', async () => {
    state.filings = [
      { form: '8-K', filingDate: '2026-08-17', reportDate: '2026-08-17', title: 'Current report',
        events: ['Material agreement', 'New debt or obligation'], url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000180/nvda-20260817.htm' },
      { form: '10-Q', filingDate: '2026-08-26', reportDate: '2026-07-26', title: 'Quarterly report', events: [],
        url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000190/nvda-20260726.htm' },
    ];
    renderWithProviders(<SecFilings companyName="NVIDIA" />);
    expect(await screen.findByText('Filed with the SEC')).toBeInTheDocument();
    expect(screen.getByText('Material agreement · New debt or obligation')).toBeInTheDocument();
    expect(screen.getByText('10-Q · period 2026-07-26')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Quarterly report/ })).toHaveAttribute('href', state.filings[1]!.url);
  });

  it('does not link a filing whose address is not a web page', async () => {
    state.filings = [
      { form: '8-K', filingDate: '2026-08-17', reportDate: '2026-08-17', title: 'Current report', events: [], url: 'javascript:alert(1)' },
    ];
    renderWithProviders(<SecFilings companyName="NVIDIA" />);
    expect(await screen.findByText('Current report')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows nothing for a company with no SEC filings', async () => {
    state.filings = null;
    const { container } = renderWithProviders(<SecFilings companyName="Anthropic" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
