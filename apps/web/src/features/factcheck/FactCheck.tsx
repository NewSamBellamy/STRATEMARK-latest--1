/** Stored metrics use one protected verification/write-back; narratives remain read-only checks. */
import { useState } from 'react';
import { CheckCheck, ExternalLink, Loader2, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import type { FactCheckResult, FactCheckVerdict, MetricType, VerifyMetricResult } from '@mi/contracts';
import { useFactCheck, useVerifyMetric } from '@/hooks/data';
import { cn } from '@/lib/cn';

const VERDICT_STYLE: Record<FactCheckVerdict, { label: string; cls: string; Icon: typeof ShieldCheck }> = {
  supported: { label: 'Supported', cls: 'border-emerald-300 bg-emerald-50 text-emerald-800', Icon: ShieldCheck },
  contradicted: { label: 'Contradicted', cls: 'border-rose-300 bg-rose-50 text-rose-800', Icon: ShieldAlert },
  unverified: { label: 'Unverified', cls: 'border-slate-300 bg-slate-100 text-slate-700', Icon: ShieldQuestion },
};

export function FactCheck({ claim, companyName, context, companyId, metricType, className }: {
  claim: string; companyName: string | null; context?: string | null;
  companyId?: string | null; metricType?: MetricType | null; storedValue?: number | null; className?: string;
}) {
  const factCheck = useFactCheck();
  const verify = useVerifyMetric();
  const [result, setResult] = useState<FactCheckResult | null>(null);
  const [outcome, setOutcome] = useState<VerifyMetricResult | null>(null);
  const anchored = !!companyId && !!metricType;
  const pending = verify.isPending || factCheck.isPending;
  const unavailable = anchored && !verify.isAvailable;

  const run = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (pending || unavailable) return;
    setResult(null);
    setOutcome(null);
    if (companyId && metricType) {
      // Never show a summary-only verdict first or silently launch a second hunt.
      verify.mutate({ companyId, metricType }, { onSuccess: (verified) => {
        setOutcome(verified);
        setResult({ verdict: verified.verdict, rationale: verified.rationale, citations: verified.citations });
      } });
    } else {
      factCheck.mutate({ claim, companyName, context: context ?? null }, { onSuccess: setResult });
    }
  };

  const confirmation = outcome ? outcome.metric.confidence === 'user_verified'
    ? 'Your human-reviewed figure was preserved; automated research did not replace it.'
    : outcome.verdict === 'unverified'
      ? 'The figure remains unverified. This attempt did not renew its evidence.'
      : outcome.changed && outcome.verdict === 'contradicted'
        ? 'Stored figure updated from accepted evidence; connected views refreshed.'
        : 'Stored figure supported by accepted evidence.'
    : null;

  if (result) {
    const style = VERDICT_STYLE[result.verdict];
    return <div className={cn('rounded-lg border border-border bg-surface-2 p-2.5 text-left', className)}>
      <span className={cn('chip', style.cls)}><style.Icon className="h-3.5 w-3.5" />{style.label}</span>
      {result.rationale && <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{result.rationale}</p>}
      {confirmation && <p className={cn('mt-2 inline-flex items-center gap-1 text-[11px] font-medium',
        outcome?.verdict === 'unverified' ? 'text-muted' : 'text-positive')}>
        {outcome?.verdict !== 'unverified' && <CheckCheck className="h-3.5 w-3.5" />}{confirmation}
      </p>}
      {outcome?.verdict === 'unverified' && <button type="button" onClick={run} disabled={pending}
        className="mt-2 block text-[11px] text-primary-ink hover:underline">Retry verification</button>}
      {result.citations.length > 0 && <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {result.citations.slice(0, 4).map((citation, index) => <a key={index} href={citation.url}
          target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary-ink hover:underline"
          onClick={event => event.stopPropagation()}><ExternalLink className="h-3 w-3" />{citation.title || 'source'}</a>)}
      </div>}
    </div>;
  }

  const failed = anchored ? verify.isError : factCheck.isError;
  return <div className={className}>
    <button type="button" onClick={run} disabled={pending || unavailable}
      title={unavailable ? 'This research connection does not support stored-metric verification.' : undefined}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted transition-colors hover:border-primary/50 hover:text-primary-ink disabled:opacity-60">
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldQuestion className="h-3 w-3" />}
      {pending ? 'Checking…' : unavailable ? 'Verification unavailable' : failed ? 'Retry verification' : 'Fact-check'}
    </button>
    {failed && <p role="alert" className="mt-1 text-[11px] text-muted">The check could not finish. No result has been confirmed; try again.</p>}
  </div>;
}
