import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { ResearchDocumentResult } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { DropInResearch } from './DropInResearch';

const RESULT: ResearchDocumentResult = {
  evidenceId: 'ev_1', title: 'Pasted notes', summary: 'Acme grew in Q3.', truncated: false, digestFailed: false,
  findings: [{ claim: 'Acme has 310 employees.', quote: 'The company employs 310 people across three offices.' }],
  figures: [{ metricType: 'employees', value: 310, label: 'Headcount', quote: 'The company employs 310 people across three offices.' }],
};
const NOTES = 'Acme Robotics Q3 memo. The company employs 310 people across three offices. Dallas plant doubles capacity.';

function setup(withDocuments = true) {
  const addResearchDocument = vi.fn(async () => RESULT);
  const overrideMetric = vi.fn(async (input: { companyId: string; metricType: string }) => ({ id: 'm', companyId: input.companyId, metricType: input.metricType }));
  const repository = Object.assign(makeRepo(), { overrideMetric, ...(withDocuments ? { addResearchDocument } : {}) });
  const view = renderWithProviders(<DropInResearch companyId="cmp_a" companyName="Acme" />, { repository });
  return { ...view, addResearchDocument, overrideMetric };
}

describe('DropInResearch', () => {
  it('offers nothing when the engine cannot take documents', () => {
    setup(false);
    expect(screen.queryByRole('region', { name: 'Drop in research' })).not.toBeInTheDocument();
  });

  it('takes pasted text, shows what it found with the quotes, and keeps the document labelled as the user\'s', async () => {
    const { user, addResearchDocument } = setup();
    await user.click(screen.getByRole('button', { name: /Drop in your research/ }));
    await user.type(screen.getByRole('textbox', { name: 'Paste research text' }), NOTES);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    const result = await screen.findByTestId('drop-in-result');
    expect(addResearchDocument).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'cmp_a', companyName: 'Acme', kind: 'text', title: 'Pasted notes' }));
    expect(within(result).getByText('Acme grew in Q3.')).toBeInTheDocument();
    expect(within(result).getAllByText(/The company employs 310 people/).length).toBeGreaterThan(0);
  });

  it('applies a figure only when the person asks, with the quote as its source', async () => {
    const { user, overrideMetric } = setup();
    await user.click(screen.getByRole('button', { name: /Drop in your research/ }));
    await user.type(screen.getByRole('textbox', { name: 'Paste research text' }), NOTES);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByTestId('drop-in-result');
    expect(overrideMetric).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Apply to card' }));
    await waitFor(() => expect(overrideMetric).toHaveBeenCalledTimes(1));
    expect(overrideMetric.mock.calls[0]![0]).toMatchObject({ companyId: 'cmp_a', metricType: 'employees', value: 310 });
    expect((overrideMetric.mock.calls[0]![0] as unknown as { note: string }).note).toContain('The company employs 310 people');
    expect(await screen.findByText('Applied')).toBeInTheDocument();
  });

  it('says why a link cannot be read instead of failing silently', async () => {
    const { user, addResearchDocument } = setup();
    await user.click(screen.getByRole('button', { name: /Drop in your research/ }));
    await user.type(screen.getByRole('textbox', { name: 'Link to read' }), 'https://www.youtube.com/watch?v=abc{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(/transcript/);
    expect(addResearchDocument).not.toHaveBeenCalled();
  });

  it('shows the engine\'s own message when it refuses a document', async () => {
    const { user, addResearchDocument } = setup();
    addResearchDocument.mockRejectedValueOnce(new Error('That document has too little text to read.'));
    await user.click(screen.getByRole('button', { name: /Drop in your research/ }));
    await user.type(screen.getByRole('textbox', { name: 'Paste research text' }), NOTES);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('too little text');
  });
});
