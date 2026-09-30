/**
 * useLivingDeck — mounts the LivingDeckRuntime for an open deck.
 *
 * Bridges the framework-free runtime to the app: the plan is computed from the
 * deck's cards (consistency audit + freshness ranking, both pure @mi/contracts
 * code), verification flows through the repository's live write path, and every
 * write-back invalidates exactly the queries it touched so open views update in
 * place. Dashboard research is intentionally click-driven.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isLowPower } from '@/lib/usage';
import {
  METRIC_TYPE_LABELS,
  auditDeckConsistency,
  metricDisplayLabel,
  selectStaleMetrics,
  verificationTargetsFrom,
  type CardWithCompany,
  type CompanyMetric,
  type MetricType,
} from '@mi/contracts';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { useApiKey } from '@/lib/settings/apiKey';
import { isCommunityDesktop } from '@/lib/settings/runtime';
import { qk } from '@/lib/query/keys';
import { traceAgent } from '@/lib/agentic/agentTrace';
import { formatMetricValue } from '@/lib/format';
import {
  LivingDeckRuntime,
  type AgentActivityEvent,
  type LivingStatus,
  type VerificationTarget,
} from './runtime';
/** Verification candidates considered per turn (top of the overdue ranking). */
const STALE_BUDGET_PER_TURN = 3;
const MAX_FEED_EVENTS = 30;

export interface LivingDeckState {
  events: AgentActivityEvent[];
  status: LivingStatus;
  deskCount: number;
  actionCount: number;
  pause: () => void;
  resume: () => void;
  /** False on transports with no live research. */
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
  // A provider key is not consent to spend it in the background. Opt-in is
  // deliberately scoped to this mounted deck view and must be repeated after
  // navigation/relaunch.
  const [authorizedDeckId, setAuthorizedDeckId] = useState<string | null>(null);
  const runtimeRef = useRef<LivingDeckRuntime | null>(null);

  // Latest cards without retriggering the effect — the runtime re-plans every
  // tick, so data refreshes flow in without a restart.
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const companyCards = useMemo(
    () => cards.filter((c) => c.card.cardType === 'company' && c.company),
    [cards],
  );
  const deskCount = companyCards.length;
  const hasKey = useApiKey((state) => state.hasKey);
  const researchAvailable = !isCommunityDesktop() || hasKey;
  const canVerify = researchAvailable && typeof repo.verifyMetric === 'function';

  useEffect(() => {
    if (!deckId || deskCount === 0 || !researchAvailable || !canVerify) {
      setStatus('stopped');
      setAuthorizedDeckId(null);
      return;
    }
    if (authorizedDeckId !== deckId) {
      setStatus('paused');
      setAuthorizedDeckId(null);
      return;
    }

    const seenFindings = new Set<string>();

    const nameOf = (companyId: string): string =>
      cardsRef.current.find((c) => c.company?.id === companyId)?.company?.name ?? 'A company';

    const toTarget = (
      companyId: string,
      metricType: MetricType,
      reason: 'consistency' | 'stale',
    ): VerificationTarget => {
      const metric = cardsRef.current
        .find((card) => card.company?.id === companyId)
        ?.metrics.find((candidate) => candidate.metricType === metricType);
      return {
        companyId,
        companyName: nameOf(companyId),
        metricType,
        metricLabel: metric ? metricDisplayLabel(metric) : METRIC_TYPE_LABELS[metricType],
        reason,
      };
    };

    const runtime = new LivingDeckRuntime({
      plan: (nowMs) => {
        const current = cardsRef.current.filter((c) => c.card.cardType === 'company' && c.company);
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

        const allMetrics: CompanyMetric[] = current.flatMap((c) => c.metrics);
        // LOW POWER MODE: the spending cap pauses autonomous re-verification;
        // manual fact-checks and reads still work.
        const staleTargets = isLowPower()
          ? []
          : selectStaleMetrics(allMetrics, nowMs, STALE_BUDGET_PER_TURN).map((candidate) =>
              toTarget(candidate.metric.companyId, candidate.metric.metricType, 'stale'),
            );

        return {
          consistencyTargets: isLowPower() ? [] : consistencyTargets,
          staleTargets,
          freshFindings,
        };
      },

      verify: canVerify
        ? async (target) => {
            const result = await repo.verifyMetric!({
              companyId: target.companyId,
              metricType: target.metricType as MetricType,
            });
            if (result.changed) {
              qc.invalidateQueries({ queryKey: qk.companyMetrics(target.companyId) });
              qc.invalidateQueries({ queryKey: ['cards'] });
              qc.invalidateQueries({ queryKey: ['dashboard', target.companyId] });
            }
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
    runtime.start(deskCount);
    setStatus(runtime.status);

    return () => {
      runtime.stop();
      runtimeRef.current = null;
    };
    // Restart only when the deck, explicit authorization, or transport changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, deskCount > 0, canVerify, researchAvailable, authorizedDeckId]);

  return {
    events,
    status,
    deskCount,
    actionCount,
    canVerify,
    pause: () => {
      runtimeRef.current?.pause();
      setAuthorizedDeckId(null);
      setStatus('paused');
    },
    resume: () => {
      if (!canVerify || !deckId) return;
      setAuthorizedDeckId(deckId);
    },
  };
}
