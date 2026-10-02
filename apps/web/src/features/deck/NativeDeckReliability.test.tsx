import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type {
  CardWithCompany,
  DeckRefreshListener,
  Market,
  MarketIntelRepository,
  NativeCardEvidence,
  NativeResearchEvent,
  NativeResearchRun,
  NativeResearchStart,
} from '@mi/contracts';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { useMarkets } from '@/hooks/data';
import { useApiKey } from '@/lib/settings/apiKey';
import { qk } from '@/lib/query/keys';
import NativeDeckCreate from './NativeDeckCreate';
import NativeDeckPage from './NativeDeckPage';

const DRAFT = 'mi.native.scope-draft';
const at = '2026-10-01T12:00:00.000Z';
const syntheticText =
  'Synthetic source text — not live research. Alder Works schedules repairs. Birch Works supplies repair tooling. This page is a fictional retained source for recovery tests, not evidence of real companies or numeric claims.';
const clients: QueryClient[] = [];
function client() {
  const value = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  });
  clients.push(value);
  return value;
}
function request(
  requestKey = 'reviewed-key',
  goal = 'Frontier AI alternatives',
): NativeResearchStart {
  return {
    requestKey,
    scope: { goal, inclusions: [], exclusions: [], region: null, depth: 'quick', seeds: [] },
    maxCompanies: 12,
    limits: { maxRequests: 315, maxInputTokens: 2_000_000, maxOutputTokens: 300_000 },
  };
}
function run(
  number = 1,
  status: NativeResearchRun['status'] = 'running',
  input = request(),
): NativeResearchRun {
  return {
    ...input,
    id: `run-${number}`,
    marketId: `market-${number}`,
    deckId: `deck-${number}`,
    requestFingerprint: 'fixture-fingerprint',
    status,
    generation: 0,
    usage: { requests: 0, inputTokens: 0, outputTokens: 0, complete: true },
    createdAt: at,
    updatedAt: at,
    error: null,
  };
}
function event(sequence: number): NativeResearchEvent {
  return {
    sequence,
    createdAt: at,
    progress: {
      message: `Saved activity ${sequence}`,
      kind: 'step',
      card: { card: { summary: 'Large saved card body '.repeat(1000) } } as CardWithCompany,
    },
  };
}
function bridge(initialRuns: NativeResearchRun[] = []) {
  const listeners = new Set<DeckRefreshListener>();
  const state = {
    runs: initialRuns,
    events: [] as NativeResearchEvent[],
    cards: [] as CardWithCompany[],
    savedIds: new Set<string>(),
  };
  const api = {
    storageMode: 'native' as const,
    listSavedCards: vi.fn(async () =>
      state.cards.filter((entry) => state.savedIds.has(entry.card.id)),
    ),
    saveCard: vi.fn(async (cardId: string) => {
      state.savedIds.add(cardId);
      return { cardId, savedAt: at };
    }),
    unsaveCard: vi.fn(async (cardId: string) => {
      state.savedIds.delete(cardId);
    }),
    listNativeRuns: vi.fn(async () => [...state.runs]),
    startNativeResearch: vi.fn(async (input: NativeResearchStart) => {
      const existing = state.runs.find((item) => item.requestKey === input.requestKey);
      if (existing) return existing;
      const accepted = run(state.runs.length + 1, 'running', input);
      state.runs.push(accepted);
      return accepted;
    }),
    controlNativeRun: vi.fn(async (id: string, command: 'pause' | 'resume' | 'cancel') => {
      const current = state.runs.find((item) => item.id === id)!;
      current.status =
        command === 'pause' ? 'paused' : command === 'cancel' ? 'cancelled' : 'running';
      return { ...current };
    }),
    nativeRunEvents: vi.fn(async (_id: string, after: number) =>
      state.events.filter((item) => item.sequence > after),
    ),
    onDeckRefresh: vi.fn((listener: DeckRefreshListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
  };
  const markets = (): Market[] =>
    state.runs.map((item) => ({
      id: item.marketId,
      name: `${item.scope.goal} (${item.id})`,
      createdAt: at,
      refreshCadence: 'weekly',
      scopeDefinition: { vertical: item.scope.goal, geography: item.scope.region, notes: null },
    }));
  const repository = {
    listMarkets: vi.fn(async () => markets()),
    getMarket: vi.fn(async (id: string) => markets().find((item) => item.id === id) ?? null),
    getDeckByMarket: vi.fn(async (id: string) => {
      const found = state.runs.find((item) => item.marketId === id);
      return found
        ? { id: found.deckId, marketId: id, createdAt: at, lastRefreshedAt: null }
        : null;
    }),
    listCards: vi.fn(async (deckId: string) =>
      state.cards.filter((item) => item.card.deckId === deckId),
    ),
  };
  Object.defineProperty(window, 'mi', { configurable: true, value: api });
  return {
    api,
    state,
    repository,
    notify(current = state.runs[0]!) {
      for (const listener of listeners)
        listener({
          marketId: current.marketId,
          deckId: current.deckId,
          refreshedAt: at,
          addedCardIds: [],
          updatedCardIds: [],
          prunedCardIds: [],
        });
    },
    listeners,
  };
}
type Bridge = ReturnType<typeof bridge>;
function LibraryProbe() {
  const markets = useMarkets();
  const location = useLocation();
  return (
    <aside>
      <Link to="/new">New research</Link>
      <output data-testid="location">{location.pathname}</output>
      <ul aria-label="Library decks">
        {markets.data?.map((market) => (
          <li key={market.id}>
            <Link to={`/markets/${market.id}/deck`}>{market.name}</Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}
function mount(native: Bridge, qc = client(), route = '/new') {
  const rendered = render(
    <RepositoryProvider repository={native.repository as unknown as MarketIntelRepository}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[route]}>
          <LibraryProbe />
          <Routes>
            <Route path="/new" element={<NativeDeckCreate />} />
            <Route path="/markets/:marketId/deck" element={<NativeDeckPage />} />
            <Route path="/library" element={<h1>Library</h1>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </RepositoryProvider>,
  );
  return { ...rendered, qc, user: userEvent.setup() };
}
function storedDraft() {
  return JSON.parse(localStorage.getItem(DRAFT)!) as {
    goal: string;
    reviewed: NativeResearchStart | null;
    submitted: boolean;
  };
}
async function review(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByRole('textbox', { name: 'Market and research question' }),
    'Frontier AI alternatives',
  );
  await user.click(screen.getByRole('button', { name: 'Review scope' }));
}

beforeEach(() => {
  localStorage.clear();
  useApiKey.setState({ apiKey: '', hasKey: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('No provider calls in native UI tests');
    }),
  );
});
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  for (const qc of clients.splice(0)) qc.clear();
  expect(fetch).not.toHaveBeenCalled();
  Reflect.deleteProperty(window, 'mi');
  useApiKey.setState({ apiKey: '', hasKey: false });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function savedCard(): CardWithCompany {
  return {
    card: {
      id: 'card-1',
      deckId: 'deck-1',
      companyId: 'company-1',
      cardType: 'company',
      title: 'Saved company',
      summary: 'Saved market relevance.',
      tier: null,
      tierReason: null,
      citations: [{ url: 'https://fixture.invalid/source', title: 'Saved source lead' }],
      keyPoints: [],
      createdAt: at,
    },
    company: {
      id: 'company-1',
      name: 'Saved company',
      oneLiner: 'Offline purpose.',
      hqLocation: null,
      logoUrl: null,
      websiteUrl: null,
      brandTheme: null,
    },
    metrics: [],
    viceClaims: [],
  };
}
function source(
  overrides: Partial<NativeCardEvidence['sources'][number]> = {},
): NativeCardEvidence['sources'][number] {
  return {
    url: 'https://fixture.invalid/source',
    title: 'Retained public page',
    retrievalStatus: 'retrieved',
    fetchedAt: at,
    text: 'A saved plain text passage.',
    sourceId: 'source-1',
    sourceRevision: 1,
    passageId: 'passage-1',
    support: 'unreviewed',
    ...overrides,
  };
}
function evidenceBridge(sources = [source()], status: NativeResearchRun['status'] = 'completed') {
  const native = bridge([run(1, status)]);
  native.state.cards = [savedCard()];
  const read = vi.fn(async (): Promise<NativeCardEvidence> => ({ cardId: 'card-1', sources }));
  // These forbidden write paths make the reader's saved-read-only contract observable.
  const capture = vi.fn(() => {
    throw new Error('Reader must not capture a page');
  });
  Object.assign(native.api, { getNativeCardEvidence: read, captureSource: capture });
  return { ...native, read, capture };
}

describe('explicit source capture allowance', () => {
  it('reviews and persists a separate 12-source ceiling before dispatch', async () => {
    const native = bridge();
    const { user } = mount(native);
    await review(user);
    expect(screen.getByText(/12 source requests/)).toBeVisible();
    expect(screen.getByText(/public pages during research.*at most 2.*per company/i)).toBeVisible();
    expect(storedDraft().reviewed?.limits.maxSourceRequests).toBe(12);
    expect(native.api.startNativeResearch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Approve and start research' }));
    await screen.findByRole('button', { name: 'Pause' });
    expect(native.api.startNativeResearch.mock.calls[0]![0].limits).toEqual({
      maxRequests: 315,
      maxInputTokens: 2_000_000,
      maxOutputTokens: 300_000,
      maxSourceRequests: 12,
    });
  });

  it('does not add source approval to an older unconfirmed request on reload/retry', async () => {
    const native = bridge();
    const old = request();
    localStorage.setItem(
      DRAFT,
      JSON.stringify({ goal: old.scope.goal, reviewed: old, submitted: true }),
    );
    const { user } = mount(native);
    await screen.findByText(/previous start is not confirmed/i);
    expect(screen.getByText(/No public page capture was approved/)).toBeVisible();
    expect(storedDraft().reviewed).toEqual(old);
    await user.click(screen.getByRole('button', { name: 'Approve and start research' }));
    await screen.findByRole('button', { name: 'Pause' });
    expect(native.api.startNativeResearch.mock.calls[0]![0]).toEqual(old);
    expect(native.api.startNativeResearch.mock.calls[0]![0].limits).not.toHaveProperty(
      'maxSourceRequests',
    );
  });

  it.each([undefined, 0, 3])(
    'reports source attempts %s separately without inventing dollars',
    async (count) => {
      const current = run(1, 'completed');
      current.usage.requests = 7;
      if (count !== undefined) current.usage.sourceRequests = count;
      mount(bridge([current]), client(), '/markets/market-1/deck');
      const usage = await screen.findByText(/7 provider attempts/);
      expect(usage).toHaveTextContent(
        count === undefined ? 'Source attempts not recorded' : `${count} source attempts`,
      );
      expect(usage).toHaveTextContent('Dollar cost not available');
    },
  );
});

describe('native saved source reader', () => {
  it('labels a failed capture timestamp as an attempt, not a successful capture', async () => {
    const native = evidenceBridge([source({ retrievalStatus: 'failed', text: null })]);
    mount(native, client(), '/markets/market-1/deck?card=card-1');
    const dialog = within(await screen.findByRole('dialog'));
    await dialog.findByText('Capture failed · no retained text');
    expect(dialog.getByText(/^Attempted:/)).toBeVisible();
    expect(dialog.queryByText(/^Captured:/)).not.toBeInTheDocument();
  });
  it('keeps large source lists compact and expands saved links without fetching pages', async () => {
    const native = evidenceBridge(
      Array.from({ length: 7 }, (_, index) =>
        source({
          url: `https://fixture.invalid/source-${index}`,
          title: `Evidence page ${index + 1}`,
          retrievalStatus: index === 6 ? 'failed' : 'retrieved',
          text: index === 6 ? null : 'Retained passage.',
        }),
      ),
    );
    const { user } = mount(native, client(), '/markets/market-1/deck?card=card-1');
    const dialog = within(await screen.findByRole('dialog'));
    await dialog.findByRole('link', { name: 'Evidence page 1' });
    expect(dialog.queryByRole('link', { name: 'Evidence page 7' })).not.toBeInTheDocument();
    expect(
      dialog.getByText('7 source links · 6 with retained text · 1 capture failed or blocked'),
    ).toBeVisible();
    await user.click(dialog.getByRole('button', { name: 'Show all 7 source links' }));
    expect(dialog.getByRole('link', { name: 'Evidence page 7' })).toBeVisible();
    await user.click(dialog.getByRole('button', { name: 'Show fewer source links' }));
    expect(dialog.queryByRole('link', { name: 'Evidence page 7' })).not.toBeInTheDocument();
    expect(native.read).toHaveBeenCalledTimes(1);
    expect(native.capture).not.toHaveBeenCalled();
    expect(native.api.startNativeResearch).not.toHaveBeenCalled();
  });
  it('shows retained brief sections keyless from the deck without restarting sources or invoking dashboard research', async () => {
    const native = evidenceBridge();
    native.state.cards[0]!.researchBrief = {
      sections: [
        {
          section: 'overview',
          blocks: [
            {
              id: 'overview',
              text: 'Saved overview draft.',
              kind: 'reported',
              support: 'unreviewed',
              timeWindow: null,
              citations: [{ title: 'Own overview lead', url: 'https://fixture.invalid/overview' }],
            },
          ],
        },
        {
          section: 'offering',
          blocks: [
            {
              id: 'offering',
              text: 'Saved offering analysis.',
              kind: 'analysis',
              support: 'unreviewed',
              timeWindow: null,
              citations: [],
            },
          ],
        },
        {
          section: 'position',
          blocks: [
            {
              id: 'position',
              text: 'Saved position estimate.',
              kind: 'estimate',
              support: 'unreviewed',
              timeWindow: null,
              citations: [],
              method: 'Illustrative scope comparison.',
              assumptions: ['No observed figures.'],
            },
          ],
        },
        {
          section: 'updates',
          blocks: [
            {
              id: 'updates',
              text: 'Saved dated update draft.',
              kind: 'reported',
              support: 'unreviewed',
              timeWindow: 'September 2026',
              citations: [{ title: 'Own update lead', url: 'https://fixture.invalid/update' }],
            },
          ],
        },
      ],
      openQuestions: ['What remains unobserved?'],
      limitations: ['These are retained drafts, not verified support.'],
    };
    const dashboard = vi.fn(() => {
      throw new Error('No dashboard research on reader open');
    });
    Object.assign(native.api, { getDashboardTab: dashboard, nativeResearchWritable: false });
    useApiKey.setState({ hasKey: false });
    const { user } = mount(native, client(), '/markets/market-1/deck');
    await user.click(await screen.findByRole('button', { name: 'Saved company — Company card' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(await dialog.findByText('Saved overview draft.')).toBeVisible();
    await user.click(await dialog.findByRole('button', { name: 'Show retained text' }));
    for (const label of ['Products & business', 'Market position', 'Updates', 'Overview'])
      await user.click(dialog.getByRole('tab', { name: label }));
    expect(dialog.getByText('A saved plain text passage.')).toBeVisible();
    expect(dialog.getByText('Reported draft · unreviewed')).toBeVisible();
    expect(dialog.getByRole('link', { name: 'Own overview lead' })).toHaveAttribute(
      'href',
      'https://fixture.invalid/overview',
    );
    expect(native.read).toHaveBeenCalledTimes(1);
    expect(native.capture).not.toHaveBeenCalled();
    expect(native.api.startNativeResearch).not.toHaveBeenCalled();
    expect(dashboard).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(
      await screen.findByRole('button', { name: 'Saved company — Company card' }),
    ).toHaveFocus();
  });

  it('keeps an older missing brief honest and does not backfill it on open', async () => {
    const native = evidenceBridge();
    const { user } = mount(native, client(), '/markets/market-1/deck');
    await user.click(await screen.findByRole('button', { name: 'Saved company — Company card' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(await dialog.findByText('Research brief not retained')).toBeVisible();
    expect(dialog.queryByRole('tab')).not.toBeInTheDocument();
    expect(native.state.cards[0]).not.toHaveProperty('researchBrief');
    expect(native.api.startNativeResearch).not.toHaveBeenCalled();
    expect(native.capture).not.toHaveBeenCalled();
  });

  it('saves only after an explicit reader action and a confirmed receipt, never on card open', async () => {
    const native = evidenceBridge();
    let finish!: () => void;
    native.api.saveCard.mockImplementationOnce(
      (cardId) =>
        new Promise((resolve) => {
          finish = () => {
            native.state.savedIds.add(cardId);
            resolve({ cardId, savedAt: at });
          };
        }),
    );
    const { user, qc } = mount(native, client(), '/markets/market-1/deck');
    await user.click(await screen.findByRole('button', { name: 'Saved company — Company card' }));
    const dialog = within(await screen.findByRole('dialog'));
    const save = await dialog.findByRole('button', { name: 'Save card' });
    await waitFor(() => expect(save).toBeEnabled());
    expect(native.api.saveCard).not.toHaveBeenCalled();
    await user.click(save);
    expect(save).toBeDisabled();
    expect(dialog.queryByText('Card saved to your collection.')).not.toBeInTheDocument();
    expect(qc.getQueryData(qk.savedCards)).toEqual([]);
    await user.click(save);
    expect(native.api.saveCard).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(await dialog.findByRole('button', { name: 'Remove from saved' })).toBeEnabled();
    expect(qc.getQueryData(qk.savedCards)).toEqual([native.state.cards[0]]);
    expect(native.api.saveCard).toHaveBeenCalledWith('card-1');
    expect(native.api.startNativeResearch).not.toHaveBeenCalled();
    expect(native.capture).not.toHaveBeenCalled();
  });

  it.each(['rejected', 'wrong card receipt'] as const)(
    'keeps save failures honest for %s',
    async (mode) => {
      const native = evidenceBridge();
      if (mode === 'rejected')
        native.api.saveCard.mockRejectedValueOnce(new Error('Collection write failed'));
      else native.api.saveCard.mockResolvedValueOnce({ cardId: 'other-card', savedAt: at });
      const { user } = mount(native, client(), '/markets/market-1/deck');
      await user.click(await screen.findByRole('button', { name: 'Saved company — Company card' }));
      const dialog = within(await screen.findByRole('dialog'));
      const save = await dialog.findByRole('button', { name: 'Save card' });
      await waitFor(() => expect(save).toBeEnabled());
      await user.click(save);
      expect(await dialog.findByRole('alert')).toHaveTextContent(/could not be saved/i);
      expect(dialog.queryByText('Card saved to your collection.')).not.toBeInTheDocument();
      expect(save).toBeEnabled();
      expect(native.state.savedIds.size).toBe(0);
    },
  );

  it.each([false, true])(
    'keeps reader actions read-only and keyless when already saved is %s',
    async (alreadySaved) => {
      const native = evidenceBridge();
      if (alreadySaved) native.state.savedIds.add('card-1');
      Object.assign(native.api, { nativeResearchWritable: false });
      useApiKey.setState({ hasKey: false });
      const { user } = mount(native, client(), '/markets/market-1/deck');
      await user.click(await screen.findByRole('button', { name: 'Saved company — Company card' }));
      const dialog = within(await screen.findByRole('dialog'));
      expect(
        await dialog.findByRole('button', {
          name: alreadySaved ? 'Remove from saved' : 'Save card',
        }),
      ).toBeDisabled();
      expect(
        dialog.getByText(
          /Collection changes are disabled.*Saved cards and sources remain readable/,
        ),
      ).toBeVisible();
      await user.click(dialog.getByRole('button', { name: 'Show retained text' }));
      expect(dialog.getByText('A saved plain text passage.')).toBeVisible();
      expect(native.api.saveCard).not.toHaveBeenCalled();
      expect(native.api.unsaveCard).not.toHaveBeenCalled();
    },
  );

  it('reads retained evidence lazily offline, expands plain text, and restores card focus/filter on Escape', async () => {
    const native = evidenceBridge([source({ text: syntheticText })]);
    Object.assign(native.api, { researchProvenance: 'synthetic_fixture' });
    const initialUsage = { ...native.state.runs[0]!.usage };
    const { user } = mount(native, client(), '/markets/market-1/deck?type=company');
    const opener = await screen.findByRole('button', { name: 'Saved company — Company card' });
    expect(native.read).not.toHaveBeenCalled();
    onlineManager.setOnline(false);
    await user.click(opener);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Retained public page');
    expect(native.read).toHaveBeenCalledTimes(1);
    expect(native.read).toHaveBeenCalledWith('card-1');
    expect(within(dialog).getByText('Retrieved · support unreviewed')).toBeVisible();
    const date = within(dialog).getByTitle(at);
    expect(date).toHaveAttribute('datetime', at);
    expect(date).not.toHaveTextContent(at);
    expect(date.textContent).toContain('2026');
    expect(within(dialog).queryByText(syntheticText)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Show retained text' }));
    expect(within(dialog).getByText(syntheticText)).toBeVisible();
    expect(within(dialog).getByText(/Synthetic fixture material · no live research/)).toBeVisible();
    expect(within(dialog).getByRole('link', { name: 'Retained public page' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Company', pressed: true })).toBeVisible();
    await user.click(opener);
    const reopened = within(await screen.findByRole('dialog'));
    await reopened.findByText('Retained public page');
    await user.click(reopened.getByRole('button', { name: 'Show retained text' }));
    expect(reopened.getByText(syntheticText)).toBeVisible();
    expect(native.read).toHaveBeenCalledTimes(1);
    expect(native.state.runs[0]!.usage).toEqual(initialUsage);
    expect(native.capture).not.toHaveBeenCalled();
    expect(native.api.startNativeResearch).not.toHaveBeenCalled();
    expect(native.api.controlNativeRun).not.toHaveBeenCalled();
  });

  it.each([
    ['lead_only', 'Lead only · not captured'],
    ['failed', 'Capture failed · no retained text'],
    ['blocked', 'Capture blocked · no retained text'],
  ] as const)(
    'distinguishes %s without offering text or implying verification',
    async (retrievalStatus, label) => {
      const native = evidenceBridge([
        source({
          retrievalStatus,
          fetchedAt: null,
          text: null,
          sourceId: null,
          sourceRevision: null,
          passageId: null,
        }),
      ]);
      const { user } = mount(native, client(), '/markets/market-1/deck');
      await user.click(await screen.findByRole('button', { name: 'Saved company — Company card' }));
      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText(label)).toBeVisible();
      expect(
        within(dialog).queryByRole('button', { name: 'Show retained text' }),
      ).not.toBeInTheDocument();
      expect(within(dialog).getByText('No capture date recorded')).toBeVisible();
      expect(native.capture).not.toHaveBeenCalled();
    },
  );

  it('labels partial text and renders hostile HTML/markdown literally, with unsafe URLs unlinked', async () => {
    const text =
      '<script>window.paidCall()</script> <img src=x onerror=alert(1)> [Pay](javascript:alert(1))';
    const native = evidenceBridge([
      source({ retrievalStatus: 'partial', text }),
      source({ url: 'javascript:alert(1)', title: 'Unsafe URL' }),
      source({ url: 'https://name:secret@fixture.invalid/', title: 'Credential URL' }),
    ]);
    const { user } = mount(native, client(), '/markets/market-1/deck');
    await user.click(await screen.findByRole('button', { name: 'Saved company — Company card' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Partial capture · support unreviewed');
    await user.click(within(dialog).getAllByRole('button', { name: 'Show retained text' })[0]!);
    expect(within(dialog).getByText(text)).toBeVisible();
    expect(dialog.querySelector('script, img')).toBeNull();
    expect(within(dialog).queryByRole('link', { name: 'Pay' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: 'Unsafe URL' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: 'Credential URL' })).not.toBeInTheDocument();
    expect(native.capture).not.toHaveBeenCalled();
  });

  it.each(['missing bridge', 'failed read', 'empty evidence'] as const)(
    'keeps citation leads honest for %s',
    async (mode) => {
      const native = evidenceBridge([]);
      if (mode === 'missing bridge') Reflect.deleteProperty(native.api, 'getNativeCardEvidence');
      if (mode === 'failed read')
        native.read.mockRejectedValue(new Error('Vault read unavailable'));
      const { user } = mount(native, client(), '/markets/market-1/deck');
      await user.click(await screen.findByRole('button', { name: 'Saved company — Company card' }));
      const dialog = await screen.findByRole('dialog');
      await within(dialog).findByRole('link', { name: 'Saved source lead' });
      expect(within(dialog).getByText('Lead only · not captured')).toBeVisible();
      expect(
        within(dialog).queryByRole('button', { name: 'Show retained text' }),
      ).not.toBeInTheDocument();
      if (mode === 'failed read')
        expect(await within(dialog).findByRole('alert')).toHaveTextContent(
          /Saved source evidence could not be read/,
        );
      if (mode === 'missing bridge') expect(native.read).not.toHaveBeenCalled();
      expect(native.capture).not.toHaveBeenCalled();
    },
  );

  it('rejects a saved evidence response bound to a different card', async () => {
    const native = evidenceBridge();
    native.read.mockResolvedValue({
      cardId: 'other-card',
      sources: [source({ text: 'Wrong card passage' })],
    });
    const { user } = mount(native, client(), '/markets/market-1/deck');
    await user.click(await screen.findByRole('button', { name: 'Saved company — Company card' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /Saved source evidence could not be read/,
    );
    expect(within(dialog).getByText('Lead only · not captured')).toBeVisible();
    expect(
      within(dialog).queryByRole('button', { name: 'Show retained text' }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Wrong card passage')).not.toBeInTheDocument();
    expect(native.capture).not.toHaveBeenCalled();
  });

  it('retains already saved text and its exact capture date when a subsequent local read fails', async () => {
    const native = evidenceBridge([source({ text: syntheticText })]);
    const { user, qc } = mount(native, client(), '/markets/market-1/deck');
    await user.click(await screen.findByRole('button', { name: 'Saved company — Company card' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Retrieved · support unreviewed');
    await user.click(within(dialog).getByRole('button', { name: 'Show retained text' }));
    native.read.mockRejectedValueOnce(new Error('Temporary vault read failure'));
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['native-card-evidence', 'card-1'] });
    });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /previously retained text remain available/,
    );
    expect(within(dialog).getByText(syntheticText)).toBeVisible();
    expect(within(dialog).getByTitle(at)).toHaveAttribute('datetime', at);
    expect(native.capture).not.toHaveBeenCalled();
    expect(native.api.startNativeResearch).not.toHaveBeenCalled();
  });

  it('polls saved evidence while research is active and retains its final text after completion', async () => {
    const native = evidenceBridge(
      [
        source({
          retrievalStatus: 'lead_only',
          fetchedAt: null,
          text: null,
          sourceId: null,
          sourceRevision: null,
          passageId: null,
        }),
      ],
      'running',
    );
    const { user } = mount(native, client(), '/markets/market-1/deck');
    await user.click(await screen.findByRole('button', { name: 'Saved company — Company card' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Lead only · not captured');
    native.read.mockResolvedValue({ cardId: 'card-1', sources: [source()] });
    await within(dialog).findByText('Retrieved · support unreviewed', {}, { timeout: 2500 });
    expect(native.read.mock.calls.length).toBeGreaterThan(1);
    native.state.runs[0] = { ...native.state.runs[0]!, status: 'completed' };
    await act(async () => native.notify());
    await screen.findByText('Research completed');
    await waitFor(() => expect(native.read.mock.results.at(-1)?.type).toBe('return'));
    const count = native.read.mock.calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });
    expect(native.read).toHaveBeenCalledTimes(count);
    await user.click(within(dialog).getByRole('button', { name: 'Show retained text' }));
    expect(within(dialog).getByText('A saved plain text passage.')).toBeVisible();
    expect(native.capture).not.toHaveBeenCalled();
    expect(native.api.startNativeResearch).not.toHaveBeenCalled();
  });
});

describe('native run acceptance and notifications', () => {
  it('creates two consecutive decks with controls and Library entries despite a cached terminal run', async () => {
    const native = bridge();
    const { user, qc } = mount(native);
    await review(user);
    await user.click(screen.getByRole('button', { name: 'Approve and start research' }));
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeEnabled();
    expect(
      screen.getByRole('link', { name: 'Frontier AI alternatives (run-1)' }),
    ).toBeInTheDocument();
    const first = { ...native.state.runs[0]!, status: 'completed' as const };
    native.state.runs[0] = first;
    await act(async () => native.notify(first));
    await screen.findByText('Research completed');
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    expect(qc.getQueryData(['native-runs'])).toEqual([first]);

    await user.click(screen.getByRole('link', { name: 'New research' }));
    expect(screen.getByRole('button', { name: 'Review scope' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Review scope' }));
    await user.click(screen.getByRole('button', { name: 'Approve and start research' }));
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeEnabled();
    await screen.findByRole('link', { name: 'Frontier AI alternatives (run-2)' });
    expect(screen.getByTestId('location')).toHaveTextContent('/markets/market-2/deck');
    expect(native.api.startNativeResearch).toHaveBeenCalledTimes(2);
    const inputs = native.api.startNativeResearch.mock.calls.map(([input]) => input);
    expect(inputs[0]!.requestKey).not.toBe(inputs[1]!.requestKey);
    expect(inputs[0]!.scope).toEqual(inputs[1]!.scope);
    expect(qc.getQueryData<NativeResearchRun[]>(['native-runs'])).toHaveLength(2);
  });

  it('refreshes inactive terminal runs and Library on a notification while drafting', async () => {
    const first = run(1, 'completed');
    const native = bridge([first]);
    const qc = client();
    qc.setQueryData(['native-runs'], [first]);
    mount(native, qc);
    await screen.findByRole('link', { name: 'Frontier AI alternatives (run-1)' });
    const next = run(2, 'running', request('next-key', 'Another market'));
    native.state.runs.push(next);
    await act(async () => native.notify(next));
    await screen.findByRole('link', { name: 'Another market (run-2)' });
    expect(qc.getQueryState(['native-runs'])?.isInvalidated).toBe(true);
    expect(native.api.startNativeResearch).not.toHaveBeenCalled();
  });

  it('updates controls and Library after a control receipt', async () => {
    const native = bridge([run()]);
    const { user, qc } = mount(native, client(), '/markets/market-1/deck');
    await user.click(await screen.findByRole('button', { name: 'Pause' }));
    expect(await screen.findByRole('button', { name: 'Resume remaining work' })).toBeEnabled();
    expect(native.api.controlNativeRun).toHaveBeenCalledWith('run-1', 'pause');
    expect(qc.getQueryData<NativeResearchRun[]>(['native-runs'])?.[0]?.status).toBe('paused');
    expect(native.repository.listMarkets.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('reviewed request survives reload', () => {
  it('reconciles an accepted run after a lost response without a key or a second start', async () => {
    const native = bridge();
    let finish!: (accepted: NativeResearchRun) => void;
    native.api.startNativeResearch.mockImplementationOnce((input) => {
      expect(storedDraft()).toMatchObject({ reviewed: input, submitted: true });
      native.state.runs.push(run(1, 'running', input));
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const first = mount(native);
    await review(first.user);
    await first.user.click(screen.getByRole('button', { name: 'Approve and start research' }));
    const saved = storedDraft();
    expect(saved.submitted).toBe(true);
    expect(saved.reviewed).toEqual(native.api.startNativeResearch.mock.calls[0]![0]);
    expect(screen.getByRole('textbox', { name: 'Market and research question' })).toBeDisabled();
    first.unmount();
    useApiKey.setState({ hasKey: false });

    mount(native);
    await screen.findByRole('button', { name: 'Pause' });
    expect(screen.getByTestId('location')).toHaveTextContent('/markets/market-1/deck');
    expect(native.api.startNativeResearch).toHaveBeenCalledTimes(1);
    expect(native.state.runs).toHaveLength(1);
    expect(storedDraft()).toMatchObject({ reviewed: null, submitted: false });
    await act(async () => finish(native.state.runs[0]!));
    expect(storedDraft()).toMatchObject({ reviewed: null, submitted: false });
  });

  it('keeps the reviewed payload/key on an unconfirmed reload and only retries after approval', async () => {
    const native = bridge();
    native.api.startNativeResearch.mockRejectedValueOnce(new Error('Acceptance response lost'));
    const first = mount(native);
    await review(first.user);
    await first.user.type(
      screen.getByRole('textbox', { name: /Companies to include/ }),
      'Cohere\nCohere',
    );
    await first.user.type(screen.getByRole('textbox', { name: /Exclude/ }), 'Example');
    await first.user.type(screen.getByRole('textbox', { name: /Region/ }), 'Europe');
    await first.user.click(screen.getByRole('button', { name: 'Review scope' }));
    await first.user.click(screen.getByRole('button', { name: 'Approve and start research' }));
    await screen.findByRole('alert');
    const input = native.api.startNativeResearch.mock.calls[0]![0];
    expect(input.scope).toMatchObject({
      seeds: [{ name: 'Cohere' }],
      exclusions: ['Example'],
      region: 'Europe',
    });
    first.unmount();

    const reloaded = mount(native);
    await screen.findByText(/previous start is not confirmed/i);
    expect(native.api.startNativeResearch).toHaveBeenCalledTimes(1);
    expect(storedDraft().reviewed).toEqual(input);
    await reloaded.user.click(screen.getByRole('button', { name: 'Approve and start research' }));
    await screen.findByRole('button', { name: 'Pause' });
    expect(native.api.startNativeResearch.mock.calls[1]![0]).toEqual(input);
  });

  it('rotates the request key when the user changes a previously submitted scope', async () => {
    const native = bridge();
    native.api.startNativeResearch.mockRejectedValueOnce(new Error('Temporary connection failure'));
    const { user } = mount(native);
    await review(user);
    await user.click(screen.getByRole('button', { name: 'Approve and start research' }));
    await screen.findByRole('alert');
    const old = storedDraft().reviewed!;
    await user.type(screen.getByRole('textbox', { name: /Region/ }), 'Europe');
    expect(storedDraft()).toMatchObject({ reviewed: null, submitted: false });
    await user.click(screen.getByRole('button', { name: 'Review scope' }));
    expect(storedDraft().reviewed!.requestKey).not.toBe(old.requestKey);
    await user.click(screen.getByRole('button', { name: 'Approve and start research' }));
    await screen.findByRole('button', { name: 'Pause' });
    expect(native.api.startNativeResearch.mock.calls[1]![0].scope.region).toBe('Europe');
  });

  it('does not send research when the reviewed request cannot be persisted', async () => {
    const native = bridge();
    const { user } = mount(native);
    await review(user);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    await user.click(screen.getByRole('button', { name: 'Approve and start research' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No new request will be sent/);
    expect(native.api.startNativeResearch).not.toHaveBeenCalled();
  });
});

describe('incremental bounded native activity', () => {
  it('drains bounded pages even after the run has completed', async () => {
    const current = run(1, 'completed');
    const native = bridge([current]);
    native.state.events = Array.from({ length: 250 }, (_, index) => event(index + 1));
    native.api.nativeRunEvents.mockImplementation(async (_id, after) =>
      native.state.events.filter((entry) => entry.sequence > after).slice(0, 100),
    );
    const { qc } = mount(native, client(), '/markets/market-1/deck');
    await screen.findAllByText('Saved activity 250');
    expect(native.api.nativeRunEvents.mock.calls.map(([, after]) => after)).toEqual([0, 100, 200]);
    expect(qc.getQueryData(['native-events', current.id])).toMatchObject({ after: 250 });
    const log = qc.getQueryData<{ items: NativeResearchEvent[] }>(['native-events', current.id])!;
    expect(log.items).toHaveLength(200);
    expect(log.items[0]!.sequence).toBe(51);
  });

  it('replays new sequences into one run cache, deduplicates, caps retention and drops card bodies', async () => {
    const current = run(1, 'completed');
    const native = bridge([current]);
    native.state.events = Array.from({ length: 250 }, (_, index) => event(index + 1));
    const { user, qc } = mount(native, client(), '/markets/market-1/deck');
    await screen.findAllByText('Saved activity 250');
    type Log = { after: number; items: NativeResearchEvent[] };
    const log = () => qc.getQueryData<Log>(['native-events', current.id])!;
    expect(native.api.nativeRunEvents).toHaveBeenCalledWith(current.id, 0);
    expect(log().items).toHaveLength(200);
    expect(log().items[0]!.sequence).toBe(51);
    expect(log().items.every((entry) => !entry.progress.card)).toBe(true);

    native.api.nativeRunEvents.mockResolvedValueOnce([
      event(252),
      event(251),
      event(251),
      event(200),
    ]);
    native.state.runs[0] = { ...current, updatedAt: '2026-10-01T12:01:00.000Z' };
    await act(async () => native.notify());
    await screen.findAllByText('Saved activity 252');
    expect(native.api.nativeRunEvents).toHaveBeenLastCalledWith(current.id, 250);
    expect(log().after).toBe(252);
    expect(log().items).toHaveLength(200);
    expect(log().items.filter((entry) => entry.sequence === 251)).toHaveLength(1);
    expect(log().items.at(-1)!.sequence).toBe(252);
    expect(qc.getQueryCache().findAll({ queryKey: ['native-events', current.id] })).toHaveLength(1);

    await act(async () => native.notify());
    await waitFor(() =>
      expect(native.api.nativeRunEvents).toHaveBeenLastCalledWith(current.id, 252),
    );
    expect(log().after).toBe(252);
    await user.click(screen.getByRole('link', { name: '← Library' }));
    await user.click(screen.getByRole('link', { name: 'Frontier AI alternatives (run-1)' }));
    await waitFor(() =>
      expect(native.api.nativeRunEvents).toHaveBeenLastCalledWith(current.id, 252),
    );
    expect(native.api.nativeRunEvents.mock.calls.filter(([, after]) => after === 0)).toHaveLength(
      1,
    );
  });

  it('keeps its cursor and retained activity when an incremental read fails', async () => {
    const native = bridge([run(1, 'completed')]);
    native.state.events = [event(1)];
    const { user, qc } = mount(native, client(), '/markets/market-1/deck');
    await screen.findAllByText('Saved activity 1');
    await user.click(screen.getByText('Research activity'));
    native.api.nativeRunEvents.mockRejectedValueOnce(new Error('Temporary read failure'));
    await act(async () => native.notify());
    await screen.findByRole('alert');
    expect(qc.getQueryData(['native-events', 'run-1'])).toMatchObject({ after: 1 });
    native.state.events.push(event(2));
    await act(async () => native.notify());
    await waitFor(() =>
      expect(qc.getQueryData(['native-events', 'run-1'])).toMatchObject({ after: 2 }),
    );
    expect(native.api.nativeRunEvents).toHaveBeenLastCalledWith('run-1', 1);
  });
});

describe('trusted synthetic provenance', () => {
  it('keeps saved synthetic research readable but disables dispatch on a keyless reopen', async () => {
    const native = bridge([run(1, 'failed')]);
    Object.assign(native.api, {
      researchProvenance: 'synthetic_fixture',
      nativeResearchWritable: false,
    });
    const { user } = mount(native, client(), '/markets/market-1/deck');
    expect(await screen.findByRole('button', { name: 'Resume remaining work' })).toBeDisabled();
    expect(screen.getByText(/Saved results are still readable/)).toBeVisible();
    await user.click(screen.getByRole('link', { name: '← Library' }));
    await user.click(screen.getByRole('link', { name: 'New research' }));
    await user.type(screen.getByLabelText('Market and research question'), 'Synthetic scope');
    expect(screen.getByRole('button', { name: 'Review scope' })).toBeDisabled();
    expect(native.api.startNativeResearch).not.toHaveBeenCalled();
    expect(native.api.controlNativeRun).not.toHaveBeenCalled();
  });

  it('allows the exact fixture metadata without a key and labels create and deck as synthetic', async () => {
    const native = bridge();
    Object.assign(native.api, { researchProvenance: 'synthetic_fixture' });
    useApiKey.setState({ hasKey: false });
    const { user } = mount(native);
    expect(
      screen.getByText(/Synthetic fixture research.*No provider calls or live research/),
    ).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('button', { name: 'connect a Gemini key' })).not.toBeInTheDocument();
    await review(user);
    expect(screen.getByText(/synthetic responses, no web retrieval/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve and start research' }));
    await screen.findByRole('button', { name: 'Pause' });
    expect(
      screen.getByText(/Synthetic fixture research.*No provider calls or live research/),
    ).toBeInTheDocument();
    expect(useApiKey.getState().hasKey).toBe(false);
    expect(native.api.startNativeResearch).toHaveBeenCalledOnce();
  });

  it.each([undefined, 'fixture', 'synthetic_fixture_untrusted'])(
    'still requires a key for provenance %s',
    async (provenance) => {
      const native = bridge();
      Object.assign(native.api, { researchProvenance: provenance });
      useApiKey.setState({ hasKey: false });
      const { user } = mount(native);
      await review(user);
      expect(screen.getByRole('button', { name: 'Approve and start research' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'connect a Gemini key' })).toBeInTheDocument();
      expect(screen.queryByText(/Synthetic fixture research/)).not.toBeInTheDocument();
      expect(native.api.startNativeResearch).not.toHaveBeenCalled();
    },
  );
});
