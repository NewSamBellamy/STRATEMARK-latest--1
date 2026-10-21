import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { OrgNode } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { PersonProfile } from './PersonProfile';

vi.mock('./LeaderGrid', () => ({
  useWikiHeadshot: () => null,
  photoCredit: () => '',
  initialsOf: (n: string) => n.charAt(0),
}));

const people: OrgNode[] = [
  { id: 'a', name: 'Ada Lovelace', role: 'CEO', group: 'exec', parentId: null, bio: 'Founder.', tenure: '2019 to now' },
  { id: 'b', name: 'Bo Chen', role: 'CTO', group: 'ai', parentId: 'a', bio: '' },
];
const company = { id: 'cmp', name: 'Acme', logoUrl: null, websiteUrl: null };

describe('PersonProfile', () => {
  it('shows the stored resume, marks gaps as Not reported and moves between people', async () => {
    function Harness() {
      const [id, setId] = useState('a');
      return <PersonProfile people={people} selectedId={id} onSelect={setId} company={company} onAsk={vi.fn()} />;
    }
    const { user } = renderWithProviders(<Harness />, { repository: makeRepo() });
    expect(screen.getByText('2019 to now')).toBeInTheDocument();
    expect(screen.getAllByText('Not reported').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /Bo Chen/ }));
    expect(screen.getByRole('heading', { name: 'Bo Chen' })).toBeInTheDocument();
    expect(screen.queryByText('2019 to now')).not.toBeInTheDocument();
  });

  it('runs deeper research only when asked and shows its sources', async () => {
    const deepDive = vi.fn().mockResolvedValue({ markdown: 'Ran the research lab.', citations: [{ title: 'Wire', url: 'https://wire.example/a' }] });
    const repo = Object.assign(makeRepo(), { deepDive });
    const { user } = renderWithProviders(
      <PersonProfile people={people} selectedId="a" onSelect={vi.fn()} company={company} onAsk={vi.fn()} />,
      { repository: repo },
    );
    expect(deepDive).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: /Research this person/ }));
    await waitFor(() => expect(screen.getByText('Ran the research lab.')).toBeInTheDocument());
    expect(deepDive).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: /wire/i })).toHaveAttribute('href', expect.stringContaining('wire.example'));
  });

  it('hands the person to Ask when asked', async () => {
    const onAsk = vi.fn();
    const { user } = renderWithProviders(
      <PersonProfile people={people} selectedId="a" onSelect={vi.fn()} company={company} onAsk={onAsk} />,
      { repository: makeRepo() },
    );
    await user.click(screen.getByRole('button', { name: /Ask about them/ }));
    expect(onAsk).toHaveBeenCalledWith(people[0]);
  });
});
