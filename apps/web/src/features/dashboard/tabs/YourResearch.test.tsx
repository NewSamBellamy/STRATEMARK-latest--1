import { describe, expect, it } from 'vitest';
import { useQueryClient } from '@tanstack/react-query';
import { screen, within } from '@testing-library/react';
import { digestNoteText, type ResearchEvidence } from '@mi/research';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { YourResearch } from './YourResearch';

const digest = {
  summary: 'Acme grew in Q3.',
  findings: [{ claim: 'Acme has 310 employees.', quote: 'The company employs 310 people across three offices.' }],
  figures: [],
};
const evidence = (id: string, companyId: string, text: string, at = '2026-10-20T10:00:00Z'): ResearchEvidence =>
  ({ id, companyId, companyName: 'Acme', topic: 'user_note', capturedAt: at, text, citations: [], queries: [] });

function render(rows: ResearchEvidence[] | null) {
  const repository = Object.assign(makeRepo(), rows ? { getResearchEvidence: () => rows } : {});
  return renderWithProviders(<YourResearch companyId="cmp_a" />, { repository });
}

describe('YourResearch', () => {
  it('shows a dropped-in document\'s summary and findings with their quotes, labelled as the user\'s own', () => {
    render([evidence('d1', 'cmp_a', digestNoteText('memo.pdf', digest))]);
    const section = screen.getByRole('region', { name: 'From your research' });
    expect(within(section).getByText('memo.pdf')).toBeInTheDocument();
    expect(within(section).getByText('Acme grew in Q3.')).toBeInTheDocument();
    expect(within(section).getByText(/The company employs 310 people/)).toBeInTheDocument();
    expect(section).toHaveTextContent('not independently verified');
  });

  it('shows nothing when no document was dropped in, or the engine keeps no evidence', () => {
    render([evidence('n1', 'cmp_a', 'Founder told us churn is 4% monthly.')]);
    expect(screen.queryByRole('region', { name: 'From your research' })).not.toBeInTheDocument();
  });

  it('shows what chat answers learned, each with its source, newest first and without repeats', () => {
    const learned = (id: string, text: string, at: string, url = 'https://www.reuters.com/acme-plant'): ResearchEvidence =>
      ({ id, companyId: 'cmp_a', companyName: 'Acme', topic: 'chat:thr_1', capturedAt: at, text, citations: [{ url, title: 'Reuters' }], queries: [] });
    render([
      learned('c1', 'Jane Doe joined Acme as CTO in 2019.', '2026-10-20T10:00:00Z'),
      learned('c2', 'Acme opened a plant in Austin.', '2026-10-21T10:00:00Z'),
      learned('c3', 'jane doe joined acme as cto in 2019.', '2026-10-22T10:00:00Z'),
    ]);
    const section = screen.getByRole('region', { name: 'Learned from your questions' });
    const items = within(section).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('jane doe joined acme as cto in 2019.');
    expect(items[1]).toContain('Acme opened a plant in Austin.');
    expect(within(section).getAllByRole('link', { name: 'Reuters' })[0]).toHaveAttribute('href', 'https://www.reuters.com/acme-plant');
    expect(screen.queryByRole('region', { name: 'From your research' })).not.toBeInTheDocument();
  });

  it('re-reads when the company\'s dashboard data is refreshed, so a new answer shows without a reload', async () => {
    const rows: ResearchEvidence[] = [];
    const repository = Object.assign(makeRepo(), { getResearchEvidence: () => rows });
    function Refresh() {
      const qc = useQueryClient();
      return <button type="button" onClick={() => void qc.invalidateQueries({ queryKey: ['dashboard', 'cmp_a'] })}>refresh</button>;
    }
    const { user } = renderWithProviders(<><YourResearch companyId="cmp_a" /><Refresh /></>, { repository });
    expect(screen.queryByRole('region', { name: 'Learned from your questions' })).not.toBeInTheDocument();
    rows.push({ id: 'c9', companyId: 'cmp_a', companyName: 'Acme', topic: 'chat:thr_2', capturedAt: '2026-10-22T10:00:00Z', text: 'Acme hired a new CFO.', citations: [{ url: 'https://www.ft.com/x', title: 'FT' }], queries: [] });
    await user.click(screen.getByRole('button', { name: 'refresh' }));
    expect(await screen.findByRole('region', { name: 'Learned from your questions' })).toHaveTextContent('Acme hired a new CFO.');
  });

  it('ignores another company\'s documents', () => {
    render([evidence('d2', 'cmp_b', digestNoteText('other.pdf', digest))]);
    expect(screen.queryByRole('region', { name: 'From your research' })).not.toBeInTheDocument();
  });

  it('is silent on an engine with no evidence reader', () => {
    render(null);
    expect(screen.queryByRole('region', { name: 'From your research' })).not.toBeInTheDocument();
  });
});
