import type { ReactNode } from 'react';
import type { CardWithCompany, CardType, ResearchJob } from '@mi/contracts';
import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { MockRepository, type SeedSnapshot } from '@mi/mocks';
import { afterEach, expect, it, vi } from 'vitest';
import sample from '@/sample/frontier-snapshot.json';
import { createQueryClient } from '@/lib/query/queryClient';
import { qk } from '@/lib/query/keys';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { useApiKey } from '@/lib/settings/apiKey';
import * as usage from '@/lib/usage';
import { useResearchControl } from './researchControl';
import { useLivingDeck } from './useLivingDeck';

async function setup(types: CardType[] = ['company']) {
  const repo = new MockRepository({ seedSnapshot: sample as unknown as SeedSnapshot, latencyMs: 0 });
  const original = (await repo.listCards(sample.decks[0]!.id)).find(c => c.company)!;
  const cards: CardWithCompany[] = types.map((cardType, index) => ({
    ...original, card: { ...original.card, id: `card-${index}`, cardType },
    company: { ...original.company!, id: `company-${index}` }, metrics: [],
  }));
  const huntCompanyMetrics = vi.fn().mockResolvedValue({ filledTypes: [], metrics: [], retieredCardIds: [] });
  const getDashboardTab = vi.spyOn(repo, 'getDashboardTab');
  Object.assign(repo, { huntCompanyMetrics });
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <RepositoryProvider repository={repo}>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  </RepositoryProvider>;
  vi.useFakeTimers();
  return { repo, cards, original, huntCompanyMetrics, getDashboardTab, client, wrapper };
}

afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs();
  useApiKey.setState({ apiKey: '', hasKey: false });
  act(() => useResearchControl.setState({ paused: false }));
});

it.each(['queued', 'running'] as const)('defers automatic hydration during %s creation and resumes after completion', async status => {
  const s = await setup(['company', 'infrastructure', 'distribution']);
  const job = { status, deck: { id: 'deck' }, catalogNames: s.cards.map(c => c.company!.name) } as ResearchJob;
  const listResearchJobs = vi.fn().mockImplementation(async () => [job]);
  Object.assign(s.repo, { listResearchJobs });
  const hook = renderHook(({ cards }) => useLivingDeck('deck', cards), {
    wrapper: s.wrapper, initialProps: { cards: s.cards.slice(0, 1) },
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  hook.rerender({ cards: s.cards }); // the catalog arrives while creation is still running
  await act(async () => { await vi.advanceTimersByTimeAsync(58500); });
  expect(listResearchJobs).toHaveBeenCalledTimes(1);
  expect(s.huntCompanyMetrics).not.toHaveBeenCalled();
  expect(s.getDashboardTab).not.toHaveBeenCalled();
  expect(hook.result.current.actionCount).toBe(0);
  job.status = 'completed';
  await act(async () => { await vi.advanceTimersByTimeAsync(22000); });
  expect(listResearchJobs).toHaveBeenCalledTimes(2);
  expect(s.huntCompanyMetrics.mock.calls.map(c => c[0])).toEqual(['company-0', 'company-1', 'company-2']);
  hook.unmount(); s.client.clear();
});

it('shares readiness reads across remounts and defers on failure without spending an attempt', async () => {
  const s = await setup();
  const listResearchJobs = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
  Object.assign(s.repo, { listResearchJobs });
  const first = renderHook(() => useLivingDeck('deck', s.cards), { wrapper: s.wrapper });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  first.unmount();
  const reopened = renderHook(() => useLivingDeck('deck', s.cards), { wrapper: s.wrapper });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(listResearchJobs).toHaveBeenCalledTimes(1);
  expect(s.huntCompanyMetrics).not.toHaveBeenCalled();
  expect(s.getDashboardTab).not.toHaveBeenCalled();
  expect(reopened.result.current.actionCount).toBe(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(listResearchJobs).toHaveBeenCalledTimes(2);
  expect(s.huntCompanyMetrics).toHaveBeenCalledTimes(1);
  reopened.unmount(); s.client.clear();
});

it('honors pause while the asynchronous readiness check is pending', async () => {
  const s = await setup();
  let finish!: () => void;
  const listResearchJobs = vi.fn(() => new Promise<ResearchJob[]>(resolve => {
    finish = () => resolve([]);
  }));
  Object.assign(s.repo, { listResearchJobs });
  const hook = renderHook(() => useLivingDeck('deck', s.cards), { wrapper: s.wrapper });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  act(() => hook.result.current.pause());
  await act(async () => { finish(); });
  expect(s.huntCompanyMetrics).not.toHaveBeenCalled();
  expect(s.getDashboardTab).not.toHaveBeenCalled();
  act(() => hook.result.current.resume());
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(s.huntCompanyMetrics).toHaveBeenCalledTimes(1);
  expect(listResearchJobs).toHaveBeenCalledTimes(1);
  hook.unmount(); s.client.clear();
});

it('defers dashboard prefetch and verification during creation even without a hunt capability', async () => {
  const s = await setup();
  s.cards[0]!.metrics = s.original.metrics.map(m => ({ ...m, companyId: 'company-0',
    confidence: 'estimated', lastVerifiedAt: null, lastVerificationAttemptAt: null }));
  const verifyMetric = vi.fn();
  Object.assign(s.repo, { huntCompanyMetrics: undefined, verifyMetric,
    listResearchJobs: vi.fn().mockResolvedValue([{ status: 'running', deck: { id: 'deck' } }]) });
  const hook = renderHook(() => useLivingDeck('deck', s.cards), { wrapper: s.wrapper });
  await act(async () => { await vi.advanceTimersByTimeAsync(59000); });
  expect(s.getDashboardTab).not.toHaveBeenCalled();
  expect(verifyMetric).not.toHaveBeenCalled();
  expect(hook.result.current.actionCount).toBe(0);
  hook.unmount(); s.client.clear();
});

it('ignores creation jobs belonging to another deck', async () => {
  const s = await setup();
  Object.assign(s.repo, { listResearchJobs: vi.fn().mockResolvedValue([{ status: 'running', deck: { id: 'other' } }]) });
  const hook = renderHook(() => useLivingDeck('deck', s.cards), { wrapper: s.wrapper });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(s.huntCompanyMetrics).toHaveBeenCalledTimes(1);
  hook.unmount(); s.client.clear();
});

it('ignores a zombie creation job whose record went stale while running', async () => {
  // Live-verified failure mode: a hung research tail held a job 'running' for
  // 13+ minutes with zero provider activity while the deck was rendered — the
  // runtime rested on it and cards never filled.
  const s = await setup();
  const stale = new Date(Date.now() - 6 * 60_000 - 1000).toISOString();
  Object.assign(s.repo, {
    listResearchJobs: vi.fn().mockResolvedValue([
      { status: 'running', deck: { id: 'deck' }, updatedAt: stale },
    ]),
  });
  const hook = renderHook(() => useLivingDeck('deck', s.cards), { wrapper: s.wrapper });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(s.huntCompanyMetrics).toHaveBeenCalledTimes(1);
  hook.unmount(); s.client.clear();
});

it('keeps deferring on a fresh running job even when other jobs went stale', async () => {
  const s = await setup();
  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  Object.assign(s.repo, {
    listResearchJobs: vi.fn().mockResolvedValue([
      { status: 'running', deck: { id: 'deck' }, updatedAt: new Date().toISOString() },
      { status: 'running', deck: { id: 'earlier-deck' }, updatedAt: stale },
    ]),
  });
  const hook = renderHook(() => useLivingDeck('deck', s.cards), { wrapper: s.wrapper });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(s.huntCompanyMetrics).not.toHaveBeenCalled();
  hook.unmount(); s.client.clear();
});

it('reports in-flight recovery before the hunt resolves', async () => {
  const s = await setup();
  let finish!: () => void;
  s.huntCompanyMetrics.mockImplementation(() => new Promise(resolve => {
    finish = () => resolve({ filledTypes: [], metrics: [], retieredCardIds: [] });
  }));
  const hook = renderHook(() => useLivingDeck('deck', s.cards), { wrapper: s.wrapper });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(s.huntCompanyMetrics).toHaveBeenCalledTimes(1);
  expect(hook.result.current.events[0]).toMatchObject({ kind: 'hunting', companyName: s.cards[0]!.company!.name });
  expect(hook.result.current.actionCount).toBe(0);
  await act(async () => { finish(); });
  expect(hook.result.current.events[0]?.kind).toBe('hunted');
  expect(hook.result.current.actionCount).toBe(1);
  hook.unmount(); s.client.clear();
});

it('hunts each empty entity once ahead of warming, excluding signals and duplicate desks', async () => {
  const s = await setup(['company', 'infrastructure', 'distribution', 'culture', 'vice', 'insight']);
  const cards = [...s.cards, s.cards[0]!];
  const hook = renderHook(() => useLivingDeck('deck', cards), { wrapper: s.wrapper });
  expect(hook.result.current.deskCount).toBe(3);
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(s.huntCompanyMetrics.mock.calls.map(c => c[0])).toEqual(['company-0']);
  expect(s.getDashboardTab).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
  expect(s.huntCompanyMetrics.mock.calls.map(c => c[0])).toEqual(['company-0', 'company-1', 'company-2']);
  expect(hook.result.current.events.some(e => /nothing met the sourcing bar/.test(e.message))).toBe(true);
  expect(hook.result.current.events.some(e => e.kind === 'verified' || e.kind === 'corrected')).toBe(false);
  hook.unmount(); s.client.clear();
});

it.each(['empty', 'failure'] as const)('does not repeat a %s hunt after rerender, pause/resume, or remount', async outcome => {
  const s = await setup();
  if (outcome === 'failure') s.huntCompanyMetrics.mockRejectedValue(new Error('offline'));
  const hook = renderHook(() => useLivingDeck('deck', s.cards), { wrapper: s.wrapper });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  hook.rerender();
  act(() => hook.result.current.pause()); act(() => hook.result.current.resume());
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  hook.unmount();
  const reopened = renderHook(() => useLivingDeck('deck', s.cards), { wrapper: s.wrapper });
  await act(async () => { await vi.advanceTimersByTimeAsync(180000); });
  expect(s.huntCompanyMetrics).toHaveBeenCalledTimes(1);
  reopened.unmount(); s.client.clear();
});

it('escalates an empty hunt after the cooldown and caps the ladder at three attempts', async () => {
  const s = await setup();
  s.huntCompanyMetrics.mockResolvedValue({ filledTypes: [], metrics: [], retieredCardIds: [] });
  const hook = renderHook(() => useLivingDeck('deck', s.cards), { wrapper: s.wrapper });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(s.huntCompanyMetrics).toHaveBeenCalledTimes(1);
  expect(s.huntCompanyMetrics).toHaveBeenLastCalledWith('company-0', undefined);
  // Inside the cooldown window the failed hunt gets no second breath.
  await act(async () => { await vi.advanceTimersByTimeAsync(9 * 60_000); });
  expect(s.huntCompanyMetrics).toHaveBeenCalledTimes(1);
  // After the cooldown the desk retries with an escalated prompt.
  await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60_000); });
  expect(s.huntCompanyMetrics).toHaveBeenCalledTimes(2);
  expect(s.huntCompanyMetrics).toHaveBeenLastCalledWith('company-0', { escalation: 1 });
  await act(async () => { await vi.advanceTimersByTimeAsync(10.5 * 60_000); });
  expect(s.huntCompanyMetrics).toHaveBeenCalledTimes(3);
  expect(s.huntCompanyMetrics).toHaveBeenLastCalledWith('company-0', { escalation: 2 });
  // A still-empty company bottoms out instead of burning queries forever.
  await act(async () => { await vi.advanceTimersByTimeAsync(60 * 60_000); });
  expect(s.huntCompanyMetrics).toHaveBeenCalledTimes(3);
  hook.unmount(); s.client.clear();
});

it('invalidates real card, saved, metric and dashboard queries after recovery', async () => {
  const s = await setup();
  s.huntCompanyMetrics.mockResolvedValue({ filledTypes: ['employees'], metrics: [], retieredCardIds: ['card-0'] });
  const keys = [qk.cards('deck'), qk.card('card-0'), qk.savedCards, qk.companyMetrics('company-0'), qk.dashboard('company-0', 'overview')];
  keys.forEach(key => s.client.setQueryData(key, []));
  const hook = renderHook(() => useLivingDeck('deck', s.cards), { wrapper: s.wrapper });
  expect(hook.result.current.canVerify).toBe(true); // hunt-only transport is live research
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  keys.forEach(key => expect(s.client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true));
  expect(hook.result.current.events.find(e => /Filled 1/.test(e.message))?.citations).toBeUndefined();
  expect(hook.result.current.actionCount).toBe(1);
  hook.unmount(); s.client.clear();
});

it('refetches an observed card query so recovered metrics reach the open UI', async () => {
  const s = await setup();
  const updated = { ...s.cards[0]!, metrics: [{ ...s.original.metrics[0]!, companyId: 'company-0',
    metricType: 'employees' as const, value: 250, confidence: 'user_verified' as const }] };
  let stored = s.cards[0]!;
  const read = vi.fn(async () => stored);
  s.huntCompanyMetrics.mockImplementation(async () => {
    stored = updated;
    return { filledTypes: ['employees'], metrics: updated.metrics, retieredCardIds: [] };
  });
  s.client.setQueryData(qk.card('card-0'), stored);
  const hook = renderHook(() => {
    const card = useQuery({ queryKey: qk.card('card-0'), queryFn: read, staleTime: Infinity });
    useLivingDeck('deck', card.data ? [card.data] : []);
    return card.data;
  }, { wrapper: s.wrapper });
  expect(hook.result.current?.metrics).toEqual([]);
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(read).toHaveBeenCalledTimes(1);
  expect(hook.result.current?.metrics[0]?.value).toBe(250);
  hook.unmount(); s.client.clear();
});

it('does not fall back to repeated single-metric checks for unresolved core gaps', async () => {
  const s = await setup();
  s.cards[0]!.metrics = [{ ...s.original.metrics[0]!, companyId: 'company-0', metricType: 'employees',
    confidence: 'unknown', value: null, lastVerifiedAt: null, lastVerificationAttemptAt: null }];
  const verifyMetric = vi.fn().mockResolvedValue({ metric: s.cards[0]!.metrics[0],
    changed: false, verdict: 'unverified', citations: [] });
  Object.assign(s.repo, { verifyMetric });
  const hook = renderHook(() => useLivingDeck('deck', s.cards), { wrapper: s.wrapper });
  await act(async () => { await vi.advanceTimersByTimeAsync(180000); });
  expect(s.huntCompanyMetrics).toHaveBeenCalledTimes(1);
  expect(verifyMetric).not.toHaveBeenCalled();
  hook.unmount(); s.client.clear();
});

it.each(['paused', 'low power', 'keyless', 'unsupported'] as const)('does not hunt when %s', async mode => {
  const s = await setup();
  if (mode === 'paused') useResearchControl.setState({ paused: true });
  if (mode === 'low power') vi.spyOn(usage, 'isLowPower').mockReturnValue(true);
  if (mode === 'keyless') vi.stubEnv('VITE_DESKTOP', '1');
  if (mode === 'unsupported') Object.assign(s.repo, { huntCompanyMetrics: undefined });
  const hook = renderHook(() => useLivingDeck('deck', s.cards), { wrapper: s.wrapper });
  await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
  expect(s.huntCompanyMetrics).not.toHaveBeenCalled();
  hook.unmount(); s.client.clear();
});

it('accepts market cap as company value but recovers absent or unknown core figures', async () => {
  const s = await setup(['company', 'infrastructure', 'distribution']);
  const template = s.original.metrics[0]!;
  const complete = ['employees', 'arr', 'users', 'market_cap'] as const;
  s.cards.forEach(c => { c.metrics = complete.map(metricType => ({ ...template, companyId: c.company!.id,
    metricType, value: 100, confidence: 'user_verified' })); });
  s.cards[1]!.metrics = s.cards[1]!.metrics.filter(m => m.metricType !== 'users');
  s.cards[2]!.metrics = s.cards[2]!.metrics.map(m => m.metricType === 'employees' ? { ...m, value: null, confidence: 'unknown' } : m);
  const hook = renderHook(() => useLivingDeck('deck', s.cards), { wrapper: s.wrapper });
  await act(async () => { await vi.advanceTimersByTimeAsync(10500); });
  expect(s.huntCompanyMetrics.mock.calls.map(c => c[0])).toEqual(['company-1', 'company-2']);
  hook.unmount(); s.client.clear();
});
