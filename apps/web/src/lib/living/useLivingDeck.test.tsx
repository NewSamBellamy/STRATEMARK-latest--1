import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MockRepository, type SeedSnapshot } from '@mi/mocks';
import sample from '@/sample/frontier-snapshot.json';
import { createQueryClient } from '@/lib/query/queryClient';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { useApiKey } from '@/lib/settings/apiKey';
import { useLivingDeck } from './useLivingDeck';
import { LivingDeckRuntime } from './runtime';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { useSentinel } from '@/lib/agentic/useSentinel';
import { useResearchControl } from './researchControl';
import { qk } from '@/lib/query/keys';

it('refreshes saved and individual card evidence after an inconclusive background check', async () => {
  vi.useFakeTimers();
  useResearchControl.setState({ paused: false });
  const repository = new MockRepository({ seedSnapshot: sample as unknown as SeedSnapshot, latencyMs: 0 });
  const cards = (await repository.listCards(sample.decks[0]!.id)).filter(c => c.company && c.card.cardType === 'company').slice(0, 1);
  const companyId = cards[0]!.company!.id;
  cards[0]!.metrics = cards[0]!.metrics.map(m => ({ ...m, confidence: 'estimated', lastVerifiedAt: null, lastVerificationAttemptAt: null }));
  const verifyMetric = vi.fn().mockResolvedValue({ metric: cards[0]!.metrics[0]!, changed: false, verdict: 'unverified', citations: [] });
  const client = createQueryClient();
  const keys = [qk.cards('deck'), qk.card('card'), qk.savedCards, qk.companyMetrics(companyId)];
  for (const key of keys) client.setQueryData(key, []);
  client.setQueryData(qk.dashboard(companyId, 'metrics'), []);
  const wrapper = ({ children }: { children: ReactNode }) => <RepositoryProvider repository={Object.assign(repository, { verifyMetric })}>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  </RepositoryProvider>;
  const { unmount } = renderHook(() => useLivingDeck(sample.decks[0]!.id, cards), { wrapper });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(verifyMetric).toHaveBeenCalledTimes(1);
  for (const key of keys) expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
  expect(client.getQueryState(qk.dashboard(companyId, 'metrics'))?.isInvalidated).toBe(false);
  unmount(); client.clear();
});

it('a figure re-checked in one session is not re-checked at once after a page reload', async () => {
  vi.useFakeTimers();
  useResearchControl.setState({ paused: false });
  const session = async () => {
    const repository = new MockRepository({ seedSnapshot: sample as unknown as SeedSnapshot, latencyMs: 0 });
    const cards = (await repository.listCards(sample.decks[0]!.id)).filter(c => c.company && c.card.cardType === 'company').slice(0, 1);
    cards[0]!.metrics = cards[0]!.metrics.map(m => ({ ...m, confidence: 'estimated', lastVerifiedAt: null, lastVerificationAttemptAt: null }));
    const verifyMetric = vi.fn().mockResolvedValue({ metric: cards[0]!.metrics[0]!, changed: false, verdict: 'unverified', citations: [] });
    const client = createQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <RepositoryProvider repository={Object.assign(repository, { verifyMetric })}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </RepositoryProvider>;
    const { unmount } = renderHook(() => useLivingDeck(sample.decks[0]!.id, cards), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    unmount(); client.clear();
    return verifyMetric.mock.calls.map(([input]) => `${(input as { companyId: string }).companyId}:${(input as { metricType: string }).metricType}`);
  };
  const first = await session();
  expect(first).toHaveLength(1);
  // A reload: new repository handle, same browser storage. Whatever else is due, this figure is not.
  expect(await session()).not.toContain(first[0]);
  // Half an hour on, the figure is due its check again.
  vi.setSystemTime(new Date(Date.now() + 31 * 60_000));
  expect(await session()).toContain(first[0]);
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); localStorage.clear(); useApiKey.setState({ apiKey: '', hasKey: false }); act(() => useResearchControl.setState({ paused: false, storageError: null })); });
describe('shared background research pause', () => {
  it('does not dispatch refreshes or briefings if pause happens during a scheduled read', async () => {
    vi.useFakeTimers();
    const repository = new MockRepository({ latencyMs: 0 });
    const markets = await repository.listMarkets();
    const pending: Array<() => void> = [];
    vi.spyOn(repository, 'listMarkets').mockImplementation(() => new Promise(resolve => { pending.push(() => resolve(markets)); }));
    const refreshDeck = vi.spyOn(repository, 'refreshDeck');
    const generateDeckBriefing = vi.fn();
    const getDeck = vi.spyOn(repository, 'getDeckByMarket');
    const wrapper = ({ children }: { children: ReactNode }) => <RepositoryProvider repository={Object.assign(repository, {
      generateDeckBriefing, listDeckBriefings: vi.fn().mockResolvedValue([]),
    })}><QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider></RepositoryProvider>;
    renderHook(() => { useAutoRefresh(); useSentinel(); }, { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(pending).toHaveLength(2);
    await act(async () => { useResearchControl.getState().setPaused(true); pending.forEach(finish => finish()); });
    expect(getDeck).not.toHaveBeenCalled();
    expect(refreshDeck).not.toHaveBeenCalled();
    expect(generateDeckBriefing).not.toHaveBeenCalled();
  });
  it('suppresses scheduled refresh and briefing checks while paused', async () => {
    vi.useFakeTimers();
    useResearchControl.getState().setPaused(true);
    const repository = new MockRepository({ latencyMs: 0 });
    const listMarkets = vi.spyOn(repository, 'listMarkets');
    const wrapper = ({ children }: { children: ReactNode }) => <RepositoryProvider repository={Object.assign(repository, {
      generateDeckBriefing: vi.fn(), listDeckBriefings: vi.fn().mockResolvedValue([]),
    })}><QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider></RepositoryProvider>;
    renderHook(() => { useAutoRefresh(); useSentinel(); }, { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(listMarkets).not.toHaveBeenCalled();
  });
  it('survives deck remount and permits explicit resume without an automatic first turn', async () => {
    vi.useFakeTimers();
    const repository = new MockRepository({ seedSnapshot: sample as unknown as SeedSnapshot, latencyMs: 0 });
    const cards = await repository.listCards(sample.decks[0]!.id);
    const verifyMetric = vi.fn().mockRejectedValue(new Error('test only'));
    const getDashboardTab = vi.spyOn(repository, 'getDashboardTab');
    const client = createQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <RepositoryProvider repository={Object.assign(repository, { verifyMetric })}><QueryClientProvider client={client}>{children}</QueryClientProvider></RepositoryProvider>;
    const first = renderHook(() => useLivingDeck(sample.decks[0]!.id, cards), { wrapper });
    act(() => first.result.current.pause());
    first.unmount();
    const reopened = renderHook(() => useLivingDeck(sample.decks[0]!.id, cards), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(reopened.result.current.status).toBe('paused');
    expect(verifyMetric).not.toHaveBeenCalled();
    expect(getDashboardTab).not.toHaveBeenCalled();
    act(() => reopened.result.current.resume());
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(verifyMetric.mock.calls.length + getDashboardTab.mock.calls.length).toBe(1);
  });
});
describe('keyless desktop browsing', () => {
  it('does not schedule automatic refresh or briefings without a user key', async () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_DESKTOP', '1');
    useApiKey.setState({ apiKey: '', hasKey: false });
    const repository = new MockRepository({ latencyMs: 0 });
    const liveRepository = Object.assign(repository, { generateDeckBriefing: vi.fn(), listDeckBriefings: vi.fn().mockResolvedValue([]) });
    const listMarkets = vi.spyOn(repository, 'listMarkets');
    const wrapper = ({ children }: { children: ReactNode }) => <RepositoryProvider repository={liveRepository}><QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider></RepositoryProvider>;
    renderHook(() => { useAutoRefresh(); useSentinel(); }, { wrapper });
    await vi.advanceTimersByTimeAsync(10000);
    expect(listMarkets).not.toHaveBeenCalled();
  });
  it('does not start background model research without a user key', async () => {
    vi.stubEnv('VITE_DESKTOP', '1');
    useApiKey.setState({ apiKey: '', hasKey: false });
    const repository = new MockRepository({ seedSnapshot: sample as unknown as SeedSnapshot, latencyMs: 0 });
    const liveRepository = Object.assign(repository, { verifyMetric: vi.fn() });
    const start = vi.spyOn(LivingDeckRuntime.prototype, 'start');
    const cards = await repository.listCards(sample.decks[0]!.id);
    const wrapper = ({ children }: { children: ReactNode }) => <RepositoryProvider repository={liveRepository}><QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider></RepositoryProvider>;
    const { result } = renderHook(() => useLivingDeck(sample.decks[0]!.id, cards), { wrapper });
    expect(result.current.canVerify).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });
});

describe('the consistency audit judges what the card face shows', () => {
  const run = async (ownership: unknown) => {
    vi.useFakeTimers();
    useResearchControl.setState({ paused: false });
    const repository = new MockRepository({ seedSnapshot: sample as unknown as SeedSnapshot, latencyMs: 0 });
    const cards = (await repository.listCards(sample.decks[0]!.id)).filter(c => c.company && c.card.cardType === 'company').slice(0, 1);
    const base = cards[0]!.metrics[0]!;
    const now = new Date().toISOString();
    const row = (metricType: string, value: number) => ({
      ...base, id: `fixture_${metricType}`, metricType, value, confidence: 'verified', capturedAt: now, lastVerifiedAt: now,
      lastVerificationAttemptAt: now, staleAfterSeconds: null, passageSupport: null, reportedSupport: null, quotedSupport: null, methodNote: null,
    });
    // Revenue 1500x the valuation is a unit slip, unless the face withholds that valuation.
    cards[0] = { ...cards[0]!, company: { ...cards[0]!.company!, ownership }, metrics: [row('arr', 300e9), row('valuation', 200e6)] } as never;
    const verifyMetric = vi.fn().mockResolvedValue({ metric: row('arr', 300e9), changed: false, verdict: 'unverified', citations: [] });
    const client = createQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <RepositoryProvider repository={Object.assign(repository, { verifyMetric })}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </RepositoryProvider>;
    const { unmount } = renderHook(() => useLivingDeck(sample.decks[0]!.id, cards), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    unmount(); client.clear();
    return verifyMetric;
  };

  it('queues no paid check for an acquired company\'s valuation, which the face shows as Unknown', async () => {
    const acquired = {
      status: 'acquired', acquirer: 'PepsiCo', announcedOn: '2025-03-17', closedOn: '2025-05-27', price: { value: 200e6, currency: 'USD' },
      citations: [{ url: 'https://www.pepsico.com/newsroom/press-releases/2025/pepsico-completes-acquisition-of-poppi', title: 'PepsiCo' }], confidence: 'verified',
    };
    expect(await run(acquired)).not.toHaveBeenCalled();
  });

  it('still queues the paid check when the same figures stand on the face', async () => {
    expect(await run(null)).toHaveBeenCalled();
  });
});
