/**
 * Inline grounded fact-check. Sits next to any claim/figure; on click it runs a
 * live Google-Search verification and renders a verdict pill + rationale +
 * sources in place — the "always be able to fact-check" affordance.
 *
 * When the claim IS a stored metric (companyId + metricType provided) a
 * contradiction is no longer a dead end: the verdict carries the corrected
 * figure, and one click applies it through the repository's live-verification
 * write path — the value revises with citations, the company re-tiers, and
 * every open view updates. A fact-check that can't fix anything is a smoke
 * detector without a bell.
 */
import { useEffect, useRef, useState } from 'react';
import {
  CheckCheck,
  ExternalLink,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Wand2,
} from 'lucide-react';
import type {
  FactCheckResult,
  FactCheckVerdict,
  MetricType,
  UserFootprintBasis,
} from '@mi/contracts';
import { useFactCheck, useVerifyMetric } from '@/hooks/data';
import { formatMetricValue } from '@/lib/format';
import { cn } from '@/lib/cn';

const VERDICT_STYLE: Record<
  FactCheckVerdict,
  { label: string; cls: string; Icon: typeof ShieldCheck }
> = {
  supported: {
    label: 'Supported',
    cls: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    Icon: ShieldCheck,
  },
  contradicted: {
    label: 'Contradicted',
    cls: 'border-rose-300 bg-rose-50 text-rose-800',
    Icon: ShieldAlert,
  },
  unverified: {
    label: 'Unverified',
    cls: 'border-slate-300 bg-slate-100 text-slate-700',
    Icon: ShieldQuestion,
  },
};

export function FactCheck({
  claim,
  companyName,
  context,
  companyId,
  metricType,
  metricId,
  userBasis,
  storedValue,
  className,
}: {
  claim: string;
  companyName: string | null;
  context?: string | null;
  /** Present when the claim is a stored metric — unlocks one-click correction. */
  companyId?: string | null;
  metricType?: MetricType | null;
  metricId?: string | null;
  userBasis?: UserFootprintBasis;
  storedValue?: number | null;
  className?: string;
}) {
  const factCheck = useFactCheck();
  const verify = useVerifyMetric();
  const [result, setResult] = useState<FactCheckResult | null>(null);
  // What the write-back actually did — the confirmation must tell the truth:
  // 'corrected' when the stored value/badge changed, 'confirmed' when live
  // evidence re-affirmed the stored figure (freshness stamp still updates).
  const [applied, setApplied] = useState<'corrected' | 'confirmed' | null>(null);

  const run = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (factCheck.isPending) return;
    factCheck.mutate(
      {
        claim,
        companyName,
        context: context ?? null,
        companyId: companyId ?? null,
        metricType: metricType ?? null,
        metricId: metricId ?? null,
        userBasis,
        storedValue: storedValue ?? null,
      },
      { onSuccess: setResult },
    );
  };

  const metricAnchored = !!companyId && !!metricType && verify.isAvailable && !applied;
  const canApply =
    result?.verdict === 'contradicted' && result.correctedValue != null && metricAnchored;
  // A non-supported verdict with NO usable correction still demands action —
  // "contradicted" with nothing happening is the exact failure the founder
  // filmed twice. These run the full re-verification (which can correct,
  // downgrade, or re-confirm) instead of the fast path.
  const needsFullReconcile =
    metricAnchored &&
    result != null &&
    result.verdict !== 'supported' &&
    !(result.verdict === 'contradicted' && result.correctedValue != null);

  // AUTO-RECONCILE: any anchored, non-supported verdict resolves ITSELF.
  // Contradicted with a cited figure → the fast path applies that exact
  // evidence (milliseconds). Contradicted without a usable figure, or
  // unverified → the full re-verification runs automatically. Nothing waits
  // for a click; the buttons below remain only as retry paths.
  const autoFired = useRef(false);
  useEffect(() => {
    if (autoFired.current || verify.isPending || !companyId || !metricType) return;
    if (!canApply && !needsFullReconcile) return;
    autoFired.current = true;
    verify.mutate(
      {
        companyId,
        metricType,
        metricId: metricId ?? undefined,
        userBasis,
        correction:
          canApply && result?.correctedValue != null
            ? {
                value: result.correctedValue,
                citations: result.citations,
                rationale: result.rationale ?? null,
                asOf: result.correctedAsOf ?? null,
              }
            : null,
      },
      { onSuccess: (res) => setApplied(res.changed ? 'corrected' : 'confirmed') },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canApply, needsFullReconcile]);
  // Manual retry path for the full-reconcile case (auto already fired once).
  const canReconcile = needsFullReconcile;

  const apply = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!companyId || !metricType || verify.isPending) return;
    // The reconciliation ran either way: a correction wrote back, a downgrade
    // wrote back, or fresh evidence re-confirmed the badge. All three resolve
    // the on-screen disagreement. A contradicted verdict carries its own
    // evidence — passed through so the retry is instant, not a re-hunt.
    verify.mutate(
      {
        companyId,
        metricType,
        metricId: metricId ?? undefined,
        userBasis,
        correction:
          result?.verdict === 'contradicted' && result.correctedValue != null
            ? {
                value: result.correctedValue,
                citations: result.citations,
                rationale: result.rationale ?? null,
                asOf: result.correctedAsOf ?? null,
              }
            : null,
      },
      { onSuccess: (res) => setApplied(res.changed ? 'corrected' : 'confirmed') },
    );
  };

  if (result) {
    const v = VERDICT_STYLE[result.verdict];
    return (
      <div
        className={cn('rounded-lg border border-border bg-surface-2 p-2.5 text-left', className)}
      >
        <span className={cn('chip', v.cls)}>
          <v.Icon className="h-3.5 w-3.5" />
          {v.label}
        </span>
        {result.rationale && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{result.rationale}</p>
        )}
        {canApply && metricType && (
          <button
            type="button"
            onClick={apply}
            disabled={verify.isPending}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
          >
            {verify.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Wand2 className="h-3 w-3" />
            )}
            {verify.isPending
              ? `Correcting to ${formatMetricValue(metricType, result.correctedValue!)}…`
              : `Retry correction to ${formatMetricValue(metricType, result.correctedValue!)}`}
          </button>
        )}
        {canReconcile && (
          <button
            type="button"
            onClick={apply}
            disabled={verify.isPending}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
          >
            {verify.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Wand2 className="h-3 w-3" />
            )}
            {verify.isPending ? 'Re-verifying…' : 'Re-verify & update the badge'}
          </button>
        )}
        {result.verdict === 'supported' && metricType && (
          <p className="mt-1.5 text-[11px] font-medium text-positive">
            Confirms the stored figure.
          </p>
        )}
        {applied && (
          <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-positive">
            <CheckCheck className="h-3.5 w-3.5" />
            {applied === 'corrected'
              ? 'Corrected from live sources — value, badge, card, and stage updated everywhere.'
              : 'Re-checked against live sources — the stored figure stands; freshness updated.'}
          </p>
        )}
        {result.citations.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {result.citations.slice(0, 4).map((c, i) => (
              <a
                key={i}
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary-ink hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-3 w-3" />
                {c.title || 'source'}
              </a>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={factCheck.isPending}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted transition-colors hover:border-primary/50 hover:text-primary-ink disabled:opacity-60',
        className,
      )}
    >
      {factCheck.isPending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <ShieldQuestion className="h-3 w-3" />
      )}
      {factCheck.isPending ? 'Checking…' : 'Fact-check'}
    </button>
  );
}
