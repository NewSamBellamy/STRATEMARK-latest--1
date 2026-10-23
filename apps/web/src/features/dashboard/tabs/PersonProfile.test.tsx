import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { OrgNode } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { PersonProfile } from './PersonProfile';

vi.mock('./LeaderGrid', () => ({
  useWikiHeadshot: () => null,
  useWikiHeadshotResult: () => ({ shot: null, settled: true }),
  photoCredit: () => '',
  initialsOf: (n: string) => n.charAt(0),
}));

const people: OrgNode[] = [
  { id: 'a', name: 'Ada Lovelace', role: 'CEO', group: 'exec', parentId: null, bio: 'Founder.', tenure: '2019 to now' },
  { id: 'b', name: 'Bo Chen', role: 'CTO', group: 'ai', parentId: 'a', bio: '' },
];
const company = { id: 'cmp', name: 'Acme', logoUrl: null, websiteUrl: null };

describe('PersonProfile', () => {
  it('shows only the facts on record, never "Not reported", and moves between people', async () => {
    function Harness() {
      const [id, setId] = useState('a');
      return <PersonProfile people={people} selectedId={id} onSelect={setId} company={company} onAsk={vi.fn()} />;
    }
    const { user, container } = renderWithProviders(<Harness />, { repository: makeRepo() });
    expect(screen.getByText('2019 to now')).toBeInTheDocument();
    expect([...container.querySelectorAll('[data-fact]')].map((f) => f.getAttribute('data-fact'))).toEqual(['tenure']);
    expect(screen.queryByText('Not reported')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next person: Bo Chen' }));
    expect(screen.getByRole('heading', { name: 'Bo Chen' })).toBeInTheDocument();
    expect(screen.queryByText('2019 to now')).not.toBeInTheDocument();
    // Bo reports to Ada: the fact is a link back to her profile.
    await user.click(screen.getByRole('button', { name: 'Ada Lovelace' }));
    expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
  });

  it('says once that only name and role are on record when nothing else is', () => {
    const bare: OrgNode[] = [{ id: 'z', name: 'Zed Doe', role: 'Head of Sales', group: 'other', parentId: null, bio: '' }];
    const { container } = renderWithProviders(
      <PersonProfile people={bare} selectedId="z" onSelect={vi.fn()} company={company} onAsk={vi.fn()} />,
      { repository: makeRepo() },
    );
    expect(screen.getByText('Only name and role are on record.')).toBeInTheDocument();
    expect(container.querySelector('[data-fact]')).toBeNull();
    expect(screen.queryByText('Not reported')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download report \(PDF\)/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Sources' })).toBeInTheDocument();
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

  it('quotes a source without linking it when its address is not a web page', () => {
    for (const sourceUrl of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>']) {
      const hostile: OrgNode[] = [
        { id: 'a', name: 'Ada Lovelace', role: 'CEO', group: 'exec', parentId: null, bio: '', supportingQuote: 'Built the lab.', sourceUrl },
      ];
      const { unmount } = renderWithProviders(
        <PersonProfile people={hostile} selectedId="a" onSelect={vi.fn()} company={company} onAsk={vi.fn()} />,
        { repository: makeRepo() },
      );
      expect(screen.getByText(/Built the lab\./)).toBeInTheDocument();
      expect(document.querySelector('a[target="_blank"][href^="javascript"], a[target="_blank"][href^="data"]')).toBeNull();
      unmount();
    }
  });

  it('leaves the name and role to the modal title when asked not to repeat them', () => {
    renderWithProviders(
      <PersonProfile people={people} selectedId="a" onSelect={vi.fn()} company={company} onAsk={vi.fn()} showHeading={false} />,
      { repository: makeRepo() },
    );
    expect(screen.queryByRole('heading', { name: 'Ada Lovelace' })).not.toBeInTheDocument();
  });

  it('footnotes the career rows to a numbered source, and says plainly when no page was retained', () => {
    renderWithProviders(
      <PersonProfile people={people} selectedId="a" onSelect={vi.fn()} company={company} onAsk={vi.fn()} />,
      { repository: makeRepo() },
    );
    expect(screen.getByText(/No source link/)).toBeInTheDocument();
    expect(screen.getAllByText(/\(source 1, listed below\)/).length).toBeGreaterThan(0);
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
