import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OrgNode } from '@mi/contracts';
import { companyAccent, onAccent, ProfileCard, type ProfileCompany } from './ProfileCard';

const headshotFor = (name: string) => (name === 'Pic Person'
  ? { thumb: 'https://upload.example/pic.jpg', sourceUrl: 'https://commons.example/pic', license: 'CC BY-SA 4.0', author: 'A. Photographer' }
  : null);
vi.mock('./LeaderGrid', () => ({
  useWikiHeadshot: (name: string) => headshotFor(name),
  useWikiHeadshotResult: (name: string) => ({ shot: headshotFor(name), settled: true }),
  photoCredit: () => 'A. Photographer, CC BY-SA 4.0',
  initialsOf: (n: string) => n.split(' ').map((w) => w[0]).join(''),
}));

const company: ProfileCompany = { id: 'cmp', name: 'Acme', logoUrl: null, websiteUrl: null };
const person = (over: Partial<OrgNode> = {}): OrgNode => ({
  id: 'p', name: 'Ada Lovelace', role: 'CEO', group: 'exec', parentId: null, bio: '', ...over,
});
const card = (p: OrgNode, extra: { onOpenProfile?: () => void; variant?: 'lead' | 'compact' } = {}) => (
  <ProfileCard person={p} company={company} onOpenProfile={extra.onOpenProfile ?? vi.fn()} variant={extra.variant} />
);

describe('ProfileCard', () => {
  it('is one button, labelled with name and role, that opens the profile', async () => {
    const onOpen = vi.fn();
    render(card(person(), { onOpenProfile: onOpen }));
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('Ada Lovelace, CEO. Open profile');
    await userEvent.click(buttons[0]!);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('shows only name and role when nothing else was reported, never "Not reported"', () => {
    const { container } = render(card(person()));
    expect(container.querySelectorAll('[data-stat]')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/not reported|no career details/i);
    expect(container.textContent).not.toMatch(/Acme/);
  });

  it('shows a stat line only for a non-empty field, and treats a written-out gap as empty', () => {
    const { container } = render(card(person({ tenure: '2019 to now', priorCompany: 'Not reported', notableProject: '  ' })));
    expect([...container.querySelectorAll('[data-stat]')].map((l) => l.getAttribute('data-stat'))).toEqual(['tenure']);
    expect(container.textContent).not.toMatch(/Not reported/);
  });

  it('gives a leadership card a quiet function tag and the reported background', () => {
    const { container } = render(card(person({ bio: 'Example News (original page not retrieved): "Ran the analytical engine."' }), { variant: 'lead' }));
    expect(container.querySelector('[data-variant="lead"]')).not.toBeNull();
    expect(screen.getByText('Executive')).toBeInTheDocument();
    expect(screen.getByText('Ran the analytical engine.')).toBeInTheDocument();
  });

  it('keeps a compact card to name, role and facts', () => {
    render(card(person({ bio: 'Ran the analytical engine.' })));
    expect(screen.queryByText('Ran the analytical engine.')).not.toBeInTheDocument();
    expect(screen.queryByText('Executive')).not.toBeInTheDocument();
  });

  describe('move tag', () => {
    const recent = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 7);
    const old = new Date(Date.now() - 800 * 86_400_000).toISOString().slice(0, 7);
    const move = (over: Record<string, unknown>) => ({ move: { kind: 'joined', date: recent, sourceUrl: 'https://news.example/a', ...over } }) as Partial<OrgNode>;

    it('shows for a sourced move from the last year', () => {
      const { container } = render(card(person(move({}))));
      expect(container.querySelector('[data-move-ribbon]')).toHaveTextContent(/Joined · /i);
    });

    it('does not show with no move, an old move or an unsourced move', () => {
      for (const over of [{ move: null }, move({ date: old }), move({ sourceUrl: '' }), move({ sourceUrl: 'javascript:alert(1)' })]) {
        const { container, unmount } = render(card(person(over as Partial<OrgNode>)));
        expect(container.querySelector('[data-move-ribbon]')).toBeNull();
        unmount();
      }
    });
  });

  it('shows initials, not a made-up portrait, when no verified headshot or photo exists', () => {
    render(card(person()));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('AL')).toBeInTheDocument();
  });

  it('shows a verified headshot with its credit', () => {
    render(card(person({ name: 'Pic Person' })));
    const img = screen.getByRole('img', { name: 'Pic Person' });
    expect(img).toHaveAttribute('src', 'https://upload.example/pic.jpg');
    expect(img).toHaveAttribute('title', 'A. Photographer, CC BY-SA 4.0');
  });

  it('uses a supplied photo only when it is a web address', () => {
    const { rerender } = render(card(person({ photoUrl: 'https://photos.example/ada.jpg' })));
    expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toHaveAttribute('src', 'https://photos.example/ada.jpg');
    rerender(card(person({ photoUrl: 'javascript:alert(1)' })));
    expect(screen.queryByRole('img', { name: 'Ada Lovelace' })).not.toBeInTheDocument();
  });

  it('never truncates a name or title', () => {
    const { container } = render(card(person({ name: 'Blanche Savary de Beauregard', role: 'General Counsel & Board Secretary and a very long title' })));
    expect(container.querySelector('.truncate')).toBeNull();
  });
});

describe('companyAccent', () => {
  it('uses a researched brand colour and otherwise a stable fallback per company', () => {
    expect(companyAccent({ id: 'x', brandTheme: { source: 'scraped', primary: '#336699' } })).toMatch(/^#[0-9a-f]{6}$/i);
    expect(companyAccent({ id: 'x', brandTheme: null })).toBe(companyAccent({ id: 'x', brandTheme: { source: 'default', primary: '#ff0000' } }));
  });

  it('picks text that reads on the accent', () => {
    expect(onAccent('#2f5d50')).toBe('#ffffff');
    expect(onAccent('#f59e0b')).toBe('#14201d');
  });
});
