import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import type { ResearchJob } from '@mi/contracts';
import { useRepository, useRepositoryMode } from '@/lib/repository/RepositoryProvider';

/**
 * The finish line (production red team, Oct 8, P0-2): "Live research" ambient
 * activity never told the user the deck was DONE. This banner states the
 * baseline research job's outcome in plain terms — complete, stopped early, or
 * failed — with the counts and time to prove it, so "ready" is a visible fact
 * instead of an inference from an absence of spinners.
 *
 * It also carries the job's COVERAGE shortfalls verbatim (red team #1/#22):
 * an empty specialist category must explain itself — searched, and what the
 * sourcing bar rejected — instead of showing a silent zero.
 *
 * The living runtime's ambient verification is HEALTH, not incompleteness; it
 * keeps working after this banner says complete, and that is stated too.
 */
export function DeckCompletionBanner({ deckId }: { deckId: string | undefined }) {
  const repo = useRepository();
  const mode = useRepositoryMode();
  const enabled = mode !== 'demo' && typeof repo.listResearchJobs === 'function';
  const query = useQuery({
    queryKey: ['research-jobs', deckId],
    queryFn: async () => (await repo.listResearchJobs!()) as ResearchJob[],
    enabled: enabled && !!deckId,
    staleTime: 15_000,
  });
  if (!enabled || !deckId) return null;
  const job = (query.data ?? [])
    .filter((j) => j.deck?.id === deckId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!job || job.status === 'running' || job.status === 'queued') return null;

  const finished = new Date(job.updatedAt).toLocaleString([], {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const companies = job.completedEntityNames?.length ?? 0;
  // Coverage shortfalls are emitted by discovery as plain sentences; show them
  // verbatim so an empty category explains itself instead of showing a zero.
  const coverage = (job.warnings ?? []).filter((warning) =>
    /coverage shortfall|remained below|skipped \d+ results/i.test(warning));

  const CoverageList = () => coverage.length > 0 && (
    <div className="mt-2 w-full space-y-1 border-t border-border pt-2">
      {coverage.map((warning, index) => (
        <p key={index} className="flex items-start gap-1.5 text-xs text-muted">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          {warning}
        </p>
      ))}
    </div>
  );

  if (job.status === 'completed') {
    return (
      <div role="status" data-testid="deck-finish-line"
        className="panel flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm"
        style={{ borderLeft: '3px solid var(--c-positive, #0F766E)' }}>
        <CheckCircle2 className="h-4 w-4 shrink-0 text-primary-ink" />
        <span className="font-medium text-content">
          Baseline research complete — {companies} compan{companies === 1 ? 'y' : 'ies'} · finished {finished}.
        </span>
        <span className="text-muted">
          Background verification keeps figures fresh; nothing here is still unfinished.
        </span>
        <CoverageList />
      </div>
    );
  }
  if (job.status === 'cancelled') {
    return (
      <div role="status" data-testid="deck-finish-line"
        className="panel flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm"
        style={{ borderLeft: '3px solid #D97706' }}>
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="font-medium text-content">
          Research stopped early — {companies} compan{companies === 1 ? 'y' : 'ies'} were finished and saved.
        </span>
        <span className="text-muted">Stopped {finished}. Run research again to complete the remaining desks.</span>
        <CoverageList />
      </div>
    );
  }
  // failed
  return (
    <div role="alert" data-testid="deck-finish-line"
      className="panel flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm"
      style={{ borderLeft: '3px solid #DC2626' }}>
      <TriangleAlert className="h-4 w-4 shrink-0 text-negative" />
      <span className="font-medium text-content">
        Research failed — {companies} compan{companies === 1 ? 'y' : 'ies'} were saved.
      </span>
      <span className="text-muted">
        {job.error ? `${job.error}. ` : ''}Finished {finished}. Run research again to fill the gaps.
      </span>
      <CoverageList />
    </div>
  );
}
