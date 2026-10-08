import { useMemo, useState } from 'react';
import { Loader2, Plus, StickyNote } from 'lucide-react';
import type { ResearchEvidence } from '@mi/research';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { useCompany } from '@/hooks/data';
import { presentable } from '@mi/research';
import { Search } from 'lucide-react';
import { EmptyState } from '@/components/states/EmptyState';
import { ResearchMarkdown } from '@/components/ResearchMarkdown';
import { usableCitations } from '@mi/contracts';

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

function EvidenceCard({ evidence }: { evidence: ResearchEvidence }) {
  const sources = usableCitations(evidence.citations);
  const supports = evidence.grounding?.supports ?? [];
  return (
    <article className="panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-sm font-semibold text-content">
          {evidence.companyName ? `${evidence.companyName} — ` : ''}{topicLabel(evidence.topic)}
        </h3>
        <span className="text-[11px] tabular-nums text-faint">{evidence.capturedAt.slice(0, 10)}</span>
      </div>
      <div className="markdown mt-2 break-words text-sm leading-relaxed text-content/90">
        {/* Red team #6: provider evidence is agent output — presentation-clean
            (URL lines, bold field labels) before it reaches a human. User notes
            render exactly as written. */}
        <ResearchMarkdown text={evidence.topic === 'user_note' ? evidence.text : presentable(evidence.text)} />
      </div>
      {supports.length > 0 && (
        <p className="mt-3 border-t border-border pt-2 text-[11px] text-faint">
          {supports.length} source-attributed passage{supports.length === 1 ? '' : 's'} retained with this research.
        </p>
      )}
      {sources.length > 0 && (
        <ul className="mt-2 space-y-1">
          {sources.slice(0, 8).map((c) => (
            <li key={c.url}>
              <a href={c.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary-ink hover:underline">
                {c.title || c.url}
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** The deck's research knowledge base: every retained note, grounded search
 * pass and source in one place — and the user can grow it. */
export function ResearchTab({ companyId }: { companyId: string }) {
  const repo = useRepository();
  const company = useCompany(companyId);
  const name = company.data?.name ?? 'this company';
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
  const searchTerms = searchText.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
  const filtered = (filter === 'all' ? evidence : evidence.filter((e) => e.topic === filter)).filter((e) => {
    if (!searchTerms.length) return true;
    const haystack = `${e.topic} ${e.companyName ?? ''} ${e.text}`.toLowerCase();
    return searchTerms.every((term) => haystack.includes(term));
  });

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {evidence.length} retained record{evidence.length === 1 ? '' : 's'} for {name} — research,
          sources and your own notes in one knowledge base.
        </p>
        {canAdd && (
          <button type="button" className="btn-ghost text-xs"
            onClick={() => setComposerOpen((open) => !open)}>
            <Plus className="h-3.5 w-3.5" />
            Add to knowledge base
          </button>
        )}
      </div>

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

      {evidence.length > 0 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input value={searchText} onChange={(e) => { setSearchText(e.target.value); setVisible(20); }}
            placeholder="Search this knowledge base…"
            className="w-full rounded-full border border-border bg-surface py-2 pl-9 pr-3 text-sm text-content outline-none focus:border-primary/50" />
        </div>
      )}

      {topics.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button type="button"
            className={`chip ${filter === 'all' ? 'border-primary/40 bg-primary/10 text-primary-ink' : 'border-border bg-surface text-muted hover:text-content'}`}
            onClick={() => setFilter('all')}>
            All · {evidence.length}
          </button>
          {topics.map((topic) => (
            <button key={topic} type="button"
              className={`chip ${filter === topic ? 'border-primary/40 bg-primary/10 text-primary-ink' : 'border-border bg-surface text-muted hover:text-content'}`}
              onClick={() => setFilter(topic)}>
              {topicLabel(topic)} · {evidence.filter((e) => e.topic === topic).length}
            </button>
          ))}
        </div>
      )}

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
