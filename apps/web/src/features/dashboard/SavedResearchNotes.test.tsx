import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SavedResearchNotes } from './SavedResearchNotes';
const read = vi.fn();
vi.mock('@/lib/repository/RepositoryProvider', () => ({ useRepository: () => ({ getResearchEvidence: read }) }));
describe('saved research notes disclosure', () => {
  beforeEach(() => read.mockReset());
  it('reads only the selected company on open without buying new research', async () => {
    read.mockReturnValue([{ id: 'e1', companyId: 'c1', topic: 'company_profile', capturedAt: '2026-10-06T00:00:00Z', text: 'Actual saved company notes', citations: [], queries: [], grounding: { supports: [] } }]);
    render(<SavedResearchNotes companyId="c1" />);
    expect(read).not.toHaveBeenCalled();
    const summary = screen.getByText('Saved research notes');
    summary.parentElement!.setAttribute('open', '');
    fireEvent(summary.parentElement!, new Event('toggle'));
    expect(await screen.findByText('Actual saved company notes')).toBeInTheDocument();
    expect(read).toHaveBeenCalledWith({ companyId: 'c1', limit: 10 });
    expect(screen.getByText('company profile · collected 2026-10-06')).toBeInTheDocument();
  });
  it('does not retain another company’s notes after navigation', () => {
    read.mockReturnValue([{ id: 'e1', companyId: 'c1', topic: 'company_profile', capturedAt: '2026-10-06T00:00:00Z', text: 'Company one only', citations: [], queries: [] }]);
    const view = render(<SavedResearchNotes companyId="c1" />);
    const details = screen.getByText('Saved research notes').parentElement!;
    details.setAttribute('open', ''); fireEvent(details, new Event('toggle'));
    expect(screen.getByText('Company one only')).toBeInTheDocument();
    view.rerender(<SavedResearchNotes companyId="c2" />);
    expect(screen.queryByText('Company one only')).not.toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(1);
  });
});
