import { useMemo } from 'react';
import { parseDigestNote, type ResearchEvidence } from '@mi/research';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { formatDate } from '@/lib/format';
import { TabSection } from './TabKit';

const MAX_DOCUMENTS = 3;
const MAX_FINDINGS = 4;

/**
 * What the user dropped in, read back on the dashboard: each document's summary and the findings it states, every one
 * with the passage it came from. It is the user's own material, so it is labelled as theirs and never as verified.
 * A local read of saved research; it never starts a provider call. Nothing shows until something has been dropped in.
 */
export function YourResearch({ companyId }: { companyId: string }) {
  const repo = useRepository();
  const reader = repo as typeof repo & { getResearchEvidence?: (input: { companyId: string; limit: number }) => ResearchEvidence[] };
  const available = typeof reader.getResearchEvidence === 'function';
  const documents = useMemo(() => {
    if (!available) return [];
    return reader.getResearchEvidence!({ companyId, limit: 200 })
      .filter((row) => row.companyId === companyId)
      .flatMap((row) => {
        const parsed = parseDigestNote(row.text);
        return parsed && (parsed.summary || parsed.findings.length) ? [{ id: row.id, at: row.capturedAt, ...parsed }] : [];
      })
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, MAX_DOCUMENTS);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the reader is stable for a repository
  }, [available, companyId]);
  if (documents.length === 0) return null;
  return (
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
  );
}
