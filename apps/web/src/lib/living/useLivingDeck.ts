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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isLowPower } from '@/lib/usage';
import { yieldsToFocus } from './researchFocus';
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
import { batchRestKey, endRest, huntRestKey, isResting, signalsRestKey, startRest, verifyRestKey } from './ambientRest';
import { useResearchControl } from './researchControl';
import { runFaceSweep, selectFaceSweepTargets, type FaceSweepResult } from './faceSweep';
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
// One automatic attempt per company per session. Measured on a fresh 16-company deck
// (2026-10-15): creation already runs a plain and an escalated pass for every company
// with a gap, and the ambient ladder then repeated the SAME two prompts and a third,
// 75 hunts for 16 companies ($3.4 of a $9.7 deck, the largest single cost); of the 37
// figures the deck ended with, 7 arrived after the creation passes. A private company's
// valuation or revenue that two passes could not find is not there to find on the third.
// A manual "Find more metrics" stays unlimited.
const HUNT_ATTEMPTS_PER_SESSION = 1;
// Short enough that a watched deck keeps filling (a 10-minute wait read as
// "stuck at half-filled"); the 3-attempt cap is what bounds spend.
const HUNT_RETRY_COOLDOWN_MS = 90_000;
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
/** Decks whose automatic post-reveal face sweep already ran this session. */
const sweptDecks = new WeakMap<MarketIntelRepository, Set<string>>();
/** Decks with a face sweep in flight (manual and automatic share one run). */
const sweepsInFlight = new WeakMap<MarketIntelRepository, Map<string, Promise<FaceSweepResult>>>();
/** Companies whose asset-lane logo fill already ran this session. */
const assetFilledCompanies = new WeakMap<MarketIntelRepository, Set<string>>();

// Coalesce job reads across decks/remounts. Unknown readiness defers paid work;
// failures are cached too, so an unavailable transport cannot become a hot poll.
const JOB_CHECK_INTERVAL_MS = 60_000;
// While a creation job is queued/running, poll briskly so the first hunts start
// the moment creation completes instead of up to a minute later.
const JOB_CHECK_ACTIVE_INTERVAL_MS = 5_000;
const jobChecks = new WeakMap<MarketIntelRepository, {
  expiresAt: number;
  result: Promise<ResearchJob[] | null>;
}>();

/** A running job whose record goes this long without a persist is de facto
 * dead — every active stage persists per card. The repository's stall
 * watchdog force-completes such records; until it lands (older persisted
 * state, other transports), the gate itself must not rest the runtime on a
 * zombie job: live-verified, a hung summary tail held a job 'running' for
 * 13+ minutes with zero provider activity while cards never filled. */
const CREATION_STALL_MS = 6 * 60_000;

async function creationIsActive(repo: MarketIntelRepository, deckId: string): Promise<boolean> {
  if (!repo.listResearchJobs) return false;
  let check = jobChecks.get(repo);
  if (!check || Date.now() >= check.expiresAt) {
    const entry = { expiresAt: Infinity, result: Promise.resolve<ResearchJob[] | null>(null) };
    // Promise indirection also catches synchronous transport failures.
    entry.result = Promise.resolve().then(() => repo.listResearchJobs!()).catch(() => null)
      .then(jobs => {
        const active = jobs?.some(job => job.status === 'queued' || job.status === 'running') ?? false;
        entry.expiresAt = Date.now() + (active ? JOB_CHECK_ACTIVE_INTERVAL_MS : JOB_CHECK_INTERVAL_MS);
        return jobs;
      }, () => { entry.expiresAt = Date.now() + JOB_CHECK_INTERVAL_MS; return null; });
    jobChecks.set(repo, entry);
    check = entry;
  }
  const jobs = await check.result;
  if (jobs === null) return true;
  const now = Date.now();
  return jobs.some(job => {
    if (job.status !== 'queued' && job.status !== 'running') return false;
    if (job.deck?.id !== deckId && !job.partialCards?.some(c => c.card.deckId === deckId)) return false;
    // Unknown recency defers (safe default); a parsed-and-stale record is a
    // zombie and must not rest the runtime on it.
    const lastTouch = Date.parse(job.updatedAt || job.createdAt);
    return !(Number.isFinite(lastTouch) && now - lastTouch >= CREATION_STALL_MS);
  });
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
  const metrics = buildMetricViews(card.metrics, card.company?.websiteUrl, card.company?.ownership).map(view => view.metric);
  // Match the card's four core profile slots; either valuation or market cap
  // satisfies company value. Estimates with a value belong to verification.
  const slots = CORE_PROFILE_SLOTS[classifyMarketProfile(card.company)];
  return slots
    .some(types => !metrics.some(m => types.includes(m.metricType) &&
      ((m.value != null && m.confidence !== 'unknown') ||
        // A stated headcount band fills the employees slot (range, not a point).
        (m.metricType === 'employees' && m.value == null && m.confidence === 'estimated' && m.reportedBand != null))));
}

export interface LivingDeckState {
  events: AgentActivityEvent[];
  status: LivingStatus;
  deskCount: number;
  actionCount: number;
  pause: () => void;
  resume: () => void;
  /**
   * "Fill card faces": one targeted grounded pass over every company card with
   * an empty face slot, concurrency 6, outside the per-session hunt cap and
   * cooldown. Safe to call repeatedly; a call during a running sweep joins it.
   */
  fillCardFaces: () => Promise<FaceSweepResult>;
  /** False on transports with no live research (mock/demo) — prefetch only. */
  canVerify: boolean;
}

export function useLivingDeck(
  deckId: string | undefined,
  cards: CardWithCompany[],
  options: { /** Automatic post-reveal face sweep; on by default. */ faceSweep?: boolean } = {},
): LivingDeckState {
  const autoFaceSweep = options.faceSweep !== false;
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
  const canFillOwnership = researchAvailable && typeof repo.fillCompanyOwnership === 'function';
  const canEnsureSignals = researchAvailable && typeof repo.ensureSignalCards === 'function';

  const canSweep = researchAvailable && (canHunt || canRecoverFree);
  const sweepEventId = useRef(0);
  const pushSweepEvent = useCallback((message: string, companyName: string | null, kind: AgentActivityEvent['kind']) => {
    sweepEventId.current += 1;
    const event: AgentActivityEvent = { id: -sweepEventId.current, at: Date.now(), kind, companyName, message };
    setEvents((prev) => [event, ...prev].slice(0, MAX_FEED_EVENTS));
  }, []);

  /** The sweep. Joins an in-flight run for the same deck instead of doubling spend. The automatic
   * one skips a company that was searched automatically in the last few days (ambientRest): a page
   * reload is a new session, and must not pay for the same searches again. */
  const sweepFaces = useCallback(async (automatic: boolean): Promise<FaceSweepResult> => {
    const empty: FaceSweepResult = { targeted: 0, filledCompanies: 0, filledTypes: 0, failed: 0 };
    if (!deckId || !canSweep) return empty;
    let running = sweepsInFlight.get(repo);
    if (!running) { running = new Map(); sweepsInFlight.set(repo, running); }
    const existing = running.get(deckId);
    if (existing) return existing;
    const cards = automatic ? cardsRef.current.filter((c) => !c.company || !isResting(huntRestKey(c.company.id))) : cardsRef.current;
    const targets = selectFaceSweepTargets(cards).length;
    if (targets === 0) return empty;
    pushSweepEvent(`Filling card faces — ${targets} ${targets === 1 ? 'card has' : 'cards have'} empty slots`, null, 'hunting');
    const run = runFaceSweep(cards, {
      repo,
      shouldStop: () => useResearchControl.getState().paused,
      onCompany: async (target, outcome) => {
        // The sweep's searches were this company's automatic attempt: the ladder
        // repeating them paid a third search for figures two passes did not find.
        // A company the sweep did not search (free recovery filled its face but a
        // core slot may still be open), or one paused before its escalated pass,
        // keeps its ladder hunt.
        if (outcome.searched && !outcome.stopped && !outcome.failed) {
          let ladder = huntAttempts.get(repo);
          if (!ladder) { ladder = new Map(); huntAttempts.set(repo, ladder); }
          ladder.set(target.companyId, { attempts: HUNT_ATTEMPTS_PER_SESSION, lastAt: Date.now() });
          startRest(huntRestKey(target.companyId));
        }
        await invalidateMetricSurfaces(qc, target.companyId, outcome.filled > 0);
        pushSweepEvent(outcome.failed
          ? `Card-face fill did not complete for ${target.companyName}`
          : outcome.filled > 0
            ? `Filled ${outcome.filled} card-face ${outcome.filled === 1 ? 'figure' : 'figures'} for ${target.companyName}`
            : `No sourced card-face figures found for ${target.companyName}`,
        target.companyName, outcome.failed ? 'error' : outcome.filled > 0 ? 'hunted' : 'checked');
      },
    }).finally(() => { running!.delete(deckId); });
    running.set(deckId, run);
    return run;
  }, [deckId, canSweep, repo, qc, pushSweepEvent]);
  /** The button's sweep: every empty face, resting or not. (Not passed a click event as a flag.) */
  const fillCardFaces = useCallback(() => sweepFaces(false), [sweepFaces]);
  const sweepFacesRef = useRef(sweepFaces);
  sweepFacesRef.current = sweepFaces;

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
    // One delayed retry after a failure (offline blip, slow site) instead of
    // never trying again this session; a second failure keeps the fallback.
    const attempt = (retry: boolean): void => {
      void repo.fillCompanyAssets!(companyId, readAssetSource).catch(() => {
        if (retry) setTimeout(() => attempt(false), 30_000);
      });
    };
    attempt(true);
    // Ownership (acquired / acquisition pending), same once-per-session budget.
    // Only a newly found record refreshes the card and header surfaces.
    if (canFillOwnership) {
      void repo.fillCompanyOwnership!(companyId)
        .then(({ ownership }) => ownership
          ? Promise.all([invalidateMetricSurfaces(qc, companyId, true), qc.invalidateQueries({ queryKey: qk.company(companyId) })])
          : undefined)
        .catch(() => { /* no status is shown without evidence */ });
    }
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
    // The slot's cooldown also survives a reload (ambientRest): a new page is not a reason to re-check at once.
    const verificationOpen = (target: VerificationTarget) => {
      const last = attemptedVerifications.get(`${target.companyId}:${target.metricType}`);
      return (last === undefined || nowMs() - last >= VERIFY_SLOT_COOLDOWN_MS)
        && !isResting(verifyRestKey(target.companyId, target.metricType), nowMs(), VERIFY_SLOT_COOLDOWN_MS);
    };
    const markVerified = (companyId: string, metricType: string) => {
      attemptedVerifications.set(`${companyId}:${metricType}`, nowMs());
      startRest(verifyRestKey(companyId, metricType));
    };
    const reopenVerification = (companyId: string, metricType: string) => {
      attemptedVerifications.delete(`${companyId}:${metricType}`);
      endRest(verifyRestKey(companyId, metricType));
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
      nextRecovery: (exclude) => {
        if (!(canHunt || canRecoverFree) || isLowPower() || useResearchControl.getState().paused) return null;
        // The face sweep goes first: it searches up to ten companies at once, where a
        // ladder hunt pays a search per company. The ladder takes what it leaves.
        if (autoFaceSweep && canSweep && (!sweptDecks.get(repo)?.has(deckId) || sweepsInFlight.get(repo)?.has(deckId))) return null;
        const now = nowMs();
        // Least-attempted first: every company with a core gap gets its first
        // hunt before anyone gets a second, and empty hunts escalate only
        // after the cooldown — never in the same breath as the failed one.
        const candidate = entityDesks(cardsRef.current)
          .filter(c => hasCoreGap(c) && !exclude?.has(c.company!.id) && !isResting(huntRestKey(c.company!.id)))
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
          if (gapped >= 2 && !isResting(batchRestKey(deckId))) {
            if (!batchFilledDecks.get(repo)) batchFilledDecks.set(repo, new Set());
            batchFilledDecks.get(repo)!.add(deckId);
            startRest(batchRestKey(deckId));
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
        startRest(huntRestKey(target.companyId));
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
            markVerified(target.companyId, target.metricType);
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
                if (row.changed) reopenVerification(target.companyId, row.metricType);
                else markVerified(target.companyId, row.metricType);
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
              reopenVerification(target.companyId, target.metricType);
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
            if (prefetched.has(key) || yieldsToFocus(companyId)) continue;
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

    // Automatic face sweep right after reveal: once per deck per session, as
    // soon as the creation run is no longer active (the same readiness gate
    // the desks use), unless research is paused or low-power.
    let sweepTimer: ReturnType<typeof setTimeout> | null = null;
    let sweepCancelled = false;
    const autoSweep = async () => {
      sweepTimer = null;
      if (sweepCancelled || !canSweep) return;
      let swept = sweptDecks.get(repo);
      if (!swept) { swept = new Set(); sweptDecks.set(repo, swept); }
      if (swept.has(deckId)) return;
      const blocked = isLowPower() || useResearchControl.getState().paused || await creationIsActive(repo, deckId);
      if (sweepCancelled) return;
      if (blocked) { sweepTimer = setTimeout(() => { void autoSweep(); }, 5_000); return; }
      // Cards may still be streaming into the query cache right after reveal.
      if (selectFaceSweepTargets(cardsRef.current).length === 0 && cardsRef.current.length === 0) {
        sweepTimer = setTimeout(() => { void autoSweep(); }, 5_000);
        return;
      }
      swept.add(deckId);
      void sweepFacesRef.current(true).catch(() => { /* faces stay honestly Unknown */ });
    };
    if (autoFaceSweep) sweepTimer = setTimeout(() => { void autoSweep(); }, 1_000);

    // Market signals: a deck short of barrier, insight, vice or culture cards (a first-pass search that errored, or an
    // older deck) gets one targeted search for what is missing, once the deck is no longer being created. A search that
    // found nothing rests like the other automatic searches; one that errored does not, so the next open tries again.
    let signalTimer: ReturnType<typeof setTimeout> | null = null;
    let signalsCancelled = false;
    const SIGNAL_KINDS = ['barrier', 'insight', 'vice', 'culture'] as const;
    const SIGNAL_MINIMUM = 4;
    const autoSignals = async () => {
      signalTimer = null;
      if (signalsCancelled || !canEnsureSignals) return;
      const have = (kind: string) => cardsRef.current.filter((c) => c.card.cardType === kind).length;
      if (cardsRef.current.length === 0) { signalTimer = setTimeout(() => { void autoSignals(); }, 5_000); return; }
      if (!SIGNAL_KINDS.some((kind) => have(kind) < SIGNAL_MINIMUM) || isResting(signalsRestKey(deckId))) return;
      const blocked = isLowPower() || useResearchControl.getState().paused || await creationIsActive(repo, deckId);
      if (signalsCancelled) return;
      if (blocked) { signalTimer = setTimeout(() => { void autoSignals(); }, 5_000); return; }
      try {
        const result = await repo.ensureSignalCards!(deckId);
        if (!result.failed) startRest(signalsRestKey(deckId));
      } catch { /* the next open tries again */ }
    };
    signalTimer = setTimeout(() => { void autoSignals(); }, 3_000);

    return () => {
      sweepCancelled = true;
      if (sweepTimer) clearTimeout(sweepTimer);
      signalsCancelled = true;
      if (signalTimer) clearTimeout(signalTimer);
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
    fillCardFaces,
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
