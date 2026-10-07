import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { usableCitations } from '@mi/contracts';
import type { ResearchEvidence } from '@mi/research';
import { useRepository } from '@/lib/repository/RepositoryProvider';

/** Repair escaped separators in saved projections, preserving normal Markdown. */
export function ResearchMarkdown({ text }: { text: string }) {
  const markdown = text.includes('\n') ? text : text.replace(/\\r\\n|\\n/g, '\n');
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ children, href }) => usableCitations([{ title: 'Source', url: href ?? '' }]).length
      ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
      : <span>{children}</span>,
    img: ({ alt }) => <span>{alt}</span>,
  }}>{markdown}</ReactMarkdown>;
}

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
      <p className="font-medium text-content">{note.topic.replace(/_/g, ' ')} · collected {note.capturedAt.slice(0, 10)}</p>
      {note.grounding?.supports.length ? <>
        <p>Source-attributed passages — not independently verified.</p>
        {note.grounding.supports.slice(0, 20).map(support => <div key={support.supportIndex} className="space-y-2 border-l border-border pl-3">
          <div className="markdown break-words text-sm leading-relaxed"><ResearchMarkdown text={support.text} /></div>
          <ul className="space-y-1">{usableCitations(support.sources).map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer" className="text-primary-ink hover:underline">{source.title}</a></li>)}</ul>
        </div>)}
        <details><summary className="cursor-pointer">Full search notes</summary><div className="markdown mt-3 break-words text-sm leading-relaxed"><ResearchMarkdown text={note.text} /></div></details>
      </> : <div className="markdown break-words text-sm leading-relaxed"><ResearchMarkdown text={note.text} /></div>}
      <ul className="space-y-1">{usableCitations(note.citations).slice(0, 20).map(citation => <li key={citation.url}><a href={citation.url} target="_blank" rel="noopener noreferrer" className="text-primary-ink hover:underline">{citation.title}</a></li>)}</ul>
    </section>)}
  </details>;
}
