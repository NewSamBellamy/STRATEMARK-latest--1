import { describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CompanyMetric, DeckRefreshListener } from '@mi/contracts';
import { buildDataset } from '@mi/mocks';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { makeRepo } from '@/test/test-utils';
import { qk } from '@/lib/query/keys';
import { useCard, useCards, useCompanyMetrics, useDeckRefreshSubscription, useHuntMetrics, useOverrideMetric, useSavedCards, useVerifyMetric } from './data';

const metric: CompanyMetric = { ...buildDataset().metrics[0]!, metricType: 'users', confidence: 'user_verified', value: 123 };
const companyId = metric.companyId;
const keys = [qk.companyMetrics(companyId), qk.cards('deck'), qk.card('card'), qk.savedCards,
  qk.dashboard(companyId, 'metrics')];

describe('metric updates refresh every metric-bearing card cache', () => {
  it('reads accepted company facts rather than raw observations for dashboard figures', async () => {
    const raw = vi.fn().mockResolvedValue([{ ...metric, value: 999 }]);
    const facts = vi.fn().mockResolvedValue([{ ...metric, value: null, confidence: 'unknown', citations: [] }]);
    const repo = Object.assign(makeRepo(), { getCompanyMetrics: raw, getCompanyFacts: facts });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <RepositoryProvider repository={repo}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </RepositoryProvider>;
    const { result, unmount } = renderHook(() => useCompanyMetrics(companyId), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(facts).toHaveBeenCalledWith(companyId);
    expect(raw).not.toHaveBeenCalled();
    expect(result.current.data![0]!.value).toBeNull();
    unmount(); client.clear();
  });
  it('refreshes metric and saved-card surfaces after a deck refresh event', () => {
    const client = new QueryClient();
    for (const key of keys) client.setQueryData(key, []);
    let listener: DeckRefreshListener | undefined;
    const repo = Object.assign(makeRepo(), {
      subscribeDeckRefresh: (callback: DeckRefreshListener) => { listener = callback; return () => {}; },
    });
    const wrapper = ({ children }: { children: ReactNode }) => <RepositoryProvider repository={repo}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </RepositoryProvider>;
    const { unmount } = renderHook(() => useDeckRefreshSubscription(), { wrapper });
    act(() => listener!({ deckId: 'deck', marketId: 'market', refreshedAt: '2026-10-05T00:00:00Z',
      addedCardIds: [], updatedCardIds: ['card'], prunedCardIds: [] }));
    for (const key of keys.slice(0, 4)) expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
    expect(client.getQueryState(qk.dashboard(companyId, 'metrics'))?.isInvalidated).toBe(false);
    unmount(); client.clear();
  });
  it('projects the same newest revision for deck, individual, saved and dashboard reads without rewriting raw cache', async () => {
    const data = buildDataset();
    const card = { card: data.cards[0]!, company: data.companies[0]!, viceClaims: [], metrics: [
      { ...metric, id: 'older', confidence: 'verified' as const, value: 1000,
        citations: [{ url: 'https://sec.gov/Archives/old', title: 'Filing' }], capturedAt: '2026-10-01T00:00:00Z' },
      { ...metric, id: 'newer', confidence: 'estimated' as const, value: 900, capturedAt: '2026-10-05T00:00:00Z' },
    ] };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const repo = Object.assign(makeRepo(), {
      listCards: vi.fn().mockResolvedValue([card]), getCard: vi.fn().mockResolvedValue(card),
      listSavedCards: vi.fn().mockResolvedValue([card]), getCompanyMetrics: vi.fn().mockResolvedValue(card.metrics),
    });
    const wrapper = ({ children }: { children: ReactNode }) => <RepositoryProvider repository={repo}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </RepositoryProvider>;
    const { result, unmount } = renderHook(() => ({ deck: useCards('deck'), card: useCard('card'), saved: useSavedCards(), metrics: useCompanyMetrics(companyId) }), { wrapper });
    await waitFor(() => expect(Object.values(result.current).every(q => q.isSuccess)).toBe(true));
    const surfaces = [result.current.deck.data![0]!.metrics, result.current.card.data!.metrics,
      result.current.saved.data![0]!.metrics, result.current.metrics.data!];
    for (const rows of surfaces) {
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: 'newer', value: 900, confidence: 'estimated' });
    }
    expect(client.getQueryData(qk.companyMetrics(companyId))).toEqual(card.metrics);
    expect(card.metrics).toHaveLength(2);
    unmount(); client.clear();
  });
  it.each(['verify', 'hunt', 'override'] as const)('%s invalidates deck, individual, saved and dashboard surfaces', async kind => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    for (const key of keys) client.setQueryData(key, []);
    const repo = Object.assign(makeRepo(), {
      verifyMetric: vi.fn().mockResolvedValue({ metric, verdict: 'supported', changed: true, citations: [], retieredCardIds: [] }),
      huntCompanyMetrics: vi.fn().mockResolvedValue({ metrics: [metric], filledTypes: [metric.metricType], retieredCardIds: [] }),
      overrideMetric: vi.fn().mockResolvedValue(metric),
    });
    const wrapper = ({ children }: { children: ReactNode }) => <RepositoryProvider repository={repo}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </RepositoryProvider>;
    const { result, unmount } = renderHook(() => ({ verify: useVerifyMetric(), hunt: useHuntMetrics(), override: useOverrideMetric() }), { wrapper });
    await act(async () => {
      if (kind === 'verify') await result.current.verify.mutateAsync({ companyId, metricType: metric.metricType });
      if (kind === 'hunt') await result.current.hunt.mutateAsync(companyId);
      if (kind === 'override') await result.current.override.mutateAsync({ companyId, metricType: metric.metricType, value: 123, note: 'Human correction' });
    });
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
    unmount();
    client.clear();
  });
  it('still refreshes card surfaces after an inconclusive check without rerunning cached dashboard research', async () => {
    const client = new QueryClient();
    for (const key of keys) client.setQueryData(key, []);
    const repo = Object.assign(makeRepo(), {
      verifyMetric: vi.fn().mockResolvedValue({ metric, verdict: 'unverified', changed: false, citations: [], retieredCardIds: [] }),
    });
    const wrapper = ({ children }: { children: ReactNode }) => <RepositoryProvider repository={repo}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </RepositoryProvider>;
    const { result, unmount } = renderHook(() => useVerifyMetric(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ companyId, metricType: metric.metricType }); });
    for (const key of keys.slice(0, 4)) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(qk.dashboard(companyId, 'metrics'))?.isInvalidated).toBe(false);
    unmount(); client.clear();
  });
});
