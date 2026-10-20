import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { buildDataset, createShareRepository } from '@mi/mocks';
import type { MarketIntelRepository, ShareSnapshot, SignalBrief } from '@mi/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { ReadOnlyProvider } from '@/lib/readOnly';
import { DeepDiveProvider } from '@/features/deepdive/DeepDive';
import { createQueryClient } from '@/lib/query/queryClient';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { CardReader } from './CardReader';

const data = buildDataset();

function hydrate(predicate: (c: (typeof data.cards)[number]) => boolean) {
  const card = data.cards.find(predicate)!;
  const company = card.companyId ? data.companies.find((c) => c.id === card.companyId)! : null;
  const metrics = card.companyId ? data.metrics.filter((m) => m.companyId === card.companyId) : [];
  const viceClaims = data.viceClaims.filter((v) => v.cardId === card.id);
  return { card, company, metrics, viceClaims };
}

const signal = hydrate((c) => c.cardType === 'insight');

function briefFor(cardId: string, over: Partial<SignalBrief> = {}): SignalBrief {
  return {
    cardId, cardType: 'insight', builtAt: '2026-10-20T10:00:00.000Z',
    lead: 'The category is consolidating around two buyers.',
    points: [
      { text: 'Acme bought Beta in 2025.', sources: [{ title: 'Reuters', url: 'https://reuters.com/acme-beta' }] },
      { text: 'Two rivals exited the market.', sources: [
        { title: 'FT', url: 'https://ft.com/exits' }, { title: 'Bloomberg', url: 'https://bloomberg.com/exits' }] },
    ],
    sources: [], cost: { estUsd: 0.05, calls: 2, searches: 1 },
    ...over,
  };
}

function repoWith(stored: SignalBrief | null, build?: () => Promise<SignalBrief>) {
  const repo = makeRepo() as MarketIntelRepository;
  repo.peekSignalBrief = vi.fn(async () => stored);
  if (build) repo.researchSignalBrief = vi.fn(build);
  return repo;
}

const open = (repository: MarketIntelRepository, cwc = signal) =>
  renderWithProviders(<CardReader data={cwc} open onOpenChange={() => {}} />, { repository });

describe('signal brief in the reader', () => {
  it('shows a stored brief with every point and its source links, and spends nothing', async () => {
    const repo = repoWith(briefFor(signal.card.id), vi.fn());
    open(repo);
    const dialog = within(screen.getByRole('dialog'));
    expect(await dialog.findByText('The category is consolidating around two buyers.')).toBeInTheDocument();
    const buyout = dialog.getByText('Acme bought Beta in 2025.').closest('li')!;
    expect(within(buyout).getByRole('link', { name: /reuters/i })).toHaveAttribute('href', 'https://reuters.com/acme-beta');
    const exits = dialog.getByText('Two rivals exited the market.').closest('li')!;
    expect(within(exits).getAllByRole('link')).toHaveLength(2);
    expect(repo.researchSignalBrief).not.toHaveBeenCalled();
  });

  it('builds once when none is stored, then shows it', async () => {
    let finish!: (b: SignalBrief) => void;
    const repo = repoWith(null, () => new Promise<SignalBrief>((resolve) => { finish = resolve; }));
    open(repo);
    expect(await screen.findByText(/Writing the full report on this finding/)).toBeInTheDocument();
    finish(briefFor(signal.card.id));
    expect(await screen.findByText('Acme bought Beta in 2025.')).toBeInTheDocument();
    expect(screen.queryByText(/Writing the full report/)).not.toBeInTheDocument();
    expect(repo.researchSignalBrief).toHaveBeenCalledTimes(1);
  });

  it('shares one build between two opens of the same card', async () => {
    let finish!: (b: SignalBrief) => void;
    const repo = repoWith(null, () => new Promise<SignalBrief>((resolve) => { finish = resolve; }));
    open(repo);
    open(repo);
    await waitFor(() => expect(screen.getAllByText(/Writing the full report/).length).toBe(2));
    expect(repo.researchSignalBrief).toHaveBeenCalledTimes(1);
    finish(briefFor(signal.card.id));
    expect((await screen.findAllByText('Acme bought Beta in 2025.')).length).toBe(2);
  });

  it('never builds in a shared view and shows only a carried brief', async () => {
    const snapshot: ShareSnapshot = {
      v: 1, kind: 'card', focusCardId: signal.card.id, sharedAt: '2026-10-20T10:00:00.000Z',
      markets: [data.market], decks: [data.deck], companies: data.companies,
      metrics: data.metrics, cards: [signal.card], viceClaims: [], dashboards: {},
      signalBriefs: { [signal.card.id]: briefFor(signal.card.id) },
    };
    const view = (snap: ShareSnapshot) => {
      const repo = createShareRepository(snap);
      return render(<RepositoryProvider repository={repo}><QueryClientProvider client={createQueryClient()}>
        <ReadOnlyProvider><DeepDiveProvider><MemoryRouter>
          <CardReader data={signal} open onOpenChange={() => {}} />
        </MemoryRouter></DeepDiveProvider></ReadOnlyProvider>
      </QueryClientProvider></RepositoryProvider>);
    };
    expect(createShareRepository(snapshot).researchSignalBrief).toBeUndefined();
    const first = view(snapshot);
    expect(await screen.findByText('Acme bought Beta in 2025.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rebuild/i })).not.toBeInTheDocument();
    first.unmount();
    view({ ...snapshot, signalBriefs: undefined });
    await screen.findByRole('dialog');
    expect(screen.queryByText(/Writing the full report/)).not.toBeInTheDocument();
    expect(screen.queryByText('Acme bought Beta in 2025.')).not.toBeInTheDocument();
  });

  it('cleans a carried brief: points without a source are dropped, junk is ignored', () => {
    const bad = briefFor(signal.card.id);
    bad.points.push({ text: 'Unsourced claim.', sources: [] });
    const repo = createShareRepository({
      v: 1, kind: 'card', focusCardId: signal.card.id, sharedAt: '2026-10-20T10:00:00.000Z',
      markets: [data.market], decks: [data.deck], companies: [], metrics: [],
      cards: [signal.card], viceClaims: [], dashboards: {},
      signalBriefs: { [signal.card.id]: bad, ghost: briefFor('ghost'), x: 5 as never },
    });
    return Promise.all([repo.peekSignalBrief!(signal.card.id), repo.peekSignalBrief!('ghost')]).then(([kept, ghost]) => {
      expect(kept?.points.map((p) => p.text)).toEqual(['Acme bought Beta in 2025.', 'Two rivals exited the market.']);
      expect(ghost).toBeNull();
    });
  });

  it('shows the error and a retry when a build fails', async () => {
    const build = vi.fn<() => Promise<SignalBrief>>()
      .mockRejectedValueOnce(new Error('Search is unavailable right now.'))
      .mockResolvedValueOnce(briefFor(signal.card.id));
    const { user } = open(repoWith(null, build));
    expect(await screen.findByText('Search is unavailable right now.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Acme bought Beta in 2025.')).toBeInTheDocument();
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('says plainly when nothing more is documented', async () => {
    open(repoWith(briefFor(signal.card.id, { lead: '', points: [] })));
    expect(await screen.findByText('Nothing more is documented about this finding yet.')).toBeInTheDocument();
  });

  it('does not render a point without a source even if one slips in', async () => {
    const slipped = briefFor(signal.card.id);
    slipped.points.push({ text: 'Invented figure: 40% share.', sources: [] });
    open(repoWith(slipped));
    expect(await screen.findByText('Acme bought Beta in 2025.')).toBeInTheDocument();
    expect(screen.queryByText(/Invented figure/)).not.toBeInTheDocument();
  });

  it('asks before a rebuild spends', async () => {
    const build = vi.fn(async () => briefFor(signal.card.id, { lead: 'Rebuilt lead.' }));
    const { user } = open(repoWith(briefFor(signal.card.id), build));
    await screen.findByText('Acme bought Beta in 2025.');
    await user.click(screen.getByRole('button', { name: 'Rebuild' }));
    expect(build).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Rebuild now' }));
    expect(await screen.findByText('Rebuilt lead.')).toBeInTheDocument();
    expect(build).toHaveBeenCalledWith({ cardId: signal.card.id, force: true });
  });

  it('leaves entity cards alone', async () => {
    const company = hydrate((c) => c.cardType === 'company' && c.companyId === 'cmp_holy-hype');
    const repo = repoWith(null, vi.fn());
    open(repo, company);
    await screen.findByRole('dialog');
    expect(repo.peekSignalBrief).not.toHaveBeenCalled();
    expect(repo.researchSignalBrief).not.toHaveBeenCalled();
    expect(screen.queryByText(/Writing the full report/)).not.toBeInTheDocument();
  });
});
