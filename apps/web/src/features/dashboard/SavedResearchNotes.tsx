import { useState } from 'react';
import { usableCitations } from '@mi/contracts';
import type { ResearchEvidence } from '@mi/research';
import { useRepository } from '@/lib/repository/RepositoryProvider';

/** Read-only, scoped transparency. Search notes are not established facts. */
export function SavedResearchNotes({ companyId }: { companyId: string }) {
  const repo = useRepository();
  const [notes, setNotes] = useState<ResearchEvidence[]>([]);
  const reader = repo as typeof repo & { getResearchEvidence?: (input: { companyId: string; limit: number }) => ResearchEvidence[] };
  if (typeof reader.getResearchEvidence !== 'function') return null;
  return <details className="mt-4 rounded-lg border border-border bg-surface px-4 py-3 text-xs text-muted" onToggle={event => {
    if (event.currentTarget.open) setNotes(reader.getResearchEvidence!({ companyId, limit: 10 }).filter(note => note.companyId === companyId));
  }}>
    <summary className="cursor-pointer font-medium text-content">Saved research notes</summary>
    <p className="mt-3">Saved search output, not independently verified facts. Reviewing this evidence does not make an API call. Missing or rejected figures stay unknown.</p>
    {notes.length === 0 && <p className="mt-2">No saved search notes are available for this company.</p>}
    {notes.filter(note => note.companyId === companyId).map(note => <section key={note.id} className="mt-4 space-y-2 border-t border-border pt-3">
      <p className="font-medium text-content">{note.topic} · collected {note.capturedAt.slice(0, 10)} · {note.grounding?.supports.length ?? 0} per-claim supports</p>
      <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words font-sans leading-relaxed">{note.text.slice(0, 20000)}</pre>
      <ul className="space-y-1">{usableCitations(note.citations).slice(0, 20).map(citation => <li key={citation.url}><a href={citation.url} target="_blank" rel="noopener noreferrer" className="text-primary-ink hover:underline">{citation.title}</a></li>)}</ul>
      {note.grounding && <details><summary className="cursor-pointer">Provider-attributed passages</summary>{note.grounding.supports.slice(0, 20).map(support => <p key={support.supportIndex} className="mt-2 whitespace-pre-wrap">{support.supportIndex}: {support.text.slice(0, 3000)}</p>)}</details>}
    </section>)}
  </details>;
}
