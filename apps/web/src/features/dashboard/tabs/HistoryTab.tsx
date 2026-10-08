import { useState } from 'react';
import { ChevronDown, Quote } from 'lucide-react';
import { useCompany, useDashboardTab } from '@/hooks/data';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { History } from 'lucide-react';
import { DigDeeperMenu } from '@/features/deepdive/DeepDive';
import { InsightReader } from '@/components/reader/InsightReader';
import { useRerunDashboardTab } from '@/hooks/data';
import { WikiAvatar } from './LeaderGrid';
import { ResearchMarkdown } from '@/components/ResearchMarkdown';

/** "— Sam Altman, CEO (2024)" → "Sam Altman" for the headshot lookup. */
function speakerNameOf(attribution: string): string | null {
  const name = attribution.split(/[,(—–-]/)[0]?.trim() ?? '';
  return /^[A-Z][\w.'-]+(\s+[A-Z][\w.'-]+){1,3}$/.test(name) ? name : null;
}

export function HistoryTab({ companyId }: { companyId: string }) {
  const expand = useRerunDashboardTab(companyId, 'history');
  const query = useDashboardTab(companyId, 'history');
  const name = useCompany(companyId).data?.name ?? 'this company';
  // Click a milestone → it opens as its own readable card with the whole gist.
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [allQuotes, setAllQuotes] = useState(false);
  return (
    <QueryBoundary query={query}>
      {(result) => {
        const c = result.content;
        return (
          <div className="space-y-4">
            {/* The one-pager: the company's story, written to be read. */}
            {c.founderStory.trim().length > 0 && (
              <div className="panel p-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="font-display text-lg font-semibold text-content">The story</h3>
                  <DigDeeperMenu
                    topics={['Founders & their backgrounds', 'Funding history & investors']}
                    companyId={companyId}
                    companyName={name}
                  />
                </div>
                <div className="markdown max-w-3xl text-[15px] leading-relaxed text-content/90">
                  <ResearchMarkdown text={c.founderStory} />
                </div>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
              {/* A story in time: the rail keeps scrolling as research adds to it. */}
              <div className="panel p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="font-display text-sm font-semibold text-content">Timeline</h3>
                  {/* The timeline never has to stop: one click sends the desk
                      back out for a denser pass — month-level recency, every
                      product release it can source. */}
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:border-primary/50 hover:text-primary-ink disabled:opacity-60"
                    disabled={expand.isPending}
                    onClick={() => expand.mutate()}
                    title="Re-research the timeline for a denser pass — month-level recent history, every sourced release"
                  >
                    <History className={expand.isPending ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
                    {expand.isPending ? 'Expanding…' : 'Expand timeline'}
                  </button>
                </div>
                <ol className="relative border-l-2 border-border pl-6">
                  {c.timeline.map((t, i) => (
                    <li key={i} className="relative mb-5 last:mb-0">
                      <span className="absolute -left-[31px] top-1 h-3.5 w-3.5 rounded-full border-2 border-surface bg-primary shadow-sm" />
                      <button
                        type="button"
                        className="w-full rounded-lg border border-border bg-surface-2/50 px-3.5 py-2.5 text-left transition-all hover:-translate-y-px hover:border-primary/40 hover:shadow-card"
                        title="Open this milestone as a card — the whole gist, plus grounded research"
                        onClick={() => setOpenIdx(i)}
                      >
                        <span className="text-xs font-bold tabular-nums text-primary-ink">{t.date}</span>
                        <div className="text-sm font-medium text-content">{t.title}</div>
                        {t.detail && <div className="mt-0.5 line-clamp-2 text-sm text-muted">{t.detail}</div>}
                      </button>
                    </li>
                  ))}
                </ol>
                {openIdx != null && c.timeline[openIdx] && (
                  <InsightReader
                    open
                    onClose={() => setOpenIdx(null)}
                    tone="milestone"
                    title={c.timeline[openIdx]!.title}
                    date={c.timeline[openIdx]!.date}
                    body={c.timeline[openIdx]!.detail ?? null}
                    companyId={companyId}
                    companyName={name}
                    researchSeed={`Milestone in ${name}'s history: "${c.timeline[openIdx]!.title}" (${c.timeline[openIdx]!.date}). Tell the whole story of this event with grounded sources: what led to it, what exactly happened, who was involved, and what it changed for the company.`}
                  />
                )}
              </div>

              <div className="panel h-fit p-5">
                <h3 className="font-display text-sm font-semibold text-content">Notable quotes</h3>
                <ul className="mt-3 space-y-4">
                  {(allQuotes ? c.quotes : c.quotes.slice(0, 2)).map((q, i) => {
                    const speaker = q.attribution ? speakerNameOf(q.attribution) : null;
                    return (
                      <li key={i} className="text-sm">
                        <Quote className="h-4 w-4 text-muted" />
                        <p className="mt-1 italic text-content">{q.text}</p>
                        {q.attribution && (
                          <span className="mt-2 flex items-center gap-2">
                            {/* The face behind the words — verified headshot or
                                clean initials, same honesty gate as leadership. */}
                            {speaker && (
                              <WikiAvatar name={speaker} companyName={name} size="sm" />
                            )}
                            <span className="text-xs text-muted">
                              — {q.attribution}{q.date ? `, ${q.date}` : ''}
                            </span>
                          </span>
                        )}
                        {/* Provenance at the point of use (red team #18): the
                            source travels with the quote or it does not exist. */}
                        {q.sourceUrl && (
                          <a href={q.sourceUrl} target="_blank" rel="noopener noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary-ink hover:underline">
                            {q.sourceTitle || new URL(q.sourceUrl).hostname.replace(/^www\./, '')}
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {c.quotes.length > 2 && (
                  <button
                    type="button"
                    className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-muted transition-colors hover:text-primary-ink"
                    aria-expanded={allQuotes}
                    onClick={() => setAllQuotes((v) => !v)}
                  >
                    <ChevronDown className={allQuotes ? 'h-3.5 w-3.5 rotate-180 transition-transform' : 'h-3.5 w-3.5 transition-transform'} />
                    {allQuotes ? 'Fewer quotes' : `${c.quotes.length - 2} more quote${c.quotes.length - 2 === 1 ? '' : 's'}`}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      }}
    </QueryBoundary>
  );
}
