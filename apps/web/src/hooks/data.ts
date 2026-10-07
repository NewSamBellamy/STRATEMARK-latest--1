/**
 * Typed data hooks — the ONLY way feature components read/write data. They wrap
 * the repository behind TanStack Query, so the mock↔IPC swap is invisible here.
 */
import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  CardFilter,
  CardWithCompany,
  Company,
  CompanyMetric,
  CreateMarketInput,
  DashboardTab,
  DashboardTabResult,
  Deck,
  DeckRefreshEvent,
  Market,
  HuntMetricsResult,
  RefreshCadence,
  VerifyMetricInput,
  VerifyMetricResult,
} from '@mi/contracts';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { traceAgent } from '@/lib/agentic/agentTrace';
import { qk } from '@/lib/query/keys';
import { buildMetricViews } from '@/features/card/card-view';

// All UI consumers (including reports/compare/overview) share the same
// read-only revision and provenance rules; raw cache/storage stays intact.
const projectMetrics = (metrics: CompanyMetric[], website?: string | null) => buildMetricViews(metrics, website).map(view => view.metric);
const projectCard = (card: CardWithCompany): CardWithCompany => ({ ...card, metrics: projectMetrics(card.metrics, card.company?.websiteUrl) });

export function invalidateMetricSurfaces(qc: QueryClient, companyId: string, dashboard: boolean) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: qk.companyMetrics(companyId) }),
    qc.invalidateQueries({ queryKey: ['cards'] }),
    qc.invalidateQueries({ queryKey: ['card'] }),
    qc.invalidateQueries({ queryKey: qk.savedCards }),
    ...(dashboard ? [qc.invalidateQueries({ queryKey: ['dashboard', companyId] })] : []),
  ]);
}

export function useMarkets(): UseQueryResult<Market[]> {
  const repo = useRepository();
  return useQuery({ queryKey: qk.markets, queryFn: () => repo.listMarkets() });
}

export function useMarket(id: string | undefined): UseQueryResult<Market | null> {
  const repo = useRepository();
  return useQuery({
    queryKey: qk.market(id ?? ''),
    queryFn: () => repo.getMarket(id as string),
    enabled: !!id,
  });
}

export function useDeckByMarket(marketId: string | undefined): UseQueryResult<Deck | null> {
  const repo = useRepository();
  return useQuery({
    queryKey: qk.deck(marketId ?? ''),
    queryFn: () => repo.getDeckByMarket(marketId as string),
    enabled: !!marketId,
    refetchInterval: (query) => {
      const deck = query.state.data as { status?: string } | null;
      if (deck?.status === 'running' || deck?.status === 'partial' || deck?.status === 'refreshing') {
        return 3000;
      }
      return false;
    },
  });
}

export function useCards(
  deckId: string | undefined,
  filter?: CardFilter,
): UseQueryResult<CardWithCompany[]> {
  const repo = useRepository();
  const qc = useQueryClient();
  const emptyReadySince = useRef<number | null>(null);
  useEffect(() => {
    emptyReadySince.current = null;
  }, [deckId]);
  return useQuery({
    queryKey: qk.cards(deckId ?? '', filter),
    queryFn: () => repo.listCards(deckId as string, filter),
    select: cards => cards.map(projectCard),
    enabled: !!deckId,
    // SAFE STATE for back-navigation: returning to a deck renders the cached
    // cards INSTANTLY (any refetch happens quietly behind them). Without this,
    // coming back from a dashboard re-fetched from scratch and the deck sat on
    // a skeleton — "it doesn't load your deck back how you had it".
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    refetchInterval: (query) => {
      const cards = query.state.data;
      if (cards && cards.some((c) => c.card.tier === null)) {
        return 3000;
      }
      const cachedDeck = qc.getQueryData<Deck & { status?: string }>(qk.deck(deckId ?? ''));
      const deckInProgress =
        cachedDeck?.status === 'running' ||
        cachedDeck?.status === 'partial' ||
        cachedDeck?.status === 'refreshing';
      let readyDeckStillMissingCards = false;
      if (cards?.length === 0 && cachedDeck?.status === 'ready') {
        const now = Date.now();
        emptyReadySince.current ??= now;
        readyDeckStillMissingCards = emptyReadySince.current + 60_000 > now;
      } else {
        emptyReadySince.current = null;
      }
      const unknownDeckStillLoading =
        cards &&
        cards.length === 0 &&
        cachedDeck?.status !== 'ready' &&
        cachedDeck?.status !== 'failed' &&
        cachedDeck?.status !== 'ready_stale';
      if (deckInProgress || readyDeckStillMissingCards || unknownDeckStillLoading) {
        return 3000;
      }
      return false;
    },
  });
}

export function useCard(cardId: string | undefined): UseQueryResult<CardWithCompany | null> {
  const repo = useRepository();
  return useQuery({
    queryKey: qk.card(cardId ?? ''),
    queryFn: () => repo.getCard(cardId as string),
    select: card => card ? projectCard(card) : null,
    enabled: !!cardId,
  });
}

export function useSavedCards(): UseQueryResult<CardWithCompany[]> {
  const repo = useRepository();
  return useQuery({ queryKey: qk.savedCards, queryFn: () => repo.listSavedCards(), select: cards => cards.map(projectCard) });
}

export function useSaveCard() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cardId: string) => repo.saveCard(cardId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.savedCards }),
  });
}

export function useUnsaveCard() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cardId: string) => repo.unsaveCard(cardId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.savedCards }),
  });
}

export function useCompany(companyId: string | undefined): UseQueryResult<Company | null> {
  const repo = useRepository();
  return useQuery({
    queryKey: qk.company(companyId ?? ''),
    queryFn: () => repo.getCompany(companyId as string),
    enabled: !!companyId,
  });
}

export function useCompanyMetrics(companyId: string | undefined): UseQueryResult<CompanyMetric[]> {
  const repo = useRepository();
  const company = useCompany(companyId);
  return useQuery({
    queryKey: qk.companyMetrics(companyId ?? ''),
    queryFn: () => {
      if (!repo.getCompanyFacts) throw new Error('Accepted company facts are unavailable. Update or restart the app.');
      return repo.getCompanyFacts(companyId as string);
    },
    select: metrics => projectMetrics(metrics, company.data?.websiteUrl),
    enabled: !!companyId,
  });
}

export function useDashboardTab<T extends DashboardTab>(
  companyId: string | undefined,
  tab: T,
): UseQueryResult<DashboardTabResult<T> | null> {
  const repo = useRepository();
  return useQuery({
    queryKey: qk.dashboard(companyId ?? '', tab),
    queryFn: () => repo.getDashboardTab(companyId as string, tab),
    enabled: !!companyId,
    // This read may start paid research. The provider already has bounded
    // transport retries; a query retry must not silently buy another full pass.
    retry: false,
  });
}

export function useCreateMarket() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMarketInput) => repo.createMarket(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.markets }),
  });
}

export function useDeleteDeck() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (repo.deleteDeck) {
        return repo.deleteDeck(id);
      }
      if (repo.deleteMarket) {
        return repo.deleteMarket(id);
      }
      return false;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.markets });
    },
  });
}

export function useUpdateCadence() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cadence }: { id: string; cadence: RefreshCadence }) =>
      repo.updateMarketCadence(id, cadence),
    onSuccess: (market) => {
      qc.invalidateQueries({ queryKey: qk.markets });
      qc.invalidateQueries({ queryKey: qk.market(market.id) });
    },
  });
}

export function useRefreshDeck() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (marketId: string) => repo.refreshDeck(marketId),
    onSuccess: (deck) => {
      qc.invalidateQueries({ queryKey: qk.deck(deck.marketId) });
      qc.invalidateQueries({ queryKey: ['cards', deck.id] });
    },
  });
}

/** Resumable failed/partial creation job for a deck, when the engine keeps them. */
export function useResumableJob(marketId: string | undefined) {
  const repo = useRepository();
  const available = typeof repo.listResearchJobs === 'function' &&
    typeof repo.resumeResearchJob === 'function';
  return useQuery({
    queryKey: ['research-jobs', marketId],
    queryFn: async () => {
      const jobs = await repo.listResearchJobs!();
      return jobs
        .filter((job) => job.deck?.marketId === marketId &&
          (job.status === 'failed' || job.status === 'cancelled') &&
          job.marketPlan && job.market && job.deck && job.catalog)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
    },
    enabled: available && !!marketId,
    staleTime: 30_000,
  });
}

export function useResumeResearchJob() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      if (typeof repo.resumeResearchJob !== 'function') {
        throw new Error('This engine cannot resume research.');
      }
      return repo.resumeResearchJob(jobId);
    },
    onSuccess: (job) => {
      if (job?.deck) {
        qc.invalidateQueries({ queryKey: qk.deck(job.deck.marketId) });
        qc.invalidateQueries({ queryKey: ['cards', job.deck.id] });
      }
      qc.invalidateQueries({ queryKey: ['research-jobs'] });
    },
  });
}

// Reports ------------------------------------------------------------------
export function useReports() {
  const repo = useRepository();
  return useQuery({ queryKey: ['reports'], queryFn: () => repo.listReports() });
}

export function useReport(id: string | undefined) {
  const repo = useRepository();
  return useQuery({
    queryKey: ['report', id ?? ''],
    queryFn: () => repo.getReport(id as string),
    enabled: !!id,
  });
}

/** Stored Daily Briefings for a market, newest first (feature-detected). */
export function useDeckBriefings(marketId: string | undefined) {
  const repo = useRepository();
  return useQuery({
    queryKey: ['briefings', marketId ?? ''],
    queryFn: () =>
      repo.listDeckBriefings
        ? repo.listDeckBriefings(marketId as string)
        : Promise.resolve([]),
    enabled: !!marketId,
  });
}

/**
 * The overnight desk: one grounded pass over the whole deck's last-N-hours
 * news, composed into a structured Daily Briefing. Gated engine-side on
 * deckBakedState; feature-detected (live-research transports only).
 */
export function useGenerateBriefing() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ marketId, windowHours }: { marketId: string; windowHours?: number }) => {
      if (!repo.generateDeckBriefing) {
        return Promise.reject(
          new Error('Daily Briefings need the live research engine — connect a key in Settings.'),
        );
      }
      return repo.generateDeckBriefing(marketId, { windowHours });
    },
    onSuccess: (b) => {
      traceAgent(
        'Desk',
        `Daily Briefing composed for ${b.marketName}`,
        `${b.updates.length} sourced update${b.updates.length === 1 ? '' : 's'} in the last ${b.windowHours}h`,
      );
      qc.invalidateQueries({ queryKey: ['briefings', b.marketId] });
    },
  });
}

/**
 * The landing-page teardown: audit ANY site (yours or a competitor's) into a
 * structured visual report. Feature-detected — live-research transports only.
 */
export function useAuditSite() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { url: string; siteName?: string | null; companyId?: string | null }) => {
      if (!repo.auditSite) {
        return Promise.reject(
          new Error('Site audits need the live research engine — connect a key in Settings.'),
        );
      }
      return repo.auditSite(input);
    },
    onSuccess: (report) => {
      traceAgent('Auditor', `Site audit composed — ${report.title}`, null);
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

export function useGenerateReport() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: Parameters<typeof repo.generateReport>[0]) =>
      repo.generateReport(request),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports'] }),
  });
}

export function useFactCheck() {
  const repo = useRepository();
  return useMutation({
    mutationFn: (input: Parameters<typeof repo.factCheck>[0]) => repo.factCheck(input),
  });
}

/**
 * Live re-verification of a stored metric — the fact-check that WRITES BACK.
 * Grounded evidence revises the stored figure (citations attached), re-tiers
 * the company, and every open view reconciles through query invalidation.
 * Feature-detected: `isAvailable` is false on transports without live research.
 */
export function useVerifyMetric() {
  const repo = useRepository();
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: VerifyMetricInput) => {
      if (!repo.verifyMetric) {
        return Promise.reject(new Error('Live verification is not available in this mode.'));
      }
      return repo.verifyMetric(input);
    },
    onSuccess: (result: VerifyMetricResult, input) => {
      traceAgent(
        'Verifier',
        result.changed
          ? `Corrected a figure — value, badge, and tier updated everywhere`
          : `Re-checked a figure — ${result.verdict === 'supported' ? 'it holds' : 'no better evidence found'}`,
        `${result.citations.length} sources`,
      );
      // ALWAYS refresh metric-bearing surfaces: even a "nothing changed"
      // verification stamps lastVerifiedAt (the "checked Xm ago" chips) and
      // may have downgraded a badge. Gating this on `changed` left page two
      // showing what page one had already reconciled — the continuity bug.
      return invalidateMetricSurfaces(qc, input.companyId, result.changed);
    },
  });
  return { ...mutation, isAvailable: typeof repo.verifyMetric === 'function' };
}

/**
 * "Find more metrics" — ONE grounded research pass hunting every soft figure
 * a company still has (missing, unknown, estimated), written back with
 * citations and re-tiered. Feature-detected like verifyMetric.
 */
export function useHuntMetrics() {
  const repo = useRepository();
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (companyId: string) => {
      if (!repo.huntCompanyMetrics) {
        return Promise.reject(new Error('Metric hunting is not available in this mode.'));
      }
      return repo.huntCompanyMetrics(companyId);
    },
    onSuccess: (result: HuntMetricsResult, companyId) => {
      traceAgent(
        'Metrics hunter',
        result.filledTypes.length > 0
          ? `Filled ${result.filledTypes.length} soft figure${result.filledTypes.length === 1 ? '' : 's'} from live sources`
          : 'Hunted soft figures — nothing met the sourcing bar (gaps stay honest)',
      );
      return invalidateMetricSurfaces(qc, companyId, result.filledTypes.length > 0);
    },
  });
  return { ...mutation, isAvailable: typeof repo.huntCompanyMetrics === 'function' };
}

/** Targeted micro-research to fill an empty tier/category (intelligent empty states). */
export function useExpandDeck(marketId: string | undefined) {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (focus: Parameters<typeof repo.expandDeck>[1]) =>
      repo.expandDeck(marketId as string, focus),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cards'] }),
  });
}

/** Human-in-the-loop metric correction → user_verified → CMS re-tier. */
export function useOverrideMetric() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof repo.overrideMetric>[0]) => repo.overrideMetric(input),
    onSuccess: (metric) => {
      return invalidateMetricSurfaces(qc, metric.companyId, true);
    },
  });
}

export function useMarketOpportunity(marketId: string | undefined) {
  const repo = useRepository();
  return useQuery({
    queryKey: ['opportunity', marketId ?? ''],
    queryFn: () => repo.getMarketOpportunity(marketId as string),
    enabled: !!marketId,
    staleTime: Infinity,
  });
}

/**
 * User-directed rerun of a single dashboard tab (right-click → Rerun).
 * Bypasses the cached research and replaces it in place — the curated-deck
 * primitive: fix exactly the piece that's wrong, touch nothing else.
 */
export function useRerunDashboardTab(companyId: string | undefined, tab: DashboardTab) {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => repo.getDashboardTab(companyId as string, tab, true),
    onSuccess: (result) => {
      if (result) qc.setQueryData(qk.dashboard(companyId as string, tab), result);
    },
  });
}

/** User-directed rerun of the market-opportunity whitespace analysis. */
export function useRerunOpportunity(marketId: string | undefined) {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => repo.getMarketOpportunity(marketId as string, true),
    onSuccess: (result) => {
      qc.setQueryData(['opportunity', marketId ?? ''], result);
    },
  });
}

/** Subscribe to live deck-refresh events (spec §9) and invalidate affected caches. */
export function useDeckRefreshSubscription(onEvent?: (evt: DeckRefreshEvent) => void): void {
  const repo = useRepository();
  const qc = useQueryClient();
  useEffect(() => {
    const unsub = repo.subscribeDeckRefresh((evt) => {
      qc.invalidateQueries({ queryKey: ['cards', evt.deckId] });
      qc.invalidateQueries({ queryKey: ['card'] });
      qc.invalidateQueries({ queryKey: qk.savedCards });
      // Events expose card IDs, not company IDs. These are local/repository
      // reads; do not invalidate researched dashboard tabs and spend keys.
      qc.invalidateQueries({ queryKey: ['companyMetrics'] });
      qc.invalidateQueries({ queryKey: qk.deck(evt.marketId) });
      onEvent?.(evt);
    });
    return unsub;
  }, [repo, qc, onEvent]);
}
