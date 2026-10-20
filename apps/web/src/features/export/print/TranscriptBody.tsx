/** A research conversation printed as a transcript. */
import { SafeMarkdown } from '@/components/ResearchMarkdown';
import { isRedirectCitation, publisherOf, usableCitations } from '@mi/contracts';
import { splitFollowUps } from '@/features/deepdive/followUps';
import type { PrintJob } from '../PrintDocument';
import { Cover } from './Cover';

export function TranscriptBody({ job }: { job: Extract<PrintJob, { kind: 'transcript' }> }) {
  return (
    <>
      <Cover
        eyebrow="Stratemark · Research conversation"
        title={job.title}
        meta={[job.dateText, job.scopeLabel ?? '', `${job.messages.length} messages`].filter(Boolean)}
      />
      <section className="sm-transcript">
        {job.messages.map((m) => {
          if (m.role === 'user') {
            return (
              <div key={m.id} className="sm-turn sm-turn-user">
                <p className="sm-who">You</p>
                <p>{m.text}</p>
              </div>
            );
          }
          const cites = usableCitations(m.citations ?? []);
          return (
            <div key={m.id} className="sm-turn">
              <p className="sm-who">Stratemark</p>
              <div className="sm-md">
                <SafeMarkdown>{splitFollowUps(m.text).body}</SafeMarkdown>
              </div>
              {cites.length > 0 && (
                <ol className="sm-notes">
                  {cites.map((c, i) => (
                    <li key={c.url} value={i + 1}>
                      <span className="sm-note-title">{publisherOf(c.url, c.title)}</span>
                      {/* A grounding redirect is opaque and expires; printing it helps no reader. */}
                      {!isRedirectCitation(c.url) && <> <span className="sm-note-url">{c.url}</span></>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </section>
    </>
  );
}
