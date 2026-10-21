import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OrgNode } from '@mi/contracts';
import { companyAccent, onAccent, ProfileCard, type ProfileCompany } from './ProfileCard';

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
const card = (p: OrgNode, extra: { flipped?: boolean; onFlip?: () => void; onOpenProfile?: () => void; reportsTo?: string | null } = {}) => (
  <ProfileCard person={p} company={company} flipped={extra.flipped ?? false} onFlip={extra.onFlip ?? vi.fn()} onOpenProfile={extra.onOpenProfile ?? vi.fn()} reportsTo={extra.reportsTo} />
);
const front = (c: HTMLElement) => within(c.querySelector<HTMLElement>('[data-face="front"]')!);
const back = (c: HTMLElement) => within(c.querySelector<HTMLElement>('[data-face="back"]')!);

describe('ProfileCard', () => {
  it('shows the no-career note by default and omits it when the group says it once', () => {
    const { container, rerender } = render(card(person()));
    expect(container.textContent).toMatch(/No career details reported/);
    rerender(<ProfileCard person={person()} company={company} flipped={false} onFlip={vi.fn()} onOpenProfile={vi.fn()} careerNote={false} />);
    expect(container.textContent).not.toMatch(/No career details reported/);
  });

  it('turns over on press and reflects the state in aria-pressed', async () => {
    const onFlip = vi.fn();
    const { rerender } = render(card(person(), { onFlip }));
    const flip = screen.getByRole('button', { name: /Ada Lovelace, CEO.*turn the card over/i });
    expect(flip).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(flip);
    expect(onFlip).toHaveBeenCalledTimes(1);
    rerender(card(person(), { onFlip, flipped: true }));
    expect(screen.getByRole('button', { name: /Ada Lovelace, CEO.*turn the card over/i, hidden: true })).toHaveAttribute('aria-pressed', 'true');
  });

  it('flips from a small icon-only button that carries the accessible label', () => {
    const { container } = render(card(person()));
    const flip = front(container).getByRole('button', { name: /Ada Lovelace, CEO.*turn the card over/i });
    expect(flip.textContent).toBe('');
    expect(flip.querySelector('svg')).not.toBeNull();
    expect(flip).toHaveClass('h-6', 'w-6');
  });

  it('makes the hidden face inert rather than aria-hidden, and swaps it on flip', () => {
    const { container, rerender } = render(card(person()));
    expect(container.querySelector('[data-face="back"]')).toHaveAttribute('inert');
    expect(container.querySelector('[data-face="front"]')).not.toHaveAttribute('inert');
    expect(container.querySelector('[aria-hidden="true"]:not([data-pin]):not(svg):not(span)')).toBeNull();
    rerender(card(person(), { flipped: true }));
    expect(container.querySelector('[data-face="front"]')).toHaveAttribute('inert');
    expect(container.querySelector('[data-face="back"]')).not.toHaveAttribute('inert');
  });

  it('flips back on Escape', async () => {
    const onFlip = vi.fn();
    render(card(person(), { onFlip, flipped: true }));
    await userEvent.click(screen.getByRole('button', { name: /turn Ada Lovelace's card back over/i }));
    onFlip.mockClear();
    await userEvent.keyboard('{Escape}');
    expect(onFlip).toHaveBeenCalledTimes(1);
  });

  it('reaches the profile from the front without flipping', async () => {
    const onOpen = vi.fn();
    const onFlip = vi.fn();
    const { container } = render(card(person(), { onOpenProfile: onOpen, onFlip }));
    await userEvent.click(front(container).getByRole('button', { name: /Open Ada Lovelace's profile/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onFlip).not.toHaveBeenCalled();
  });

  it('shows no stat lines and an honest foot line when nothing was reported', () => {
    const { container } = render(card(person()));
    expect(container.querySelectorAll('[data-stat]')).toHaveLength(0);
    const empty = front(container).getByText('No career details reported');
    // a quiet line of muted text, not a filled pill or a button
    expect(empty.tagName).toBe('P');
    expect(empty.closest('button')).toBeNull();
    expect(empty.getAttribute('style')).toBeNull();
    expect(front(container).queryByText('Not reported')).not.toBeInTheDocument();
    // the company name is not used as filler
    expect(front(container).queryByText('Acme')).not.toBeInTheDocument();
  });

  it('shows a stat line only for a non-empty field, and treats a written-out gap as empty', () => {
    const { container } = render(card(person({ tenure: '2019 to now', priorCompany: 'Not reported', notableProject: '  ' })));
    const lines = [...container.querySelectorAll('[data-stat]')].map((l) => l.getAttribute('data-stat'));
    expect(lines).toEqual(['tenure']);
  });

  it('footnotes a stat line to a source on the back, and says so when there is no source link', () => {
    const { container } = render(card(person({ tenure: '2019 to now', supportingQuote: 'Lovelace has led Acme since 2019.' }), { flipped: true }));
    const line = container.querySelector('[data-stat="tenure"]')!;
    expect(line).toHaveTextContent('2019 to now');
    expect(line.querySelector('sup')).toHaveTextContent('1');
    expect(back(container).getByText(/No source link/)).toBeInTheDocument();
    expect(back(container).getByText(/Lovelace has led Acme since 2019/)).toBeInTheDocument();
  });

  it('lists the source with its domain, quote and retrieval date', () => {
    const { container } = render(card(person({
      tenure: '2019 to now', sourceUrl: 'https://www.news.example/a', supportingQuote: 'Lovelace has led Acme since 2019.', sourceRetrievedAt: '2026-07-30T10:00:00Z',
    }), { flipped: true }));
    expect(back(container).getByRole('link', { name: 'news.example' })).toHaveAttribute('href', 'https://www.news.example/a');
    expect(back(container).getByText(/retrieved 2026-07-30/)).toBeInTheDocument();
  });

  it('shows the full bio and who the person reports to on the back', () => {
    const bio = 'Word '.repeat(80).trim();
    const { container } = render(card(person({ bio }), { flipped: true, reportsTo: 'Grace Hopper' }));
    expect(back(container).getByText(bio)).toBeInTheDocument();
    expect(back(container).getByText('Grace Hopper')).toBeInTheDocument();
  });

  it('never clamps or truncates a name or title', () => {
    const { container } = render(card(person({ name: 'Blanche Savary de Beauregard', role: 'General Counsel & Board Secretary and a very long title' })));
    expect(container.querySelector('.truncate, [class*="line-clamp"]')).toBeNull();
  });

  describe('MOVING ribbon', () => {
    const recent = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 7);
    const old = new Date(Date.now() - 800 * 86_400_000).toISOString().slice(0, 7);
    const move = (over: Record<string, unknown>) => ({ move: { kind: 'joined', date: recent, sourceUrl: 'https://news.example/a', ...over } }) as Partial<OrgNode>;

    it('shows for a sourced move from the last year', () => {
      const { container } = render(card(person(move({}))));
      expect(container.querySelector('[data-move-ribbon]')).toHaveTextContent(/JOINED · /);
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
    expect(screen.queryByRole('img', { name: 'Ada Lovelace' })).not.toBeInTheDocument();
    expect(screen.getByText('AL')).toBeInTheDocument();
  });

  it('shows a verified headshot with its credit', () => {
    render(card(person({ name: 'Pic Person' })));
    expect(screen.getByRole('img', { name: 'Pic Person' })).toHaveAttribute('src', 'https://upload.example/pic.jpg');
    expect(screen.getByText('A. Photographer, CC BY-SA 4.0')).toBeInTheDocument();
  });

  it('uses a supplied photo only when it is a web address', () => {
    const { rerender } = render(card(person({ photoUrl: 'https://photos.example/ada.jpg' })));
    expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toHaveAttribute('src', 'https://photos.example/ada.jpg');
    rerender(card(person({ photoUrl: 'javascript:alert(1)' })));
    expect(screen.queryByRole('img', { name: 'Ada Lovelace' })).not.toBeInTheDocument();
  });

  it('links the source only when it is a web address', () => {
    const { container, rerender } = render(card(person({ sourceUrl: 'https://news.example/a' }), { flipped: true }));
    expect(back(container).getByRole('link', { name: 'news.example' })).toHaveAttribute('href', 'https://news.example/a');
    for (const sourceUrl of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '//evil.example/x']) {
      rerender(card(person({ sourceUrl }), { flipped: true }));
      expect(back(container).queryByRole('link')).not.toBeInTheDocument();
      expect(back(container).getByText(/No source link/)).toBeInTheDocument();
    }
  });

  it('opens the profile from the back', async () => {
    const onOpen = vi.fn();
    const { container } = render(card(person(), { onOpenProfile: onOpen, flipped: true }));
    await userEvent.click(back(container).getByRole('button', { name: /Open Ada Lovelace's profile/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
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
