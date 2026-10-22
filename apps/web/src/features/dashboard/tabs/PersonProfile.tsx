/**
 * A person's profile: a big header (photo, name, title, company), the facts
 * research reported as a short definition list, their reported background,
 * optional deeper research, and every source at the bottom. Previous and next
 * move through the team in page order.
 *
 * It shows what is stored and nothing else: no "Not reported" rows. A person
 * known only by name and title says exactly that, once. A fuller career needs
 * deeper research, which runs only when asked (it uses research credits), is
 * shown with its sources, and goes into the person's PDF report if it was run.
 */
import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, FileText, Loader2, MessagesSquare, Search } from 'lucide-react';
import type { OrgNode } from '@mi/contracts';
import { publisherOf } from '@mi/contracts';
import { ResearchMarkdown } from '@/components/ResearchMarkdown';
import { SafeLink } from '@/components/SafeLink';
import { buildPersonReportModel } from '@/features/export/personReportModel';
import { localDate } from '@/features/export/exportModel';
import { usePrintJob } from '@/features/export/usePrintJob';
import { useRepository, useSupports } from '@/lib/repository/RepositoryProvider';
import { safeHttpUrl, sourceHref } from '@/lib/sourceHref';
import { photoCredit, useWikiHeadshot } from './LeaderGrid';
import { Portrait, type ProfileCompany } from './ProfileCard';
import { GROUP_LABEL, sortByRank } from './orgRank';
import { footnoteMark, glanceFacts, NO_SOURCE_NOTE, personSources, reported } from './personFacts';

interface Deeper { markdown: string; citations: Array<{ title: string; url: string }> }

function Footnote({ n }: { n: number }) {
  return (
    <sup className="ml-0.5 text-[11px] font-semibold text-primary-ink" title={`Source ${n}, listed below`}>
      {footnoteMark(n)}<span className="sr-only"> (source {n}, listed below)</span>
    </sup>
  );
}

function SectionHeading({ children }: { children: string }) {
  return <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">{children}</h3>;
}

export function PersonProfile({
  people, selectedId, onSelect, company, onAsk, showHeading = true,
}: {
  people: readonly OrgNode[];
  selectedId: string;
  onSelect: (id: string) => void;
  company: ProfileCompany;
  onAsk: (person: OrgNode) => void;
  /** False when the host already shows the name and role as its own visible title. */
  showHeading?: boolean;
}) {
  const repo = useRepository();
  const canResearch = useSupports('deepDive');
  const ordered = useMemo(() => sortByRank(people), [people]);
  const person = people.find((p) => p.id === selectedId) ?? ordered[0]!;
  const index = ordered.findIndex((p) => p.id === person.id);
  const prev = index > 0 ? ordered[index - 1] : undefined;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : undefined;
  const shot = useWikiHeadshot(person.name, company.name);
  const supplied = safeHttpUrl(person.photoUrl);
  const printer = usePrintJob();
  const [deeper, setDeeper] = useState<Record<string, Deeper>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mine = deeper[person.id] ?? null;
  const sources = useMemo(() => personSources(person), [person]);
  const manager = person.parentId ? people.find((p) => p.id === person.parentId && p.id !== person.id) : undefined;
  const facts = useMemo(() => glanceFacts(person, manager?.name ?? null), [person, manager?.name]);
  const bio = reported(person.bio);
  const role = person.role?.trim();

  const research = async () => {
    setBusy(person.id);
    setError(null);
    try {
      const result = await repo.deepDive({
        companyId: company.id,
        companyName: company.name,
        topic: `${person.name}, ${person.role || 'leadership'} at ${company.name}: career history, notable work and public statements`,
        context: [person.tenure, person.priorCompany ? `previously ${person.priorCompany}` : null, person.notableProject].filter(Boolean).join('; ') || null,
      });
      setDeeper((d) => ({ ...d, [person.id]: { markdown: result.markdown, citations: result.citations.map((c) => ({ title: c.title, url: c.url })) } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The research did not finish.');
    } finally {
      setBusy(null);
    }
  };

  const report = () => {
    const model = buildPersonReportModel({
      company: { name: company.name, logoUrl: company.logoUrl, website: company.websiteUrl, hq: null },
      person,
      groupLabel: GROUP_LABEL[person.group],
      portrait: shot ? { src: shot.thumb, credit: photoCredit(shot), sourceUrl: shot.sourceUrl, kind: 'cover' } : null,
      deeper: mine,
    });
    printer.print({ kind: 'personReport', model }, `${person.name} - Stratemark person report ${localDate()}`);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 pr-8 sm:flex-row sm:items-start sm:gap-5">
        <figure className="shrink-0">
          <Portrait key={person.id} person={person} companyName={company.name} size="lg" />
          {!supplied && shot && (
            <figcaption className="mt-1 text-[10.5px] text-faint">
              {shot.sourceUrl ? <SafeLink href={shot.sourceUrl} className="hover:underline">{photoCredit(shot)}</SafeLink> : photoCredit(shot)}
            </figcaption>
          )}
        </figure>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-muted">
            <span className="font-medium text-content">{company.name}</span> · {GROUP_LABEL[person.group]}
          </p>
          {showHeading ? (
            <>
              <h2 className="mt-1 break-words font-display text-2xl font-semibold leading-tight text-content">{person.name}</h2>
              {role && <p className="mt-1 break-words text-[15px] leading-snug text-muted">{role}</p>}
            </>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={report}>
              <FileText className="h-4 w-4" aria-hidden /> Download report (PDF)
            </button>
            <button type="button" className="btn-ghost" onClick={() => onAsk(person)}>
              <MessagesSquare className="h-4 w-4" aria-hidden /> Ask about them
            </button>
          </div>
        </div>
      </header>

      {(facts.length > 0 || !bio) && (
      <section aria-label="At a glance">
        <SectionHeading>At a glance</SectionHeading>
        {facts.length > 0 ? (
          <dl className="rounded-xl border border-border px-4">
            {facts.map((f) => (
              <div key={f.key} data-fact={f.key} className="grid gap-x-4 gap-y-0.5 border-b border-border py-2.5 last:border-b-0 sm:grid-cols-[120px_minmax(0,1fr)]">
                <dt className="text-[12.5px] text-muted">{f.label}</dt>
                <dd className="break-words text-[14px] leading-snug text-content">
                  {f.key === 'reportsTo' && manager ? (
                    <button type="button" className="text-left font-medium text-primary-ink hover:underline" onClick={() => onSelect(manager.id)}>
                      {f.value}
                    </button>
                  ) : f.value}
                  {f.footnote !== null && <Footnote n={f.footnote} />}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-[13.5px] text-muted">{role ? 'Only name and role are on record.' : 'Only a name is on record.'}</p>
        )}
      </section>
      )}

      {bio && (
        <section aria-label="Background">
          <SectionHeading>Background</SectionHeading>
          <p className="max-w-prose text-[14px] leading-relaxed text-content">
            {bio}
            <Footnote n={1} />
          </p>
        </section>
      )}

      <section aria-label="Deeper research">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeading>Deeper research</SectionHeading>
          {canResearch && (
            <button type="button" className="btn-ghost text-[13px]" disabled={busy !== null} onClick={() => void research()}
              title="Runs a grounded research pass on this person. It uses research credits, so it only runs when you ask.">
              {busy === person.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Search className="h-3.5 w-3.5" aria-hidden />}
              {busy === person.id ? 'Researching…' : mine ? 'Research again' : 'Research this person'}
            </button>
          )}
        </div>
        {error && <p role="alert" className="mt-2 text-[13px] text-negative">{error}</p>}
        {mine ? (
          <div className="mt-2 rounded-xl border border-border p-4">
            <article className="markdown text-[14px]"><ResearchMarkdown text={mine.markdown} /></article>
            {mine.citations.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-[12px]">
                {mine.citations.slice(0, 8).map((c) => (
                  <li key={c.url}><a href={sourceHref(c.url, c.title)} target="_blank" rel="noopener noreferrer" className="text-primary-ink hover:underline">{publisherOf(c.url, c.title)}</a></li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-muted">
            {canResearch
              ? 'Nothing beyond the stored research yet. Run it for a fuller career history with sources; it goes into the PDF if you do.'
              : 'Deeper research needs a research key. The PDF still includes everything stored.'}
          </p>
        )}
      </section>

      <section aria-label="Sources" className="border-t border-border pt-4">
        <SectionHeading>Sources</SectionHeading>
        <ol className="space-y-2">
          {sources.map((s) => (
            <li key={s.n} className="flex gap-2 text-[13px] leading-relaxed text-content/90">
              <span className="font-semibold tabular-nums text-primary-ink">{s.n}.</span>
              <span className="min-w-0">
                {s.url ? (
                  <>
                    {s.about && <span className="mr-1 text-muted">{s.about}:</span>}
                    <SafeLink href={s.url} className="font-medium text-primary-ink hover:underline">{s.host}</SafeLink>
                    {s.retrieved && <span className="text-[11.5px] text-faint"> · retrieved {s.retrieved}</span>}
                  </>
                ) : (
                  <span className="text-muted">{NO_SOURCE_NOTE}</span>
                )}
                {s.quote && <blockquote className="mt-0.5 italic text-muted">&ldquo;{s.quote}&rdquo;</blockquote>}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {ordered.length > 1 && (
        <nav aria-label="Move through the team" className="flex items-center justify-between gap-2 border-t border-border pt-3 text-[12.5px]">
          {prev ? (
            <button type="button" onClick={() => onSelect(prev.id)} aria-label={`Previous person: ${prev.name}`}
              className="inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-muted hover:bg-surface-2 hover:text-content">
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden /> <span className="truncate">{prev.name}</span>
            </button>
          ) : <span />}
          <span className="shrink-0 tabular-nums text-faint">{index + 1} of {ordered.length}</span>
          {next ? (
            <button type="button" onClick={() => onSelect(next.id)} aria-label={`Next person: ${next.name}`}
              className="inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-muted hover:bg-surface-2 hover:text-content">
              <span className="truncate">{next.name}</span> <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
            </button>
          ) : <span />}
        </nav>
      )}
      {printer.host}
    </div>
  );
}
