/** A research conversation printed as a transcript: dark cover, then turns, each assistant turn with its numbered sources. */
import { SafeMarkdown } from '@/components/ResearchMarkdown';
import { isRedirectCitation, publisherOf, usableCitations } from '@mi/contracts';
import { splitFollowUps } from '@/features/deepdive/followUps';
import type { PrintJob } from '../PrintDocument';
import { Cover } from './Cover';
import { ReportSection, Row } from './reportParts';

export function TranscriptBody({ job }: { job: Extract<PrintJob, { kind: 'transcript' }> }) {
  return (
    <>
      <Cover
        eyebrow="Research conversation"
        title={job.title}
        meta={[job.dateText, job.scopeLabel ?? '', `${job.messages.length} messages`].filter(Boolean)}
      />
      <ReportSection about={job.scopeLabel ?? 'Research conversation'} title={job.title}>
        {job.messages.map((m) => {
          if (m.role === 'user') {
            return (
              <Row key={m.id}>
                <div className="sm-r-turn sm-r-turn--user">
                  <p className="sm-r-who">You</p>
                  <p>{m.text}</p>
                </div>
              </Row>
            );
          }
          const cites = usableCitations(m.citations ?? []);
          return (
            <Row key={m.id}>
              <div className="sm-r-turn">
                <p className="sm-r-who">Stratemark</p>
                <div className="sm-md sm-r-md">
                  <SafeMarkdown>{splitFollowUps(m.text).body}</SafeMarkdown>
                </div>
                {cites.length > 0 && (
                  <ol className="sm-r-notes">
                    {cites.map((c, i) => (
                      <li key={c.url} value={i + 1}>
                        <span className="sm-r-note-title">{publisherOf(c.url, c.title)}</span>
                        {/* A grounding redirect is opaque and expires; printing it helps no reader. */}
                        {!isRedirectCitation(c.url) && <> <span className="sm-r-note-url">{c.url}</span></>}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </Row>
          );
        })}
      </ReportSection>
    </>
  );
}
