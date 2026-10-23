/** The evidence-based parts of a site audit (version 2): how far to trust it, the weighted criteria with the page's own words, the fixed-rule checklist and the prioritised fixes. */
import { AlertTriangle, CheckCircle2, CircleHelp, XCircle } from 'lucide-react';
import type { SiteAuditCheck, SiteAuditContent, SiteAuditCriterion, SiteAuditFinding, SiteAuditFix } from '@mi/contracts';
import { cn } from '@/lib/cn';

const H2 = 'mb-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted';

/** The page's own words (or the search context's) behind a finding. */
export function EvidenceQuote({ finding }: { finding: SiteAuditFinding }) {
  if (finding.notObservable) return <p className="mt-1 text-[12px] italic text-faint">Not observable from what was supplied</p>;
  if (!finding.quote) return null;
  return (
    <p className="mt-1 border-l-2 border-border pl-2.5 text-[12px] italic leading-snug text-muted">
      “{finding.quote}”
      <span className="not-italic text-faint"> · {finding.evidenceSource === 'search' ? 'from web context' : 'from the page'}</span>
    </p>
  );
}

/** Says plainly when the audit could not read the page or only part of the rubric could be observed. */
export function ConfidenceBanner({ audit }: { audit: SiteAuditContent }) {
  const c = audit.confidence;
  if (!c) return null;
  const weak = c.level !== 'high' || !c.pageRead;
  return (
    <div
      role="status"
      className={cn(
        'mt-6 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[13px] leading-snug',
        weak ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-border bg-surface-muted text-muted',
      )}
      data-testid="audit-confidence"
    >
      {weak ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />}
      <p>
        <strong className="font-semibold">{c.level[0]!.toUpperCase()}{c.level.slice(1)} confidence</strong>
        {` · ${Math.round(c.coverage * 100)}% of the rubric could be judged. `}
        {c.note}
        {audit.droppedFindings ? ` ${audit.droppedFindings} finding${audit.droppedFindings === 1 ? ' was' : 's were'} removed because the page did not support it.` : ''}
      </p>
    </div>
  );
}

function tone(score: number) {
  return score >= 8 ? 'bg-emerald-500' : score >= 5 ? 'bg-amber-500' : 'bg-rose-500';
}

function Criterion({ c }: { c: SiteAuditCriterion }) {
  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-content">{c.label}</h3>
        <span className="shrink-0 text-[11px] text-faint">{c.weight}% of the score</span>
      </div>
      {c.score != null ? (
        <>
          <div className="mt-2 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div className={cn('h-full rounded-full', tone(c.score))} style={{ width: `${c.score * 10}%` }} />
            </div>
            <span className="font-display text-sm font-bold tabular-nums text-content">{c.score}<span className="text-faint">/10</span></span>
          </div>
          <p className="mt-1 text-[11px] text-faint">{c.scoredBy === 'checks' ? 'Computed from the page by fixed rules' : 'Judged against the rubric'}</p>
        </>
      ) : (
        <p className="mt-2 text-[12.5px] italic text-faint">Not observable from what was supplied, so it is not scored.</p>
      )}
      {c.verdict && <p className="mt-2 text-[13px] leading-snug text-muted">{c.verdict}</p>}
      {c.findings.length > 0 && (
        <ul className="mt-3 space-y-2.5">
          {c.findings.map((f, i) => (
            <li key={i}>
              <p className="text-[13px] font-medium text-content">{f.title}</p>
              {f.detail && <p className="text-[12.5px] leading-snug text-muted">{f.detail}</p>}
              <EvidenceQuote finding={f} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function CriteriaSection({ criteria }: { criteria: readonly SiteAuditCriterion[] }) {
  if (criteria.length === 0) return null;
  return (
    <section className="mt-8" aria-label="Rubric">
      <h2 className={H2}>Rubric: weighted, with the page's own words</h2>
      <ul className="grid gap-3 sm:grid-cols-2">{criteria.map((c) => <Criterion key={c.area} c={c} />)}</ul>
    </section>
  );
}

const CHECK_ICON = {
  pass: <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Pass" />,
  fail: <XCircle className="h-4 w-4 text-rose-600" aria-label="Fail" />,
  unknown: <CircleHelp className="h-4 w-4 text-faint" aria-label="Could not be checked" />,
} as const;

export function ChecklistSection({ checks }: { checks: readonly SiteAuditCheck[] }) {
  if (checks.length === 0) return null;
  const passed = checks.filter((c) => c.status === 'pass').length;
  return (
    <section className="mt-8" aria-label="Checklist">
      <h2 className={H2}>Checklist · {passed} of {checks.length} pass</h2>
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {checks.map((c) => (
          <li key={c.id} className="flex items-start gap-3 px-4 py-2.5">
            <span className="mt-0.5 shrink-0">{CHECK_ICON[c.status]}</span>
            <span className="min-w-0 text-[13px]">
              <span className="font-medium text-content">{c.label}</span>
              <span className="block text-[12px] leading-snug text-muted">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const RANK = { high: 3, medium: 2, low: 1 } as const;
const CHIP = {
  high: 'border-rose-200 bg-rose-50 text-rose-800',
  medium: 'border-amber-200 bg-amber-50 text-amber-900',
  low: 'border-border bg-surface-2 text-muted',
} as const;

/** Biggest impact for the least effort first. */
export function sortFixes(fixes: readonly SiteAuditFix[]): SiteAuditFix[] {
  return [...fixes].sort((a, b) => (RANK[b.impact] * 4 - RANK[b.effort]) - (RANK[a.impact] * 4 - RANK[a.effort]));
}

export function FixesSection({ fixes }: { fixes: readonly SiteAuditFix[] }) {
  if (fixes.length === 0) return null;
  return (
    <section className="mt-8" aria-label="Prioritised fixes">
      <h2 className={H2}>Fix first · impact against effort</h2>
      <ol className="space-y-3">
        {sortFixes(fixes).map((f, i) => (
          <li key={i} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-sm font-bold tabular-nums text-faint">{i + 1}</span>
              <h3 className="text-sm font-semibold text-content">{f.title}</h3>
              <span className={cn('chip px-2 py-0.5 text-[11px]', CHIP[f.impact])}>{f.impact} impact</span>
              <span className="chip border-border bg-surface px-2 py-0.5 text-[11px] text-muted">{f.effort} effort</span>
            </div>
            {f.detail && <p className="mt-1.5 text-[13px] leading-snug text-muted">{f.detail}</p>}
            {f.quote && <p className="mt-1.5 border-l-2 border-border pl-2.5 text-[12px] italic text-muted">“{f.quote}”</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
