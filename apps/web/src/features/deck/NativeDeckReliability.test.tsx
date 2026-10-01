import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type {
  CardWithCompany,
  DeckRefreshListener,
  Market,
  MarketIntelRepository,
  NativeResearchEvent,
  NativeResearchRun,
  NativeResearchStart,
} from '@mi/contracts';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { useMarkets } from '@/hooks/data';
import { useApiKey } from '@/lib/settings/apiKey';
import NativeDeckCreate from './NativeDeckCreate';
import NativeDeckPage from './NativeDeckPage';

const DRAFT = 'mi.native.scope-draft';
const at = '2026-10-01T12:00:00.000Z';
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
  const state = { runs: initialRuns, events: [] as NativeResearchEvent[] };
  const api = {
    storageMode: 'native' as const,
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
    listCards: vi.fn(async () => []),
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
  for (const qc of clients.splice(0)) qc.clear();
  expect(fetch).not.toHaveBeenCalled();
  Reflect.deleteProperty(window, 'mi');
  useApiKey.setState({ apiKey: '', hasKey: false });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
