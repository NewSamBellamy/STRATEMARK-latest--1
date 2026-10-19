import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OrgNode } from '@mi/contracts';
import { companyAccent, ProfileCard, type ProfileCompany } from './ProfileCard';

vi.mock('./LeaderGrid', () => ({
  useWikiHeadshot: (name: string) => (name === 'Pic Person'
    ? { thumb: 'https://upload.example/pic.jpg', sourceUrl: 'https://commons.example/pic', license: 'CC BY-SA 4.0', author: 'A. Photographer' }
    : null),
  photoCredit: () => 'A. Photographer, CC BY-SA 4.0',
  initialsOf: (n: string) => n.split(' ').map((w) => w[0]).join(''),
}));

const company: ProfileCompany = { id: 'cmp', name: 'Acme', logoUrl: null, websiteUrl: null };
const person = (over: Partial<OrgNode> = {}): OrgNode => ({
  id: 'p', name: 'Ada Lovelace', role: 'CEO', group: 'exec', parentId: null, bio: '', ...over,
});

describe('ProfileCard', () => {
  it('turns over on press and says Not reported for missing fields instead of guessing', async () => {
    const onFlip = vi.fn();
    const { rerender } = render(<ProfileCard person={person({ tenure: '2019 to now' })} company={company} flipped={false} onFlip={onFlip} onOpenProfile={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Ada Lovelace, CEO.*turn the card over/i }));
    expect(onFlip).toHaveBeenCalledTimes(1);
    rerender(<ProfileCard person={person({ tenure: '2019 to now' })} company={company} flipped onFlip={onFlip} onOpenProfile={vi.fn()} />);
    expect(screen.getByText('2019 to now', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getAllByText('Not reported', { selector: 'dd' }).length).toBe(2);
  });

  it('shows initials, not a made-up portrait, when no verified headshot exists', () => {
    render(<ProfileCard person={person()} company={company} flipped={false} onFlip={vi.fn()} onOpenProfile={vi.fn()} />);
    expect(screen.queryByRole('img', { name: 'Ada Lovelace' })).not.toBeInTheDocument();
    expect(screen.getByText('AL')).toBeInTheDocument();
  });

  it('shows a verified headshot with its credit', () => {
    render(<ProfileCard person={person({ name: 'Pic Person' })} company={company} flipped={false} onFlip={vi.fn()} onOpenProfile={vi.fn()} />);
    expect(screen.getByRole('img', { name: 'Pic Person' })).toHaveAttribute('src', 'https://upload.example/pic.jpg');
    expect(screen.getByText('A. Photographer, CC BY-SA 4.0')).toBeInTheDocument();
  });

  it('links the source only when it is a web address', () => {
    const { rerender } = render(<ProfileCard person={person({ sourceUrl: 'https://news.example/a' })} company={company} flipped onFlip={vi.fn()} onOpenProfile={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Source' })).toHaveAttribute('href', 'https://news.example/a');
    rerender(<ProfileCard person={person({ sourceUrl: 'javascript:alert(1)' })} company={company} flipped onFlip={vi.fn()} onOpenProfile={vi.fn()} />);
    expect(screen.queryByRole('link', { name: 'Source' })).not.toBeInTheDocument();
    expect(screen.getByText('No source link')).toBeInTheDocument();
  });

  it('opens the profile from the back and keeps the hidden face out of the tab order', async () => {
    const onOpen = vi.fn();
    const { rerender } = render(<ProfileCard person={person()} company={company} flipped={false} onFlip={vi.fn()} onOpenProfile={onOpen} />);
    expect(screen.getByRole('button', { name: /Open profile/, hidden: true })).toHaveAttribute('tabindex', '-1');
    rerender(<ProfileCard person={person()} company={company} flipped onFlip={vi.fn()} onOpenProfile={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: /Open profile/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('companyAccent', () => {
  it('uses a researched brand colour and otherwise a stable fallback per company', () => {
    expect(companyAccent({ id: 'x', brandTheme: { source: 'scraped', primary: '#336699' } })).toMatch(/^#[0-9a-f]{6}$/i);
    expect(companyAccent({ id: 'x', brandTheme: null })).toBe(companyAccent({ id: 'x', brandTheme: { source: 'default', primary: '#ff0000' } }));
  });
});
