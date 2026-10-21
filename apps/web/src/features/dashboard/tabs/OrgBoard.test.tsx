import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OrgNode } from '@mi/contracts';
import { OrgBoard, COLUMN_LIMIT } from './OrgBoard';
import { LeaderGrid } from './LeaderGrid';
import type { ProfileCompany } from './ProfileCard';

vi.mock('./LeaderGrid', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, useWikiHeadshot: () => null };
});

const company: ProfileCompany = { id: 'cmp', name: 'Acme', logoUrl: null, websiteUrl: null };
const node = (id: string, name: string, role: string, group: OrgNode['group'], parentId: string | null = null, over: Partial<OrgNode> = {}): OrgNode =>
  ({ id, name, role, group, parentId, bio: '', ...over });

const team: OrgNode[] = [
  node('a', 'Arthur Mensch', 'Co-founder & Chief Executive Officer (CEO)', 'exec'),
  node('b', 'Guillaume Lample', 'Co-founder & Chief Science Officer (CSO) / Chief Scientist', 'ai', 'a'),
  node('c', 'Timothee Lacroix', 'Co-founder & Chief Technology Officer (CTO)', 'ai', 'a'),
  node('d', 'Florian Bressand', 'Chief Business Officer (CBO)', 'exec', 'a'),
  node('e', 'Audrey Herblin-Stoop', 'Senior Vice President / VP of Global Public Affairs & Communications', 'exec', 'a'),
  node('f', 'Justus Murke', 'Chief of Staff to the CEO', 'exec', 'a'),
  node('g', 'Caroline Danziger Feldman', 'VP of Finance', 'exec'),
  node('h', 'Margaret Jennings', 'Head of Model Behavior', 'ai', 'b'),
  node('i', 'Zach Krasner', 'Head of Design', 'design', 'c'),
  node('j', 'Jon Bock', 'Head of Marketing', 'product', 'd'),
];

function parentMap(nodes: OrgNode[]): Map<string, string> {
  const ids = new Set(nodes.map((n) => n.id));
  return new Map(nodes.filter((n) => n.parentId && ids.has(n.parentId)).map((n) => [n.id, n.parentId!]));
}

const board = (people: OrgNode[], extra: Partial<React.ComponentProps<typeof OrgBoard>> = {}) => (
  <OrgBoard people={people} parentOf={parentMap(people)} company={company} board={[]} onOpen={vi.fn()} {...extra} />
);

function setNarrow(narrow: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: narrow && query.includes('max-width: 767px'),
    media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => setNarrow(false));

describe('OrgBoard', () => {
  it('shows every person at full size, grouped in function columns, with no clamped names or titles', () => {
    const { container } = render(board(team));
    expect(container.querySelectorAll('[data-person-id]')).toHaveLength(team.length);
    expect(screen.queryByRole('button', { name: /zoom/i })).not.toBeInTheDocument();
    expect(container.querySelector('.truncate, [class*="line-clamp"]')).toBeNull();
    const headers = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
    expect(headers[0]).toMatch(/^Founders & CEO/);
    expect(headers.join('|')).toMatch(/Executive.*AI & research.*Product & design/);
  });

  it('draws one string per reporting line, and none for people with no manager', () => {
    const { container } = render(board(team));
    const withManager = team.filter((p) => p.parentId !== null).length;
    expect(container.querySelectorAll('path[data-string]')).toHaveLength(withManager);
    const roots = render(board(team.filter((p) => p.parentId === null)));
    expect(roots.container.querySelectorAll('path[data-string]')).toHaveLength(0);
  });

  it('draws no string for a manager who is not on the board', () => {
    const orphans = team.filter((p) => p.id === 'h' || p.id === 'i');
    const { container } = render(board(orphans));
    expect(container.querySelectorAll('path[data-string]')).toHaveLength(0);
  });

  it('lists the board of directors as name tags with their reported affiliation', () => {
    render(board(team, { board: [{ name: 'Alex Rivera', affiliation: 'Founders Fund' }, { name: 'Jordan Bell', affiliation: '' }] }));
    const section = screen.getByRole('region', { name: 'Board' });
    expect(within(section).getByText('Founders Fund')).toBeInTheDocument();
    expect(within(section).getByText('Affiliation not yet sourced')).toBeInTheDocument();
    expect(within(section).queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders the Moves column only when a sourced recent move exists', () => {
    const recent = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 7);
    const { rerender } = render(board(team));
    expect(screen.queryByRole('region', { name: 'Moves' })).not.toBeInTheDocument();
    rerender(board(team.map((p) => (p.id === 'd' ? { ...p, move: { kind: 'joined' as const, date: recent, sourceUrl: 'https://news.example/x' } } : p))));
    const moves = screen.getByRole('region', { name: 'Moves' });
    expect(within(moves).getByText('Florian Bressand')).toBeInTheDocument();
    expect(within(moves).getByRole('link', { name: 'Source' })).toHaveAttribute('href', 'https://news.example/x');
  });

  it('renders a single person as one centred card with no columns or strings', () => {
    const { container } = render(board([team[0]!]));
    expect(container.querySelectorAll('[data-person-id]')).toHaveLength(1);
    expect(screen.queryAllByRole('heading', { level: 4 })).toHaveLength(0);
    expect(container.querySelector('svg[focusable="false"]')).toBeNull();
  });

  it('is reachable by keyboard: Tab lands on a card, Enter turns it over', async () => {
    const user = userEvent.setup();
    const { container } = render(board(team.slice(0, 3)));
    await user.tab();
    const first = document.activeElement as HTMLElement;
    expect(first).toHaveAttribute('aria-pressed', 'false');
    await user.keyboard('{Enter}');
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelectorAll('[data-face="back"]:not([inert])')).toHaveLength(1);
  });

  describe('a large team (60 people)', () => {
    const many: OrgNode[] = [
      node('p0', 'Rowan Ellery', 'Chief Executive Officer', 'exec'),
      ...Array.from({ length: 59 }, (_, i) => node(`p${i + 1}`, `Person ${i + 1}`, i % 5 === 0 ? 'Head of Research' : 'Member of staff', (['exec', 'ai', 'product', 'design', 'other'] as const)[i % 5]!, i < 7 ? 'p0' : `p${(i % 7) + 1}`)),
    ];

    it('starts under 50 cards and folds each column behind a "+N more" pin', () => {
      const { container } = render(board(many));
      const cards = container.querySelectorAll('[data-person-id]').length;
      expect(cards).toBeLessThan(50);
      expect(cards).toBeLessThanOrEqual(COLUMN_LIMIT * 5);
      expect(screen.getAllByRole('button', { name: /^Show \d+ more in/ }).length).toBeGreaterThan(0);
    });

    it('expands a column in place and ties strings to a folded card at its "+N" pin', async () => {
      const user = userEvent.setup();
      const { container } = render(board(many));
      const before = container.querySelectorAll('[data-person-id]').length;
      const pinEnds = [...container.querySelectorAll('path[data-string]')].filter((p) => p.getAttribute('data-to')?.startsWith('more:') || p.getAttribute('data-from')?.startsWith('more:'));
      expect(pinEnds.length).toBeGreaterThan(0);
      await user.click(screen.getAllByRole('button', { name: /^Show \d+ more in/ })[0]!);
      expect(container.querySelectorAll('[data-person-id]').length).toBeGreaterThan(before);
    });
  });

  describe('on a phone', () => {
    it('stacks function sections as swipe rows with no strings', () => {
      setNarrow(true);
      const { container } = render(board(team));
      expect(container.querySelector('svg[focusable="false"]')).toBeNull();
      expect(container.querySelectorAll('path[data-string]')).toHaveLength(0);
      expect(container.querySelector('.snap-x')).not.toBeNull();
      expect(container.querySelectorAll('[data-person-id]')).toHaveLength(team.length);
    });
  });
});

describe('Starting five strip', () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 404 }));
  const mistral = [
    node('f', 'Florian Bressand', 'Chief Business Officer (CBO)', 'exec', 'a'),
    node('v', 'Caroline Danziger Feldman', 'VP of Finance', 'exec', 'a'),
    node('l', 'Guillaume Lample', 'Co-founder & Chief Science Officer (CSO) / Chief Scientist', 'ai', 'a'),
    node('o', 'Charles de Freminville', 'Head of People / HR Operations', 'other', 'a'),
    node('t', 'Timothee Lacroix', 'Co-founder & Chief Technology Officer (CTO)', 'ai', 'a'),
    node('a', 'Arthur Mensch', 'Co-founder & Chief Executive Officer (CEO)', 'exec'),
    node('s', 'Audrey Herblin-Stoop', 'Senior Vice President / VP of Global Public Affairs', 'exec', 'a'),
  ];

  it('opens with the three co-founders even when two are filed under AI & research', () => {
    vi.stubGlobal('fetch', fetchMock);
    render(<LeaderGrid nodes={mistral} companyName="Mistral AI" onOpenPerson={vi.fn()} />);
    const names = within(screen.getByRole('group', { name: 'Starting five' })).getAllByRole('button').map((b) => b.textContent ?? '');
    expect(names).toHaveLength(5);
    const top = names.slice(0, 3).join(' ');
    expect(top).toMatch(/Arthur Mensch/);
    expect(top).toMatch(/Guillaume Lample/);
    expect(top).toMatch(/Timothee Lacroix/);
    expect(top).not.toMatch(/Florian|Caroline/);
    vi.unstubAllGlobals();
  });

  it('shows full names and titles, and its hover profile also opens on keyboard focus', () => {
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<LeaderGrid nodes={mistral} companyName="Mistral AI" onOpenPerson={vi.fn()} />);
    expect(container.querySelector('.truncate')).toBeNull();
    expect(screen.getAllByText('Co-founder & Chief Science Officer (CSO) / Chief Scientist').length).toBeGreaterThan(0);
    expect(container.querySelector('button.group\\/leader span.hidden')?.className).toContain('group-focus-visible/leader:block');
    vi.unstubAllGlobals();
  });

  it('hides itself when the whole team fits in the strip', () => {
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<LeaderGrid nodes={mistral.slice(0, 4)} companyName="Mistral AI" onOpenPerson={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    vi.unstubAllGlobals();
  });
});
