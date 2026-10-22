import { describe, expect, it } from 'vitest';
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

  it('ignores another company\'s documents', () => {
    render([evidence('d2', 'cmp_b', digestNoteText('other.pdf', digest))]);
    expect(screen.queryByRole('region', { name: 'From your research' })).not.toBeInTheDocument();
  });

  it('is silent on an engine with no evidence reader', () => {
    render(null);
    expect(screen.queryByRole('region', { name: 'From your research' })).not.toBeInTheDocument();
  });
});
