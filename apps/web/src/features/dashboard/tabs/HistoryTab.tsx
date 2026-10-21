import { useMemo, useState } from 'react';
import { ChevronDown, History, Quote } from 'lucide-react';
import { useCompany, useDashboardTab, useRerunDashboardTab } from '@/hooks/data';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { HydratingPanel } from './HydratingPanel';
import { DigDeeperMenu } from '@/features/deepdive/DeepDive';
import { InsightReader } from '@/components/reader/InsightReader';
import { WikiAvatar } from './LeaderGrid';
import { Logo } from '@/features/card/Logo';
import { HistoryVideoHero } from './HistoryVideoHero';
import { ResearchMarkdown } from '@/components/ResearchMarkdown';
import { cn } from '@/lib/cn';
import { useCachedDashboardTab } from '../useCachedTab';
import { isFundingRoundEvent, unifyFunding, roundForEvent, statedByEvent } from '../funding';
import { formatUsdCompact } from '../snapshot';
import { EmptyNote, FilterChip, SearchBox, SectionHeader, SourceLink } from './TabKit';
import {
  classifyEvent,
  EVENT_KIND_LABEL,
  groupByYear,
  isOrgAttribution,
  matchesQuery,
  type EventKind,
} from './tabHelpers';

/** "— Sam Altman, CEO (2024)" → "Sam Altman" for the headshot lookup. */
function speakerNameOf(attribution: string): string | null {
  const name = attribution.split(/[,(—–-]/)[0]?.trim() ?? '';
  return /^[A-Z][\w.'-]+(\s+[A-Z][\w.'-]+){1,3}$/.test(name) ? name : null;
}

const KIND_DOT: Record<EventKind, string> = {
  funding: 'bg-emerald-500',
  product: 'bg-indigo-500',
  leadership: 'bg-amber-500',
  corporate: 'bg-slate-500',
  other: 'bg-slate-300',
};

/** Past this many events the default view tightens (detail hidden, old years folded). */
const DENSE_AT = 14;

export function HistoryTab({ companyId }: { companyId: string }) {
  const expand = useRerunDashboardTab(companyId, 'history');
  const query = useDashboardTab(companyId, 'history');
  const company = useCompany(companyId).data;
  const name = company?.name ?? 'this company';
  // Click a milestone → it opens as its own readable card with the whole gist.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [allQuotes, setAllQuotes] = useState(false);
  const [kind, setKind] = useState<EventKind | 'all'>('all');
  const [search, setSearch] = useState('');
  const [detailMode, setDetailMode] = useState<'auto' | 'detailed' | 'compact'>('auto');
  const [foldedYears, setFoldedYears] = useState<Record<string, boolean>>({});

  const timeline = query.data?.content.timeline;
  // The same rounds the Mission & governance tab lists (read only if already cached).
  const governanceRounds = useCachedDashboardTab(companyId, 'mission_governance').data?.content.fundingRounds;
  const rounds = useMemo(() => unifyFunding(governanceRounds, timeline), [governanceRounds, timeline]);
  // Stable per-event key: index in the research order (never re-sorted).
  const events = useMemo(
    () =>
      (timeline ?? []).map((t, i) => ({
        ...t,
        key: String(i),
        kind: classifyEvent(t.title, t.detail),
      })),
    [timeline],
  );
  const kindCounts = useMemo(() => {
    const out: Partial<Record<EventKind, number>> = {};
    for (const e of events) out[e.kind] = (out[e.kind] ?? 0) + 1;
    return out;
  }, [events]);
  const shown = useMemo(
    () =>
      events.filter(
        (e) =>
          (kind === 'all' || e.kind === kind) && matchesQuery(`${e.title} ${e.detail} ${e.date}`, search),
      ),
    [events, kind, search],
  );
  const groups = useMemo(() => groupByYear(shown), [shown]);
  // True of every funding round on the timeline (two or more), so it is said once, not on each event.
  const noRoundAmounts = useMemo(() => {
    const funding = events.filter(isFundingRoundEvent);
    return funding.length >= 2 && funding.every((e) => {
      const r = roundForEvent(rounds, e);
      return r?.amountUsd == null && !r?.amountNote;
    });
  }, [events, rounds]);
  const dense = detailMode === 'compact' || (detailMode === 'auto' && events.length > DENSE_AT);
  const filtering = kind !== 'all' || search.trim().length > 0;

  return (
    <QueryBoundary query={query} loading={<HydratingPanel label="History" />}>
      {(result) => {
        const c = result.content;
        const opened = openKey !== null ? events.find((e) => e.key === openKey) : undefined;
        const years = groups.filter((g) => g.year !== null);
        const years0 = years.length ? `${years[years.length - 1]!.label}–${years[0]!.label}` : null;
        return (
          <div className="space-y-8 cascade">
            {c.video && <HistoryVideoHero video={c.video} companyName={name} />}
            {/* Story + quotes share one 2:1 row; the timeline spans both below. */}
            <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            {/* The one-pager: the company's story, written to be read. */}
            {c.founderStory.trim().length > 0 && (
              <section className="panel p-6 lg:col-start-1 lg:row-start-1" aria-label="Company story">
                <SectionHeader
                  title="The story"
                  actions={
                    <DigDeeperMenu
                      topics={['Founders & their backgrounds', 'Funding history & investors']}
                      companyId={companyId}
                      companyName={name}
                    />
                  }
                />
                <div className="markdown text-[15px] leading-relaxed text-content/90">
                  <ResearchMarkdown text={c.founderStory} />
                </div>
              </section>
            )}

              <section className="panel p-5 lg:col-span-2 lg:row-start-2" aria-label="Timeline">
                <SectionHeader
                  title="Timeline"
                  count={events.length > 0 ? `${events.length} event${events.length === 1 ? '' : 's'}${years0 && years.length > 1 ? ` · ${years0}` : ''}` : undefined}
                  description={
                    events.length > 0
                      ? 'Dated milestones from retained research, newest first. Open one for its full description. Types are read from each event’s own wording to help you filter, and sources are not yet listed per event.'
                      : undefined
                  }
                  actions={
                    // The timeline never has to stop: one click sends the desk
                    // back out for a denser pass.
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
                  }
                />

                {events.length === 0 ? (
                  <EmptyNote
                    compact
                    title="No dated milestones sourced yet"
                    action={
                      <button type="button" className="btn-ghost text-xs" disabled={expand.isPending} onClick={() => expand.mutate()}>
                        {expand.isPending ? 'Researching…' : 'Research the timeline'}
                      </button>
                    }
                  >
                    A timeline fills in when research finds dated, sourced events for {name}
                    (founding, funding, launches, leadership changes). Nothing is estimated.
                  </EmptyNote>
                ) : (
                  <>
                    <div className="mb-4 flex flex-wrap items-center gap-2">
                      {events.length > 6 && (
                        <SearchBox
                          value={search}
                          onChange={setSearch}
                          label="Search timeline"
                          placeholder="Search events"
                          className="w-full sm:w-52"
                        />
                      )}
                      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by event type">
                        <FilterChip active={kind === 'all'} onClick={() => setKind('all')} count={events.length}>
                          All
                        </FilterChip>
                        {(Object.keys(EVENT_KIND_LABEL) as EventKind[])
                          .filter((k) => (kindCounts[k] ?? 0) > 0)
                          .map((k) => (
                            <FilterChip key={k} active={kind === k} onClick={() => setKind(k)} count={kindCounts[k]}>
                              <span className={cn('h-1.5 w-1.5 rounded-full', KIND_DOT[k])} aria-hidden />
                              {EVENT_KIND_LABEL[k]}
                            </FilterChip>
                          ))}
                      </div>
                      {events.length > 6 && (
                        <button
                          type="button"
                          className="ml-auto rounded px-1.5 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-content"
                          onClick={() => setDetailMode(dense ? 'detailed' : 'compact')}
                        >
                          {dense ? 'Show details' : 'Compact view'}
                        </button>
                      )}
                    </div>
                    {noRoundAmounts && (
                      <p className="-mt-2 mb-3 text-[11px] text-faint">No amounts are recorded for these funding rounds.</p>
                    )}

                    {groups.length === 0 ? (
                      <EmptyNote compact title="No events match these filters">
                        Clear the search or choose All.
                      </EmptyNote>
                    ) : (
                      <ol className="space-y-5">
                        {groups.map((g, gi) => {
                          const folded =
                            foldedYears[g.label] ?? (!filtering && events.length > 30 && gi >= 3);
                          return (
                            <li key={g.label}>
                              <button
                                type="button"
                                aria-expanded={!folded}
                                onClick={() => setFoldedYears((f) => ({ ...f, [g.label]: !folded }))}
                                className="mb-2 flex w-full items-center gap-2 text-left"
                              >
                                <ChevronDown className={cn('h-3.5 w-3.5 text-muted transition-transform', folded && '-rotate-90')} />
                                <span className="font-display text-sm font-semibold tabular-nums text-content">{g.label}</span>
                                <span className="text-[11px] tabular-nums text-faint">
                                  {g.items.length} event{g.items.length === 1 ? '' : 's'}
                                </span>
                                <span className="h-px flex-1 bg-border" aria-hidden />
                              </button>
                              {!folded && (
                                <ol className="relative ml-[7px] border-l border-border pl-5">
                                  {g.items.map((t) => (
                                    <li key={t.key} className="relative pb-3 last:pb-0">
                                      <span
                                        className={cn(
                                          'absolute -left-[26px] top-3 h-2.5 w-2.5 rounded-full ring-4 ring-surface',
                                          KIND_DOT[t.kind],
                                        )}
                                        aria-hidden
                                      />
                                      <button
                                        type="button"
                                        className={cn(
                                          'w-full rounded-lg border border-transparent px-3 text-left transition-colors hover:border-border hover:bg-surface-2/60',
                                          dense ? 'py-1.5' : 'py-2.5',
                                        )}
                                        title="Open this milestone as a card — the whole gist, plus grounded research"
                                        onClick={() => setOpenKey(t.key)}
                                      >
                                        <span className="flex flex-wrap items-baseline gap-x-2.5">
                                          <span className="text-xs font-semibold tabular-nums text-primary-ink">
                                            {t.date || 'Date not reported'}
                                          </span>
                                          <span className="text-sm font-medium text-content">{t.title}</span>
                                          {t.kind !== 'other' && (
                                            <span className="text-[10px] uppercase tracking-wider text-faint">
                                              {EVENT_KIND_LABEL[t.kind]}
                                            </span>
                                          )}
                                        </span>
                                        {!dense && t.detail && (
                                          <span className="mt-0.5 block text-sm text-muted">{t.detail}</span>
                                        )}
                                      </button>
                                      {isFundingRoundEvent(t) && (() => {
                                        const r = roundForEvent(rounds, t);
                                        const leads = r?.leadInvestors ?? [];
                                        // When no round has an amount the line above the timeline says so once.
                                        // "Not reported" never sits under text that states an amount.
                                        const amount = r?.amountUsd != null ? formatUsdCompact(r.amountUsd)
                                          : r?.amountNote ? r.amountNote
                                          : noRoundAmounts || statedByEvent(t).statesAmount ? null : 'Amount not reported';
                                        if (!amount && leads.length === 0 && !r?.sourceUrl) return null;
                                        return (
                                          <p className="px-3 pb-1 text-xs text-muted">
                                            {amount}
                                            {leads.length > 0 && `${amount ? ' · ' : ''}${leads.join(', ')}`}
                                            {r?.sourceUrl && <SourceLink url={r.sourceUrl} className="ml-2" />}
                                          </p>
                                        );
                                      })()}
                                    </li>
                                  ))}
                                </ol>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </>
                )}
                {opened && (
                  <InsightReader
                    open
                    onClose={() => setOpenKey(null)}
                    tone="milestone"
                    title={opened.title}
                    date={opened.date}
                    body={opened.detail || null}
                    companyId={companyId}
                    companyName={name}
                    researchSeed={`Milestone in ${name}'s history: "${opened.title}" (${opened.date}). Tell the whole story of this event with grounded sources: what led to it, what exactly happened, who was involved, and what it changed for the company.`}
                  />
                )}
              </section>

              <section
                className={cn(
                  'panel p-5 lg:row-start-1',
                  c.founderStory.trim().length > 0 ? 'lg:col-start-2 lg:self-start' : 'lg:col-span-2',
                )}
                aria-label="Notable quotes"
              >
                <SectionHeader title="Notable quotes" count={c.quotes.length > 0 ? c.quotes.length : undefined} />
                {c.quotes.length === 0 ? (
                  <EmptyNote compact title="No attributable quotes yet">
                    Quotes appear only with a named speaker and a source link. Research has not
                    retained one for {name}.
                  </EmptyNote>
                ) : (
                  <ul className="space-y-4">
                    {(allQuotes ? c.quotes : c.quotes.slice(0, 2)).map((q, i) => {
                      const org = q.attribution ? isOrgAttribution(q.attribution, name) : false;
                      const speaker = q.attribution && !org ? speakerNameOf(q.attribution) : null;
                      return (
                        <li key={i} className="text-sm">
                          <Quote className="h-4 w-4 text-muted" aria-hidden />
                          <p className="mt-1 italic text-content">{q.text}</p>
                          {(q.attribution || q.date) && (
                            <span className="mt-2 flex items-center gap-2">
                              {/* The face behind the words — verified headshot or
                                  clean initials, same honesty gate as leadership.
                                  An organisation speaks with its logo, not initials. */}
                              {org && (
                                <Logo name={company?.name ?? name} website={company?.websiteUrl} logoUrl={company?.logoUrl}
                                  className="h-10 w-10 shrink-0 rounded-full border border-border" />
                              )}
                              {speaker && <WikiAvatar name={speaker} companyName={name} size="sm" />}
                              <span className="text-xs text-muted">
                                {q.attribution ? `— ${q.attribution}` : ''}
                                {q.date ? `${q.attribution ? ', ' : ''}${q.date}` : ''}
                              </span>
                            </span>
                          )}
                          {/* Provenance at the point of use (red team #18): the
                              source travels with the quote or it does not exist. */}
                          {q.sourceUrl && (
                            <SourceLink url={q.sourceUrl} label={q.sourceTitle || undefined} className="mt-1" />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
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
              </section>
            </div>
          </div>
        );
      }}
    </QueryBoundary>
  );
}
