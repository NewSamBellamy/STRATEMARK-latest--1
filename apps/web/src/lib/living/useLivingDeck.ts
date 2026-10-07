/**
 * useLivingDeck — mounts the LivingDeckRuntime for an open deck.
 *
 * Bridges the framework-free runtime to the app: the plan is computed from the
 * deck's cards (consistency audit + freshness ranking, both pure @mi/contracts
 * code), verification flows through the repository's live write path, prefetch
 * warms TanStack Query AND the repository's persistent tab cache, and every
 * write-back invalidates exactly the queries it touched so open views update
 * in place.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isLowPower } from '@/lib/usage';
import {
  METRIC_TYPE_LABELS,
  isEntityCardType,
  auditDeckConsistency,
  selectStaleMetrics,
  verificationTargetsFrom,
  type CardWithCompany,
  type CompanyMetric,
  type DashboardTab,
  type MetricType,
  type MarketIntelRepository,
  type ResearchJob,
} from '@mi/contracts';
import { buildMetricViews } from '@/features/card/card-view';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { invalidateMetricSurfaces } from '@/hooks/data';
import { useApiKey } from '@/lib/settings/apiKey';
import { isCommunityDesktop } from '@/lib/settings/runtime';
import { qk } from '@/lib/query/keys';
import { traceAgent } from '@/lib/agentic/agentTrace';
import { formatMetricValue } from '@/lib/format';
import { useResearchControl } from './researchControl';
import {
  LivingDeckRuntime,
  type AgentActivityEvent,
  type LivingStatus,
  type PrefetchTarget,
  type VerificationTarget,
} from './runtime';

/** Tabs worth warming before the user asks, in open-likelihood order. */
const PREFETCH_TABS: Array<{ tab: DashboardTab; label: string }> = [
  { tab: 'overview', label: 'Overview' },
  { tab: 'metrics', label: 'Metrics' },
  { tab: 'live_intel', label: 'Live Intel' },
];
/** Warm the first N companies (deck order) — the ones a user opens first. */
const PREFETCH_COMPANY_LIMIT = 8;
/** Verification candidates considered per turn (top of the overdue ranking). */
const STALE_BUDGET_PER_TURN = 3;
const MAX_FEED_EVENTS = 30;
const CORE_PROFILE_SLOTS: readonly (readonly MetricType[])[] = [
  ['employees'], ['arr'], ['users'], ['valuation', 'market_cap'],
];
const CORE_PROFILE_TYPES = new Set(CORE_PROFILE_SLOTS.flat());

// One automatic hunt per company for this repository's lifetime. Reserve BEFORE
// awaiting: failures, slow invalidation, pause/resume, deck switches and remounts
// must not turn an unresolved gap into repeated paid hunts. Manual hunts remain
// available; reopening a deck does not reset this automatic recovery allowance.
const recoveryAttempts = new WeakMap<MarketIntelRepository, Set<string>>();

// Coalesce job reads across decks/remounts. Unknown readiness defers paid work;
// failures are cached too, so an unavailable transport cannot become a hot poll.
const JOB_CHECK_INTERVAL_MS = 60_000;
const jobChecks = new WeakMap<MarketIntelRepository, {
  expiresAt: number;
  result: Promise<ResearchJob[] | null>;
}>();

async function creationIsActive(repo: MarketIntelRepository, deckId: string): Promise<boolean> {
  if (!repo.listResearchJobs) return false;
  let check = jobChecks.get(repo);
  if (!check || Date.now() >= check.expiresAt) {
    const entry = { expiresAt: Infinity, result: Promise.resolve<ResearchJob[] | null>(null) };
    // Promise indirection also catches synchronous transport failures.
    entry.result = Promise.resolve().then(() => repo.listResearchJobs!()).catch(() => null)
      .finally(() => { entry.expiresAt = Date.now() + JOB_CHECK_INTERVAL_MS; });
    jobChecks.set(repo, entry);
    check = entry;
  }
  const jobs = await check.result;
  return jobs === null || jobs.some(job =>
    (job.status === 'queued' || job.status === 'running') &&
    (job.deck?.id === deckId || job.partialCards?.some(c => c.card.deckId === deckId)));
}

function entityDesks(cards: CardWithCompany[]): CardWithCompany[] {
  const seen = new Set<string>();
  return cards.filter(c => {
    if (!isEntityCardType(c.card.cardType) || !c.company || seen.has(c.company.id)) return false;
    seen.add(c.company.id);
    return true;
  });
}

function hasCoreGap(card: CardWithCompany): boolean {
  const metrics = buildMetricViews(card.metrics, card.company?.websiteUrl).map(view => view.metric);
  // Match the card's four core profile slots; either valuation or market cap
  // satisfies company value. Estimates with a value belong to verification.
  return CORE_PROFILE_SLOTS
    .some(types => !metrics.some(m => types.includes(m.metricType) && m.value != null && m.confidence !== 'unknown'));
}

export interface LivingDeckState {
  events: AgentActivityEvent[];
  status: LivingStatus;
  deskCount: number;
  actionCount: number;
  pause: () => void;
  resume: () => void;
  /** False on transports with no live research (mock/demo) — prefetch only. */
  canVerify: boolean;
}

export function useLivingDeck(
  deckId: string | undefined,
  cards: CardWithCompany[],
): LivingDeckState {
  const repo = useRepository();
  const qc = useQueryClient();
  const [events, setEvents] = useState<AgentActivityEvent[]>([]);
  const [status, setStatus] = useState<LivingStatus>('stopped');
  const [actionCount, setActionCount] = useState(0);
  const runtimeRef = useRef<LivingDeckRuntime | null>(null);
  const paused = useResearchControl(state => state.paused);

  // Latest cards without retriggering the effect — the runtime re-plans every
  // tick, so data refreshes flow in without a restart.
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const companyCards = useMemo(
    () => entityDesks(cards),
    [cards],
  );
  const deskCount = companyCards.length;
  const hasKey = useApiKey((state) => state.hasKey);
  const researchAvailable = !isCommunityDesktop() || hasKey;
  const canVerify = researchAvailable && typeof repo.verifyMetric === 'function';
  const canHunt = researchAvailable && typeof repo.huntCompanyMetrics === 'function';
  const canRecoverFree = researchAvailable && typeof repo.recoverSavedCompanyMetrics === 'function';

  useEffect(() => {
    if (!deckId || deskCount === 0 || !researchAvailable) {
      setStatus('stopped');
      return;
    }

    const seenFindings = new Set<string>();
    const prefetched = new Set<string>();
    let attempted = recoveryAttempts.get(repo);
    if (!attempted) {
      attempted = new Set<string>();
      recoveryAttempts.set(repo, attempted);
    }
    const attemptedCompanies = attempted;

    const nameOf = (companyId: string): string =>
      cardsRef.current.find((c) => c.company?.id === companyId)?.company?.name ?? 'A company';

    const toTarget = (
      companyId: string,
      metricType: MetricType,
      reason: 'consistency' | 'stale',
    ): VerificationTarget => ({
      companyId,
      companyName: nameOf(companyId),
      metricType,
      metricLabel: METRIC_TYPE_LABELS[metricType],
      reason,
    });

    const runtime = new LivingDeckRuntime({
      canAct: async () => isLowPower() || !(await creationIsActive(repo, deckId)),
      nextRecovery: () => {
        if (!(canHunt || canRecoverFree) || isLowPower() || useResearchControl.getState().paused) return null;
        const card = entityDesks(cardsRef.current).find(c =>
          !attemptedCompanies.has(c.company!.id) && hasCoreGap(c));
        return card ? { companyId: card.company!.id, companyName: card.company!.name } : null;
      },
      recover: (canHunt || canRecoverFree) ? async target => {
        // Saved evidence is re-projected for free first. Best-effort: a failed
        // free pass must not consume the company's one automatic hunt attempt.
        let freeFilled = 0;
        if (canRecoverFree) {
          try {
            const free = await repo.recoverSavedCompanyMetrics!(target.companyId);
            freeFilled = free.filledTypes.length;
            if (freeFilled > 0) {
              await invalidateMetricSurfaces(qc, target.companyId, free.retieredCardIds.length > 0);
            }
          } catch { /* the paid hunt below still runs */ }
        }
        attemptedCompanies.add(target.companyId);
        if (!canHunt) return { filled: freeFilled };
        // Fall through to the paid hunt even after a free fill: the hunt is
        // this company's single automatic attempt, and a partial recovery must
        // not leave the remaining core gaps unfilled for the repository's life.
        const result = await repo.huntCompanyMetrics!(target.companyId);
        await invalidateMetricSurfaces(qc, target.companyId,
          result.filledTypes.length > 0 || result.retieredCardIds.length > 0);
        return { filled: freeFilled + result.filledTypes.length };
      } : null,
      plan: (nowMs) => {
        const current = entityDesks(cardsRef.current);
        const audit = auditDeckConsistency(
          current.map((c) => ({
            companyId: c.company!.id,
            name: c.company!.name,
            metrics: c.metrics,
          })),
        );
        const freshFindings = audit
          .filter((f) => {
            const key = `${f.code}:${f.companyIds.join(',')}`;
            if (seenFindings.has(key)) return false;
            seenFindings.add(key);
            return true;
          })
          .map((f) => ({ message: f.message, severity: f.severity }));

        const consistencyTargets = verificationTargetsFrom(audit).map((t) =>
          toTarget(t.companyId, t.metricType, 'consistency'),
        );

        // Company hunts own unresolved core slots. Do not immediately spend
        // another query per unknown row after a bounded hunt found no evidence.
        const allMetrics: CompanyMetric[] = current.flatMap((c) => c.metrics).filter(m =>
          !canHunt || !CORE_PROFILE_TYPES.has(m.metricType) || (m.value != null && m.confidence !== 'unknown'));
        // LOW POWER MODE: the spending cap pauses autonomous re-verification;
        // manual fact-checks and reads still work.
        const staleTargets = isLowPower()
          ? []
          : selectStaleMetrics(allMetrics, nowMs, STALE_BUDGET_PER_TURN).map((candidate) =>
              toTarget(candidate.metric.companyId, candidate.metric.metricType, 'stale'),
            );

        return { consistencyTargets: isLowPower() ? [] : consistencyTargets, staleTargets, freshFindings };
      },

      verify: canVerify
        ? async (target) => {
            const result = await repo.verifyMetric!({
              companyId: target.companyId,
              metricType: target.metricType as MetricType,
            });
            await invalidateMetricSurfaces(qc, target.companyId, result.changed);
            const value = result.metric.value;
            const summary =
              result.changed && value != null
                ? `now ${formatMetricValue(target.metricType as MetricType, value)} (${result.citations.length} sources)`
                : result.verdict === 'supported'
                  ? 'figure holds'
                  : result.verdict === 'unverified'
                    ? 'no better figure found'
                    : 'left unchanged';
            return { changed: result.changed, citations: result.citations.length, summary };
          }
        : null,

      nextPrefetch: (): PrefetchTarget | null => {
        if (isLowPower() || useResearchControl.getState().paused) return null;
        const current = entityDesks(cardsRef.current)
          .slice(0, PREFETCH_COMPANY_LIMIT);
        for (const { tab, label } of PREFETCH_TABS) {
          for (const c of current) {
            const companyId = c.company!.id;
            const key = `${companyId}:${tab}`;
            if (prefetched.has(key)) continue;
            if (qc.getQueryData(qk.dashboard(companyId, tab)) !== undefined) {
              prefetched.add(key);
              continue;
            }
            return { companyId, companyName: c.company!.name, tab, tabLabel: label };
          }
        }
        return null;
      },

      prefetch: async (target) => {
        prefetched.add(`${target.companyId}:${target.tab}`);
        await qc.fetchQuery({
          queryKey: qk.dashboard(target.companyId, target.tab as DashboardTab),
          queryFn: () => repo.getDashboardTab(target.companyId, target.tab as DashboardTab),
          staleTime: Infinity,
        });
      },

      onEvent: (event) => {
        setEvents((prev) => [event, ...prev].slice(0, MAX_FEED_EVENTS));
        setActionCount(runtime.actionCount);
        setStatus(runtime.status);
        // Mirror into the global agent trace (the floating presence bubble):
        // labeled by desk, real events only.
        traceAgent(
          event.companyName ? `${event.companyName} desk` : 'Deck sentinel',
          event.message,
          event.citations ? `${event.citations} sources` : null,
        );
      },
    });

    runtimeRef.current = runtime;
    const syncControl = () => {
      if (useResearchControl.getState().paused) {
        runtime.pause();
        setStatus('paused');
      } else {
        if (runtime.status === 'stopped') runtime.start(deskCount, canVerify || canHunt);
        else runtime.resume();
        setStatus(runtime.status);
      }
    };
    syncControl();
    const unsubscribe = useResearchControl.subscribe(syncControl);

    return () => {
      unsubscribe();
      runtime.stop();
      runtimeRef.current = null;
    };
    // Restart only when the deck itself (or transport capability) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, deskCount > 0, canVerify, canHunt, researchAvailable, repo, qc]);

  return {
    events,
    status: paused ? 'paused' : status,
    deskCount,
    actionCount,
    // Existing feed consumers use this as the live-research capability flag.
    canVerify: canVerify || canHunt,
    pause: () => {
      useResearchControl.getState().setPaused(true);
    },
    resume: () => {
      useResearchControl.getState().setPaused(false);
    },
  };
}
