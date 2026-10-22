import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OrgNode } from '@mi/contracts';
import { OrgBoard, SECTION_LIMIT } from './OrgBoard';
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
  node('b', 'Guillaume Lample', 'Co-founder & Chief Scientist', 'ai', 'a'),
  node('d', 'Florian Bressand', 'Chief Business Officer (CBO)', 'exec', 'a'),
  node('g', 'Caroline Danziger Feldman', 'VP of Finance', 'exec'),
  node('h', 'Margaret Jennings', 'Head of Model Behavior', 'ai', 'b'),
  node('i', 'Zach Krasner', 'Head of Design', 'design'),
  node('k', 'Pat Board', 'Independent Director', 'other'),
];

const board = (people: OrgNode[], extra: Partial<React.ComponentProps<typeof OrgBoard>> = {}) => (
  <OrgBoard people={people} company={company} board={[]} onOpen={vi.fn()} {...extra} />
);

const sectionNames = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

describe('OrgBoard', () => {
  it('shows every person once, in labelled sections with leadership first and the board last', () => {
    const { container } = render(board(team));
    expect(container.querySelectorAll('[data-person-id]')).toHaveLength(team.length);
    expect(sectionNames()).toEqual(['Leadership', 'Executives', 'AI & research', 'Product & design', 'Board']);
    const lead = screen.getByRole('region', { name: 'Leadership' });
    expect(within(lead).getAllByRole('button').map((b) => b.getAttribute('data-person-id'))).toEqual(['a', 'b']);
    expect(lead.querySelectorAll('[data-variant="lead"]')).toHaveLength(2);
  });

  it('puts a board seat title in the Board section with the governance directors', () => {
    render(board(team, { board: [{ name: 'Alex Rivera', affiliation: 'Founders Fund' }, { name: 'Jordan Bell', affiliation: '' }] }));
    const section = screen.getByRole('region', { name: 'Board' });
    expect(within(section).getByText('Pat Board')).toBeInTheDocument();
    expect(within(section).getByText('Founders Fund')).toBeInTheDocument();
    expect(within(section).getByText('Jordan Bell')).toBeInTheDocument();
    expect(section.textContent).not.toMatch(/not (yet )?(sourced|reported)/i);
    expect(section.querySelectorAll('[data-director]')).toHaveLength(2);
  });

  it('draws no reporting strings, pins or dots', () => {
    const { container } = render(board(team));
    expect(container.querySelector('svg path[data-string]')).toBeNull();
    expect(container.querySelector('[data-pin-for]')).toBeNull();
  });

  it('opens a profile from a card', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(board(team, { onOpen }));
    await user.click(screen.getByRole('button', { name: /Florian Bressand/ }));
    expect(onOpen).toHaveBeenCalledWith('d');
  });

  it('is reachable by keyboard: each card is one button', async () => {
    const user = userEvent.setup();
    render(board(team.slice(0, 3)));
    await user.tab();
    expect(document.activeElement).toHaveAttribute('data-person-id', 'a');
    await user.tab();
    expect(document.activeElement).toHaveAttribute('data-person-id', 'b');
  });

  it('never leaves one leadership card alone on a row of four', () => {
    const four = ['a', 'b', 'c', 'e'].map((id, i) => node(id, `Founder ${i}`, 'Co-founder', 'exec'));
    render(board(four));
    const list = screen.getByRole('region', { name: 'Leadership' }).querySelector('ul')!;
    expect(list.className).toContain('sm:grid-cols-2');
    expect(list.className).not.toContain('xl:grid-cols-3');
  });

  it('folds a long section behind "Show N more" and expands it in place', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: SECTION_LIMIT + 4 }, (_, i) => node(`x${i}`, `Person ${i}`, 'Member of staff', 'product'));
    const { container } = render(board(many));
    expect(container.querySelectorAll('[data-person-id]')).toHaveLength(SECTION_LIMIT);
    await user.click(screen.getByRole('button', { name: 'Show 4 more in Product & design' }));
    expect(container.querySelectorAll('[data-person-id]')).toHaveLength(SECTION_LIMIT + 4);
  });
});
