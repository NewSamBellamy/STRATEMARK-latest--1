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
  PROFILE_CORE_SLOTS,
  classifyMarketProfile,
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
import { readAssetSource } from '@/lib/repository/local-source-reader';
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

/** Tabs worth warming before the user asks — the cascade, in open-likelihood
 * order. Metrics leads (a pure local projection — each warm costs no provider
 * call), Overview next, then the research tabs within the runtime's maxActions
 * pacing; hunts and verifications always claim budget first. Each entry below
 * is one paced action per tick. */
const PREFETCH_TABS: Array<{ tab: DashboardTab; label: string }> = [
  { tab: 'metrics', label: 'Metrics' },
  { tab: 'overview', label: 'Overview' },
  { tab: 'live_intel', label: 'Live Intel' },
  { tab: 'mission_governance', label: 'Mission & Governance' },
  { tab: 'history', label: 'History' },
  { tab: 'team_org', label: 'Team & Org Chart' },
  { tab: 'products_roadmap', label: 'Products & Roadmap' },
  { tab: 'live_landing', label: 'Live Landing Page' },
];
/** Warm EVERY company's core tabs — the deck is not "done" until all its
 * dashboards are populated. One company per tick keeps the pacing honest;
 * the run-level feed shows the queue draining. */
const PREFETCH_COMPANY_LIMIT = Number.POSITIVE_INFINITY;
/** Verification candidates considered per turn (top of the overdue ranking). */
const STALE_BUDGET_PER_TURN = 3;
const MAX_FEED_EVENTS = 30;
// The core slots per market profile come from @mi/contracts — the same table
// the card face renders. A financial firm's deck hunts AUM where an operating
// company hunts users/ARR; the runtime and the card can never disagree.
const CORE_PROFILE_SLOTS = PROFILE_CORE_SLOTS;

// Hunts retry on an outcome-keyed ladder instead of firing once per company.
// One-shot recovery was the direct cause of zero-figure companies staying at
// zero: a hunt that came back empty (wrong query shape, quiet news day) never
// got another turn. Reserve BEFORE awaiting, cool down between attempts, and
// cap attempts per session so a genuinely undocumented company still bottoms
// out. Manual hunts remain unlimited; reopening the page resets the ladder.
const HUNT_ATTEMPTS_PER_SESSION = 3;
const HUNT_RETRY_COOLDOWN_MS = 10 * 60_000;
interface HuntAttemptRecord { attempts: number; lastAt: number }
const huntAttempts = new WeakMap<MarketIntelRepository, Map<string, HuntAttemptRecord>>();

// One automatic verification per (company, metric) per time window, for the
// same reason: a consistency finding that survives its check (or a check
// that ends unverified) must not re-spend a grounded query every tick. The
// freshness engine already cools the decay lane via lastVerificationAttemptAt,
// but consistency findings bypass it — this ledger closes that loop. Slots
// RE-OPEN after VERIFY_SLOT_COOLDOWN_MS so a deck keeps fact-checking itself
// across a long session instead of going silent after one pass; a changed
// figure re-opens its slot immediately. Manual fact-checks remain unlimited.
const VERIFY_SLOT_COOLDOWN_MS = 30 * 60_000;
const verifyAttempts = new WeakMap<MarketIntelRepository, Map<string, number>>();
/** Decks whose one-shot market-batch estimated fill already ran (WS5). */
const batchFilledDecks = new WeakMap<MarketIntelRepository, Set<string>>();
/** Companies whose asset-lane logo fill already ran this session. */
const assetFilledCompanies = new WeakMap<MarketIntelRepository, Set<string>>();

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
  const slots = CORE_PROFILE_SLOTS[classifyMarketProfile(card.company)];
  return slots
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
  const canVerifyBatch = canVerify && typeof repo.verifyCompanyMetrics === 'function';
  const canHunt = researchAvailable && typeof repo.huntCompanyMetrics === 'function';
  const canRecoverFree = researchAvailable && typeof repo.recoverSavedCompanyMetrics === 'function';
  const canBatchFill = researchAvailable && typeof repo.fillMissingMarketEstimates === 'function';
  const canReuseEvidence = researchAvailable && typeof repo.reuseCompanyEvidence === 'function';
  const canFillAssets = researchAvailable && typeof repo.fillCompanyAssets === 'function';

  // Asset lane, once per company per session: a real logo from the company's
  // own site replaces a guessed favicon. One bounded raw read per page, zero
  // provider calls; curated/Wikidata art is never touched and a failure keeps
  // the honest fallback.
  const fillAssetsOnce = (companyId: string): void => {
    if (!canFillAssets) return;
    let done = assetFilledCompanies.get(repo);
    if (!done) {
      done = new Set();
      assetFilledCompanies.set(repo, done);
    }
    if (done.has(companyId)) return;
    done.add(companyId);
    void repo.fillCompanyAssets!(companyId, readAssetSource).catch(() => { /* favicon fallback stays */ });
  };

  useEffect(() => {
    if (!deckId || deskCount === 0 || !researchAvailable) {
      setStatus('stopped');
      return;
    }

    const seenFindings = new Set<string>();
    const prefetched = new Set<string>();
    let hunts = huntAttempts.get(repo);
    if (!hunts) {
      hunts = new Map<string, HuntAttemptRecord>();
      huntAttempts.set(repo, hunts);
    }
    let verified = verifyAttempts.get(repo);
    if (!verified) {
      verified = new Map<string, number>();
      verifyAttempts.set(repo, verified);
    }
    const attemptedVerifications = verified;
    const nowMs = () => Date.now();
    // Already-loaded decks get their logo sweep immediately; streaming cards
    // are covered by the hunt handler below.
    for (const desk of entityDesks(cardsRef.current)) {
      if (desk.company?.id) fillAssetsOnce(desk.company.id);
    }
    const verificationOpen = (target: VerificationTarget) => {
      const last = attemptedVerifications.get(`${target.companyId}:${target.metricType}`);
      return last === undefined || nowMs() - last >= VERIFY_SLOT_COOLDOWN_MS;
    };

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
      // Full-deck dashboard warming: every company needs its core tabs, plus
      // hunts and verifications — scale the session budget with the deck size.
      // Session budget scaled for the full workload: every company's core tab
      // warm (2 each) plus the hunt ladder (up to 3 each) and verification
      // cooldown windows. Each lane self-limits now, so the budget only has
      // to outlast the lanes' worst case instead of rationing between them.
      maxActions: Math.max(60, deskCount * (PREFETCH_TABS.length + 5)),
      // Both gates must hold: low power pauses autonomous spend, and desks
      // wait while the deck's initial creation run is still in flight. The
      // old `isLowPower() ||` ran the desks THROUGH the spending cap.
      canAct: async () => !isLowPower() && !(await creationIsActive(repo, deckId)),
      nextRecovery: () => {
        if (!(canHunt || canRecoverFree) || isLowPower() || useResearchControl.getState().paused) return null;
        const now = nowMs();
        // Least-attempted first: every company with a core gap gets its first
        // hunt before anyone gets a second, and empty hunts escalate only
        // after the cooldown — never in the same breath as the failed one.
        const candidate = entityDesks(cardsRef.current)
          .filter(c => hasCoreGap(c))
          .map(c => {
            const entry = hunts.get(c.company!.id);
            return {
              card: c,
              attempts: entry?.attempts ?? 0,
              ready: !entry || now - entry.lastAt >= HUNT_RETRY_COOLDOWN_MS,
            };
          })
          .filter(x => x.ready && x.attempts < HUNT_ATTEMPTS_PER_SESSION)
          .sort((a, b) => a.attempts - b.attempts)[0];
        return candidate
          ? { companyId: candidate.card.company!.id, companyName: candidate.card.company!.name }
          : null;
      },
      recover: (canHunt || canRecoverFree) ? async target => {
        // Saved evidence is re-projected for free first. Best-effort: a failed
        // free pass must not consume the company's hunt-ladder attempt.
        let freeFilled = 0;
        // Cross-run reuse (WS6): a twin company from another deck lends its
        // retained evidence so free recovery can re-derive facts offline.
        if (canReuseEvidence) {
          try { await repo.reuseCompanyEvidence!(target.companyId); } catch { /* free recovery still runs */ }
        }
        // Market-batch first fill (WS5): once per session, ONE grounded call
        // soft-fills the whole roster's remaining core gaps before any
        // per-company hunt spends its ladder. Structured lanes still win
        // inside each hunt; this only pre-fills what they left open.
        if (canBatchFill && !batchFilledDecks.get(repo)?.has(deckId)) {
          const gapped = entityDesks(cardsRef.current)
            .filter((c) => hasCoreGap(c)).length;
          if (gapped >= 2) {
            if (!batchFilledDecks.get(repo)) batchFilledDecks.set(repo, new Set());
            batchFilledDecks.get(repo)!.add(deckId);
            try {
              const batch = await repo.fillMissingMarketEstimates!(deckId);
              if (batch.filledTypes > 0) {
                for (const desk of entityDesks(cardsRef.current)) {
                  await invalidateMetricSurfaces(qc, desk.company!.id, true);
                }
                // The batch's estimates count as this desk's free fill.
                freeFilled += batch.filledTypes;
              }
            } catch { /* per-company hunts remain the fallback */ }
          } else {
            if (!batchFilledDecks.get(repo)) batchFilledDecks.set(repo, new Set());
            batchFilledDecks.get(repo)!.add(deckId);
          }
        }
        if (canRecoverFree) {
          try {
            const free = await repo.recoverSavedCompanyMetrics!(target.companyId);
            freeFilled = free.filledTypes.length;
            if (freeFilled > 0) {
              await invalidateMetricSurfaces(qc, target.companyId, free.retieredCardIds.length > 0);
            }
          } catch { /* the paid hunt below still runs */ }
        }
        // Reserve before the call: a thrown hunt also spends this rung, so a
        // persistent failure cannot become a hot retry loop.
        const prior = hunts.get(target.companyId) ?? { attempts: 0, lastAt: 0 };
        const escalation = prior.attempts;
        hunts.set(target.companyId, { attempts: prior.attempts + 1, lastAt: nowMs() });
        // Opportunistic asset fill: a company being researched for figures is
        // also due its once-per-session logo resolution.
        fillAssetsOnce(target.companyId);
        if (!canHunt) return { filled: freeFilled };
        // Escalate after empty passes: pass 1 is the broad hunt; retries tell
        // the repository to vary its source strategy.
        const result = await repo.huntCompanyMetrics!(target.companyId, escalation > 0 ? { escalation } : undefined);
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
        // Which rows are "core" follows each company's market profile.
        const allMetrics: CompanyMetric[] = current.flatMap((c) => {
          const coreTypes = new Set(CORE_PROFILE_SLOTS[classifyMarketProfile(c.company)].flat());
          return c.metrics.filter(m =>
            !canHunt || !coreTypes.has(m.metricType) || (m.value != null && m.confidence !== 'unknown'));
        });
        // LOW POWER MODE: the spending cap pauses autonomous re-verification;
        // manual fact-checks and reads still work.
        const staleTargets = isLowPower()
          ? []
          : selectStaleMetrics(allMetrics, nowMs, STALE_BUDGET_PER_TURN).map((candidate) =>
              toTarget(candidate.metric.companyId, candidate.metric.metricType, 'stale'),
            );

        return {
          consistencyTargets: isLowPower() ? [] : consistencyTargets.filter(verificationOpen),
          staleTargets: staleTargets.filter(verificationOpen),
          freshFindings,
        };
      },

      verify: canVerify
        ? async (target) => {
            // Reserve before the call: a thrown verification also spends the
            // slot's cooldown window, so a persistent failure cannot become
            // a hot retry loop.
            attemptedVerifications.set(`${target.companyId}:${target.metricType}`, nowMs());
            // One batch action beats N per-metric actions: when a company has
            // several figures worth re-checking, one grounded pass verifies
            // them all (2 model calls instead of 2N) and promotes/demotes
            // against the same credibility gates.
            const estimatedCount = cardsRef.current
              .find((c) => c.company?.id === target.companyId)?.metrics
              .filter((m) => m.confidence === 'estimated' && m.value != null).length ?? 0;
            if (canVerifyBatch && estimatedCount >= 2) {
              const batch = await repo.verifyCompanyMetrics!(target.companyId);
              for (const row of batch.results) {
                const slot = `${target.companyId}:${row.metricType}`;
                if (row.changed) attemptedVerifications.delete(slot);
                else attemptedVerifications.set(slot, nowMs());
              }
              await invalidateMetricSurfaces(qc, target.companyId, batch.changedTypes.length > 0);
              const held = batch.results.filter((r) => r.verdict === 'supported' && !r.changed).length;
              const corrected = batch.results.filter((r) => r.changed).length;
              return {
                changed: batch.changedTypes.length > 0,
                citations: batch.citations.length,
                summary: `${batch.examined.length} figures re-checked: ${held} held, ${corrected} corrected`,
              };
            }
            const result = await repo.verifyMetric!({
              companyId: target.companyId,
              metricType: target.metricType as MetricType,
            });
            // A correction is new information: re-open the slot so the fresh
            // figure gets a consistency pass before its cooldown re-arms.
            if (result.changed) {
              attemptedVerifications.delete(`${target.companyId}:${target.metricType}`);
            }
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
