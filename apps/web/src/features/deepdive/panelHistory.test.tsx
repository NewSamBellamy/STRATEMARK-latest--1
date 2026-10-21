import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { buildDataset } from '@mi/mocks';
import type { MarketIntelRepository, Report, ResearchThread, ThreadMessage } from '@mi/contracts';
import { DeepDiveProviderWithPanel, useDeepDive } from './DeepDive';
import { CardReader } from '@/features/card/CardReader';
import { makeRepo, renderWithProviders } from '@/test/test-utils';

const DAY = 24 * 60 * 60 * 1000;
const CARD = 'card_x';
const iso = (ageDays: number) => new Date(Date.now() - ageDays * DAY).toISOString();

function msg(id: string, role: 'user' | 'assistant', text: string, ageDays: number, origin?: 'memory' | 'fresh'): ThreadMessage {
  return { id, role, text, citations: [], at: iso(ageDays), ...(origin ? { origin } : {}) };
}

function thread(id: string, title: string, ageDays: number, extra: Partial<ResearchThread> = {}): ResearchThread {
  return {
    id,
    title,
    scope: { kind: 'cards', deckId: 'deck_1', cardIds: [CARD], subject: 'Acme card' },
    messages: [msg(`${id}_q`, 'user', `${title}?`, ageDays), msg(`${id}_a`, 'assistant', `Answer for ${title}`, ageDays, 'fresh')],
    reportId: null,
    createdAt: iso(ageDays),
    updatedAt: iso(ageDays),
    ...extra,
  };
}

interface Fake {
  repo: MarketIntelRepository;
  askResearch: ReturnType<typeof vi.fn>;
  listResearchThreads: ReturnType<typeof vi.fn>;
  getResearchThread: ReturnType<typeof vi.fn>;
}

/** A repository with canned conversations. It has no model: askResearch only records the call and echoes a reply. */
function fakeRepo(threads: ResearchThread[], reports: Report[] = []): Fake {
  const repo = makeRepo();
  const listResearchThreads = vi.fn(async (filter?: { cardId?: string; companyId?: string }) =>
    filter?.cardId ? threads.filter((t) => (t.scope.cardIds ?? []).includes(filter.cardId!)) : threads);
  const getResearchThread = vi.fn(async (id: string) => threads.find((t) => t.id === id) ?? null);
  const askResearch = vi.fn(async (input: { threadId?: string; question: string; scope?: ResearchThread['scope']; fresh?: boolean }) => {
    const base = input.threadId ? threads.find((t) => t.id === input.threadId)! : thread('thr_new', input.question, 0, { scope: input.scope!, messages: [] });
    return {
      ...base,
      messages: [...base.messages, msg('nq', 'user', input.question, 0), msg('na', 'assistant', 'A new reply', 0, input.fresh ? 'fresh' : undefined)],
      updatedAt: iso(0),
    };
  });
  Object.assign(repo, {
    listResearchThreads,
    getResearchThread,
    askResearch,
    getCardMemory: vi.fn(async (cardId: string) => ({
      cardId,
      threads: threads.filter((t) => (t.scope.cardIds ?? []).includes(cardId)),
      reports,
      brief: null,
    })),
    listReports: vi.fn(async () => reports),
  });
  return { repo, askResearch, listResearchThreads, getResearchThread };
}

const cardScope = { kind: 'cards' as const, deckId: 'deck_1', cardIds: [CARD], subject: 'Acme card' };

function Opener({ seed, newChat }: { seed?: string; newChat?: boolean }) {
  const { chat } = useDeepDive();
  return <button type="button" onClick={() => chat(cardScope, { ...(seed ? { seed } : {}), ...(newChat ? { newChat } : {}) })}>open card chat</button>;
}

function panel(fake: Fake, opener = <Opener />) {
  return renderWithProviders(<DeepDiveProviderWithPanel>{opener}</DeepDiveProviderWithPanel>, { repository: fake.repo });
}

const send = async (user: ReturnType<typeof renderWithProviders>['user'], text: string) => {
  await user.type(screen.getByRole('textbox', { name: 'Ask a research question' }), `${text}{Enter}`);
};

describe('a card remembers its conversation', () => {
  it('opening a card with history reopens its newest conversation and calls no model', async () => {
    const fake = fakeRepo([thread('old', 'Older question', 5), thread('new', 'Newest question', 1)]);
    const { user } = panel(fake);
    await user.click(screen.getByRole('button', { name: 'open card chat' }));
    expect(await screen.findByText('Answer for Newest question')).toBeInTheDocument();
    expect(screen.queryByText('Answer for Older question')).not.toBeInTheDocument();
    expect(fake.listResearchThreads).toHaveBeenCalledWith({ cardId: CARD });
    expect(fake.askResearch).not.toHaveBeenCalled();
  });

  it('adds a question asked within 14 days to the same conversation', async () => {
    const fake = fakeRepo([thread('recent', 'Recent question', 13)]);
    const { user } = panel(fake);
    await user.click(screen.getByRole('button', { name: 'open card chat' }));
    await screen.findByText('Answer for Recent question');
    await send(user, 'And the pricing?');
    await waitFor(() => expect(fake.askResearch).toHaveBeenCalledTimes(1));
    expect(fake.askResearch.mock.calls[0]![0]).toMatchObject({ threadId: 'recent', question: 'And the pricing?' });
  });

  it('starts a new conversation when the last one is older than 14 days, and keeps the old one', async () => {
    const fake = fakeRepo([thread('cold', 'Cold question', 20)]);
    const { user } = panel(fake);
    await user.click(screen.getByRole('button', { name: 'open card chat' }));
    await screen.findByText('Answer for Cold question');
    await send(user, 'Anything new?');
    await waitFor(() => expect(fake.askResearch).toHaveBeenCalledTimes(1));
    const input = fake.askResearch.mock.calls[0]![0];
    expect(input.threadId).toBeUndefined();
    expect(input.scope).toMatchObject({ cardIds: [CARD] });
  });

  it('applies the same 14-day rule to a question sent along when the card is opened', async () => {
    const recent = fakeRepo([thread('r', 'Recent', 2)]);
    const first = panel(recent, <Opener seed="Dig in" />);
    await first.user.click(screen.getByRole('button', { name: 'open card chat' }));
    await waitFor(() => expect(recent.askResearch).toHaveBeenCalledTimes(1));
    expect(recent.askResearch.mock.calls[0]![0]).toMatchObject({ threadId: 'r', question: 'Dig in' });
    first.unmount();

    const cold = fakeRepo([thread('c', 'Cold', 30)]);
    const second = panel(cold, <Opener seed="Dig in" />);
    await second.user.click(screen.getByRole('button', { name: 'open card chat' }));
    await waitFor(() => expect(cold.askResearch).toHaveBeenCalledTimes(1));
    expect(cold.askResearch.mock.calls[0]![0].threadId).toBeUndefined();
  });

  it('"New chat" starts a fresh conversation on purpose', async () => {
    const fake = fakeRepo([thread('t1', 'First question', 1)]);
    const { user } = panel(fake);
    await user.click(screen.getByRole('button', { name: 'open card chat' }));
    await screen.findByText('Answer for First question');
    await user.click(screen.getByRole('button', { name: /new chat/i }));
    expect(screen.queryByText('Answer for First question')).not.toBeInTheDocument();
    await send(user, 'A different angle');
    await waitFor(() => expect(fake.askResearch).toHaveBeenCalledTimes(1));
    expect(fake.askResearch.mock.calls[0]![0].threadId).toBeUndefined();
  });
});

describe('History in the Ask panel', () => {
  const other = thread('other', 'Zeta Corp pricing', 3, { scope: { kind: 'company', deckId: null, companyId: 'co_z', subject: 'Zeta Corp' } });
  const mine1 = thread('mine1', 'Acme funding', 1, { reportId: 'rep_1' });
  const mine2 = thread('mine2', 'Acme hiring', 6);
  const report = { id: 'rep_1', kind: 'company', subjectId: 'co_a', title: 'Acme deep report', cardId: CARD, threadIds: ['mine1'], createdAt: iso(2) } as unknown as Report;

  it('lists this card and recent conversations, newest first, and opens a picked row', async () => {
    const fake = fakeRepo([other, mine2, mine1], [report]);
    const { user } = panel(fake);
    await user.click(screen.getByRole('button', { name: 'open card chat' }));
    await screen.findByText('Answer for Acme funding');
    await user.click(screen.getByRole('button', { name: 'History' }));

    const here = within(await screen.findByRole('region', { name: 'This card' }));
    const titles = here.getAllByRole('listitem').map((li) => li.textContent ?? '');
    // Newest first: the funding chat (1d), the report (2d), then the hiring chat (6d).
    expect(titles[0]).toContain('Acme funding');
    expect(titles[0]).toContain('report made');
    expect(titles[1]).toContain('Acme deep report');
    expect(titles[2]).toContain('Acme hiring');
    expect(here.queryByText('Zeta Corp pricing')).not.toBeInTheDocument();

    const recent = within(screen.getByRole('region', { name: 'Recent' }));
    const rows = recent.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('Acme funding');
    expect(rows[1]).toContain('Zeta Corp pricing');
    expect(rows[1]).toContain('Zeta Corp');
    expect(rows[2]).toContain('Acme hiring');

    await user.click(recent.getByRole('button', { name: /Zeta Corp pricing/ }));
    expect(await screen.findByText('Answer for Zeta Corp pricing')).toBeInTheDocument();
    expect(fake.getResearchThread).toHaveBeenCalledWith('other');
    expect(fake.askResearch).not.toHaveBeenCalled();
  });
});

describe('answers from research on file', () => {
  const asked = (origin?: 'memory' | 'fresh') => thread('m', 'Funding', 1, {
    messages: [msg('q', 'user', 'How much did they raise?', 1), msg('a', 'assistant', 'They raised a seed round.', 1, origin)],
  });

  it('labels a memory answer and re-sends the same question fresh on "Search again"', async () => {
    const fake = fakeRepo([asked('memory')]);
    const { user } = panel(fake);
    await user.click(screen.getByRole('button', { name: 'open card chat' }));
    expect(await screen.findByText(/From your research on file/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Search again' }));
    await waitFor(() => expect(fake.askResearch).toHaveBeenCalledTimes(1));
    expect(fake.askResearch.mock.calls[0]![0]).toMatchObject({ threadId: 'm', question: 'How much did they raise?', fresh: true });
  });

  it('shows nothing extra on a fresh answer or an older one with no origin', async () => {
    for (const origin of ['fresh', undefined] as const) {
      const fake = fakeRepo([asked(origin)]);
      const { user, unmount } = panel(fake);
      await user.click(screen.getByRole('button', { name: 'open card chat' }));
      await screen.findByText('They raised a seed round.');
      expect(screen.queryByText(/From your research on file/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Search again' })).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe('the card reader entry', () => {
  const data = buildDataset();
  const signal = data.cards.find((c) => c.cardType === 'culture')!;
  const hydrated = { card: signal, company: signal.companyId ? data.companies.find((c) => c.id === signal.companyId)! : null, metrics: [], viceClaims: [] };
  const scope = { kind: 'cards' as const, deckId: signal.deckId, cardIds: [signal.id], subject: signal.title };
  const own = (id: string, title: string, age: number) => thread(id, title, age, { scope });

  it('shows the conversation count and a memory line, and resumes the latest conversation', async () => {
    const fake = fakeRepo([own('a', 'Older culture chat', 4), own('b', 'Latest culture chat', 1)], [
      { id: 'rep_9', kind: 'deck', subjectId: signal.deckId, title: 'Culture report', cardId: signal.id, createdAt: iso(1) } as unknown as Report,
    ]);
    const { user } = renderWithProviders(
      <DeepDiveProviderWithPanel><CardReader data={hydrated} open onOpenChange={() => {}} /></DeepDiveProviderWithPanel>,
      { repository: fake.repo },
    );
    const button = await screen.findByRole('button', { name: /Continue conversation \(2\)/ });
    expect(button).toHaveTextContent('2 chats · 1 report');
    expect(screen.queryByRole('button', { name: /^Ask about this finding/ })).not.toBeInTheDocument();
    await user.click(button);
    expect(await screen.findByText('Answer for Latest culture chat')).toBeInTheDocument();
    expect(fake.askResearch).not.toHaveBeenCalled();
  });

  it('keeps today\'s button when the card has no history', async () => {
    const fake = fakeRepo([]);
    renderWithProviders(
      <DeepDiveProviderWithPanel><CardReader data={hydrated} open onOpenChange={() => {}} /></DeepDiveProviderWithPanel>,
      { repository: fake.repo },
    );
    expect(await screen.findByRole('button', { name: /^Ask about this finding/ })).toBeInTheDocument();
    expect(screen.queryByText(/Continue conversation/)).not.toBeInTheDocument();
    expect(fake.askResearch).not.toHaveBeenCalled();
  });
});
