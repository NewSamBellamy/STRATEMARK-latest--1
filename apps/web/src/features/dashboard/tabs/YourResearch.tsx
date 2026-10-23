import { useQuery } from '@tanstack/react-query';
import { parseDigestNote, type ResearchEvidence } from '@mi/research';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { formatDate } from '@/lib/format';
import { SafeLink } from '@/components/SafeLink';
import { TabSection } from './TabKit';

const MAX_DOCUMENTS = 3;
const MAX_FINDINGS = 4;
const MAX_LEARNED = 6;

interface Digest { id: string; at: string; title: string; summary: string; findings: Array<{ claim: string; quote: string }> }
interface Learned { id: string; at: string; text: string; source: { url: string; title: string } | null }
interface Rows { documents: Digest[]; learned: Learned[] }

const norm = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

function readRows(rows: ResearchEvidence[], companyId: string): Rows {
  const mine = rows.filter((row) => row.companyId === companyId);
  const documents = mine
    .flatMap((row) => {
      const parsed = parseDigestNote(row.text);
      return parsed && (parsed.summary || parsed.findings.length) ? [{ id: row.id, at: row.capturedAt, ...parsed }] : [];
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_DOCUMENTS);
  // What a chat answer's own search found and attributed to a public source, saved by the engine.
  const seen = new Set<string>();
  const learned = mine
    .filter((row) => row.topic.startsWith('chat:'))
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
    .filter((row) => { const key = norm(row.text); if (seen.has(key)) return false; seen.add(key); return true; })
    .slice(0, MAX_LEARNED)
    .map((row) => ({ id: row.id, at: row.capturedAt, text: row.text, source: row.citations[0] ? { url: row.citations[0].url, title: row.citations[0].title } : null }));
  return { documents, learned };
}

/**
 * What the research base holds beyond the researched tabs, read back on the dashboard:
 * - the user's dropped-in documents, each summary and finding with the passage it came from (the user's own material,
 *   labelled as theirs and never as verified);
 * - what chat answers learned, each sentence with the public source the search attributed it to.
 * A local read of saved research; it never starts a provider call. It re-reads whenever the company's dashboard data is
 * refreshed, so a new chat answer or document shows here without a reload. Nothing shows until there is something.
 */
export function YourResearch({ companyId }: { companyId: string }) {
  const repo = useRepository();
  const reader = repo as typeof repo & { getResearchEvidence?: (input: { companyId: string; limit: number }) => ResearchEvidence[] };
  const available = typeof reader.getResearchEvidence === 'function';
  const read = (): Rows => (available ? readRows(reader.getResearchEvidence!({ companyId, limit: 300 }), companyId) : { documents: [], learned: [] });
  // Under 'dashboard' + companyId so the refresh that follows an answer or a dropped-in document invalidates it.
  const { data } = useQuery({
    queryKey: ['dashboard', companyId, 'yourResearch'],
    queryFn: read,
    initialData: read,
    staleTime: 0,
  });
  const { documents, learned } = data;
  if (documents.length === 0 && learned.length === 0) return null;
  return (
    <>
      {documents.length > 0 && (
        <TabSection title="From your research" hint="Provided by you · not independently verified">
          <div className="space-y-3">
            {documents.map((doc) => (
              <article key={doc.id} className="panel p-4 sm:p-5">
                <header className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[13px] font-medium text-content">{doc.title}</h3>
                  <span className="shrink-0 text-[11px] text-faint">{formatDate(doc.at)}</span>
                </header>
                {doc.summary && <p className="mt-2 max-w-[68ch] text-[14px] leading-7 text-content">{doc.summary}</p>}
                {doc.findings.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {doc.findings.slice(0, MAX_FINDINGS).map((finding) => (
                      <li key={finding.claim} className="text-[13px] text-content">
                        {finding.claim}
                        <span className="block text-[11.5px] italic text-muted">“{finding.quote}”</span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </TabSection>
      )}
      {learned.length > 0 && (
        <TabSection title="Learned from your questions" hint="Found while answering your chats · each with its source">
          <ul className="panel divide-y divide-border">
            {learned.map((item) => (
              <li key={item.id} className="px-4 py-3 text-[13px] leading-6 text-content sm:px-5">
                {item.text}
                <span className="mt-0.5 flex items-center gap-2 text-[11.5px] text-muted">
                  {item.source && (
                    <SafeLink href={item.source.url} className="truncate text-primary-ink hover:underline" title={item.source.url}>
                      {item.source.title || item.source.url.replace(/^https?:\/\/(?:www\.)?/, '').split('/')[0]}
                    </SafeLink>
                  )}
                  <span className="shrink-0 text-faint">{formatDate(item.at)}</span>
                </span>
              </li>
            ))}
          </ul>
        </TabSection>
      )}
    </>
  );
}
