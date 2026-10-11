import { useMemo, useState } from 'react';
import { ChevronDown, Loader2, Plus, StickyNote } from 'lucide-react';
import type { ResearchEvidence } from '@mi/research';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { useCompany } from '@/hooks/data';
import { presentable } from '@mi/research';
import { EmptyState } from '@/components/states/EmptyState';
import { ResearchMarkdown } from '@/components/ResearchMarkdown';
import { publisherOf, usableCitations } from '@mi/contracts';
import { isDirectSource, sourceHref } from '@/lib/sourceHref';
import { faviconUrl } from '@/lib/screenshot';
import { cn } from '@/lib/cn';
import { EmptyNote, FilterChip, SearchBox, SectionHeader } from './TabKit';
import { groupByHost, matchesQuery } from './tabHelpers';

/** Human-readable topic names — provider topics are machine words. */
const TOPIC_LABELS: Record<string, string> = {
  user_note: 'Your notes',
  company_profile: 'Company profile',
  overview: 'Overview',
  team_org: 'Team & org',
  live_intel: 'Live intel',
  metrics_hunt: 'Metrics hunt',
};

const TOPIC_ORDER = ['user_note', 'company_profile', 'overview', 'team_org', 'live_intel', 'metrics_hunt'];

function topicLabel(topic: string): string {
  return TOPIC_LABELS[topic] ?? topic.replaceAll('_', ' ');
}

/** Beyond this many characters an evidence record folds behind "Show full record". */
const FOLD_AT = 700;

function EvidenceCard({ evidence }: { evidence: ResearchEvidence }) {
  const [expanded, setExpanded] = useState(false);
  const sources = usableCitations(evidence.citations);
  const supports = evidence.grounding?.supports ?? [];
  const body = evidence.topic === 'user_note' ? evidence.text : presentable(evidence.text);
  const long = body.length > FOLD_AT;
  return (
    <article className="panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="chip border-border bg-surface-2 py-0.5 text-[11px] text-muted">
            {topicLabel(evidence.topic)}
          </span>
          {evidence.companyName && (
            <span className="truncate text-sm font-medium text-content">{evidence.companyName}</span>
          )}
        </div>
        <span className="text-[11px] tabular-nums text-faint" title="When this research was collected, not a publication date">
          Collected {evidence.capturedAt.slice(0, 10)}
        </span>
      </div>
      <div
        className={cn(
          'markdown mt-3 break-words text-sm leading-relaxed text-content/90',
          long && !expanded && 'relative max-h-40 overflow-hidden',
        )}
      >
        {/* Red team #6: provider evidence is agent output — presentation-clean
            (URL lines, bold field labels) before it reaches a human. User notes
            render exactly as written. */}
        <ResearchMarkdown text={body} />
        {long && !expanded && (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-surface to-transparent" aria-hidden />
        )}
      </div>
      {long && (
        <button
          type="button"
          aria-expanded={expanded}
          className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-muted hover:text-primary-ink"
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
          {expanded ? 'Show less' : 'Show full record'}
        </button>
      )}
      {(sources.length > 0 || supports.length > 0) && (
        <div className="mt-3 border-t border-border pt-3">
          {supports.length > 0 && (
            <p className="mb-2 text-[11px] text-faint">
              {supports.length} source-attributed passage{supports.length === 1 ? '' : 's'} retained with this research.
            </p>
          )}
          {sources.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {sources.slice(0, 8).map((c) => (
                <li key={c.url} className="min-w-0 max-w-full">
                  <a
                    href={sourceHref(c.url, c.title)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={isDirectSource(c.url) ? publisherOf(c.url, c.title) : 'Find the original story'}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-muted hover:border-primary/50 hover:text-primary-ink"
                  >
                    {isDirectSource(c.url) && <img src={faviconUrl(c.url)} alt="" className="h-3 w-3 shrink-0 rounded-sm" loading="lazy" />}
                    <span className="truncate">{publisherOf(c.url, c.title)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

/** Every distinct source across the retained evidence, grouped by publisher. */
function SourcesView({ evidence, query }: { evidence: ResearchEvidence[]; query: string }) {
  const groups = useMemo(() => {
    const seen = new Map<string, { url: string; title: string; topics: Set<string> }>();
    for (const e of evidence) {
      for (const c of usableCitations(e.citations)) {
        const row = seen.get(c.url) ?? { url: c.url, title: publisherOf(c.url, c.title), topics: new Set<string>() };
        row.topics.add(topicLabel(e.topic));
        seen.set(c.url, row);
      }
    }
    return groupByHost([...seen.values()]).filter((g) =>
      matchesQuery(`${g.host} ${g.items.map((i) => i.title).join(' ')}`, query),
    );
  }, [evidence, query]);
  if (groups.length === 0) {
    return (
      <EmptyNote compact title={query.trim() ? 'No sources match' : 'No sources retained yet'}>
        {query.trim()
          ? `No retained source matches "${query.trim()}".`
          : 'Sources appear here once a grounded research pass returns citations. Run research on a tab to collect some.'}
      </EmptyNote>
    );
  }
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <section key={g.host} className="panel p-4" aria-label={g.host}>
          <h4 className="flex items-center gap-2 text-sm font-medium text-content">
            <img src={faviconUrl(`https://${g.host}`)} alt="" className="h-4 w-4 rounded-sm" loading="lazy" />
            {g.host}
            <span className="text-xs font-normal tabular-nums text-muted">{g.items.length}</span>
          </h4>
          <ul className="mt-2 space-y-1.5">
            {g.items.map((s) => (
              <li key={s.url} className="flex flex-wrap items-baseline gap-x-2">
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="break-words text-sm text-primary-ink hover:underline">
                  {s.title}
                </a>
                <span className="text-[11px] text-faint">{[...s.topics].join(' · ')}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The deck's research knowledge base: every retained note, grounded search
 * pass and source in one place — and the user can grow it. */
export function ResearchTab({ companyId }: { companyId: string }) {
  const repo = useRepository();
  const company = useCompany(companyId);
  const name = company.data?.name ?? 'this company';
  const [view, setView] = useState<'evidence' | 'sources'>('evidence');
  const [filter, setFilter] = useState<string>('all');
  const [searchText, setSearchText] = useState('');
  const [visible, setVisible] = useState(20);
  const [composerOpen, setComposerOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteUrl, setNoteUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const canAdd = typeof repo.addResearchNote === 'function';
  const { evidence, available } = useEvidence(companyId, version);
  const topics = useMemo(() => {
    const present = new Set(evidence.map((e) => e.topic));
    return [...present].sort((a, b) => {
      const ai = TOPIC_ORDER.indexOf(a), bi = TOPIC_ORDER.indexOf(b);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  }, [evidence]);
  const filtered = (filter === 'all' ? evidence : evidence.filter((e) => e.topic === filter)).filter((e) =>
    matchesQuery(`${e.topic} ${e.companyName ?? ''} ${e.text}`, searchText),
  );
  const sourceTotal = useMemo(
    () => new Set(evidence.flatMap((e) => usableCitations(e.citations).map((c) => c.url))).size,
    [evidence],
  );

  const addNote = async () => {
    if (!noteText.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await repo.addResearchNote!({ companyId, companyName: name, text: noteText, sourceUrl: noteUrl.trim() || undefined });
      setNoteText('');
      setNoteUrl('');
      setComposerOpen(false);
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the note.');
    } finally {
      setSaving(false);
    }
  };

  if (!available) {
    return (
      <EmptyState title="Research base unavailable"
        description="This engine does not expose retained research. Update the app to use the knowledge base." />
    );
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Research & sources"
        description={
          <>
            {evidence.length} retained record{evidence.length === 1 ? '' : 's'} for {name}
            {sourceTotal > 0 ? ` · ${sourceTotal} distinct source${sourceTotal === 1 ? '' : 's'}` : ''}. Search
            output is attribution, not independent verification.
          </>
        }
        actions={
          canAdd && (
            <button type="button" className="btn-ghost text-xs"
              onClick={() => setComposerOpen((open) => !open)}>
              <Plus className="h-3.5 w-3.5" />
              Add to knowledge base
            </button>
          )
        }
      />

      {composerOpen && (
        <div className="panel space-y-3 p-4">
          <h3 className="flex items-center gap-1.5 font-display text-sm font-semibold text-content">
            <StickyNote className="h-4 w-4 text-primary-ink" />
            Add to {name}'s knowledge base
          </h3>
          <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={5}
            placeholder="What did you learn? Paste findings, notes, or anything worth keeping with this company's research."
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-content outline-none focus:border-primary/50" />
          <input value={noteUrl} onChange={(e) => setNoteUrl(e.target.value)}
            placeholder="Source URL (optional — https://…)"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-content outline-none focus:border-primary/50" />
          {error && <p className="text-xs text-negative">{error}</p>}
          <div className="flex items-center gap-2">
            <button type="button" className="btn-primary text-xs" disabled={saving || !noteText.trim()}
              onClick={() => void addNote()}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Save note
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={() => setComposerOpen(false)}>Cancel</button>
            <p className="text-[11px] text-faint">Saved locally with this deck's research — never uploaded.</p>
          </div>
        </div>
      )}

      {evidence.length === 0 ? (
        <EmptyNote title="No research retained yet">
          Every grounded research pass on {name} is kept here with its sources, and you can add your
          own notes. Open another tab or run research to start filling it.
        </EmptyNote>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-border bg-surface-2/60 p-0.5" role="group" aria-label="View">
              {(['evidence', 'sources'] as const).map((v) => (
                <button key={v} type="button" aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                    view === v ? 'bg-surface text-content shadow-card' : 'text-muted hover:text-content',
                  )}>
                  {v === 'evidence' ? 'Evidence' : `Sources · ${sourceTotal}`}
                </button>
              ))}
            </div>
            <SearchBox
              value={searchText}
              onChange={(v) => { setSearchText(v); setVisible(20); }}
              label="Search this knowledge base"
              placeholder="Search this knowledge base…"
              className="w-full sm:w-64"
            />
          </div>

          {view === 'evidence' && topics.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by topic">
              <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} count={evidence.length}>
                All
              </FilterChip>
              {topics.map((topic) => (
                <FilterChip key={topic} active={filter === topic} onClick={() => setFilter(topic)}
                  count={evidence.filter((e) => e.topic === topic).length}>
                  {topicLabel(topic)}
                </FilterChip>
              ))}
            </div>
          )}

          {view === 'sources' ? (
            <SourcesView evidence={evidence} query={searchText} />
          ) : (
            <div className="space-y-4">
              {filtered.slice(0, visible).map((e) => <EvidenceCard key={e.id} evidence={e} />)}
              {filtered.length === 0 && (
                <EmptyState title={searchText.trim() ? 'No matches' : 'Nothing here yet'}
                  description={searchText.trim() ? `Nothing in the knowledge base matches "${searchText.trim()}".` : 'No retained research under this filter — try All.'} />
              )}
              {filtered.length > visible && (
                <button type="button" className="btn-ghost w-full text-xs"
                  onClick={() => setVisible((count) => count + 20)}>
                  Show {Math.min(20, filtered.length - visible)} more of {filtered.length}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Evidence reader — a local read on evidence-holding engines, never a
 * provider call. `version` lets the composer force a re-read after saving. */
function useEvidence(companyId: string, version: number) {
  const repo = useRepository();
  const reader = repo as typeof repo & {
    getResearchEvidence?: (input: { companyId: string; limit: number }) => ResearchEvidence[];
  };
  const available = typeof reader.getResearchEvidence === 'function';
  const evidence = useMemo(
    () => (available
      ? reader.getResearchEvidence!({ companyId, limit: 50 }).filter((e) => e.companyId === companyId)
      : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [available, companyId, version],
  );
  return { evidence, available };
}
