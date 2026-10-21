/**
 * A person's own dashboard: their resume as research reported it, with a rail to
 * move through everyone on the team. It shows what is stored (role, tenure, who
 * they were before, what they are known for, the source and quote). It does not
 * invent a career: a fuller one needs deeper research, which runs only when
 * asked (it uses research credits), is shown with its sources, and goes into
 * the person's PDF report if it was run.
 */
import { useMemo, useState } from 'react';
import { FileText, Loader2, MessagesSquare, Search } from 'lucide-react';
import type { OrgNode } from '@mi/contracts';
import { ResearchMarkdown } from '@/components/ResearchMarkdown';
import { buildPersonReportModel } from '@/features/export/personReportModel';
import { localDate } from '@/features/export/exportModel';
import { usePrintJob } from '@/features/export/usePrintJob';
import { useRepository, useSupports } from '@/lib/repository/RepositoryProvider';
import { cn } from '@/lib/cn';
import { publisherOf } from '@mi/contracts';
import { sourceHref } from '@/lib/sourceHref';
import { SafeLink } from '@/components/SafeLink';
import { initialsOf, photoCredit, useWikiHeadshot } from './LeaderGrid';
import { companyAccent, type ProfileCompany } from './ProfileCard';

const GROUP_LABEL: Record<OrgNode['group'], string> = { exec: 'Executive', ai: 'AI & research', product: 'Product', design: 'Design', other: 'Board & other' };

interface Deeper { markdown: string; citations: Array<{ title: string; url: string }> }

function Portrait({ person, company, accent }: { person: OrgNode; company: ProfileCompany; accent: string }) {
  const shot = useWikiHeadshot(person.name, company.name);
  return (
    <figure className="shrink-0">
      <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-xl" style={{ background: `color-mix(in srgb, ${accent} 24%, #f1ede0)` }}>
        {shot
          ? <img src={shot.thumb} alt={person.name} title={photoCredit(shot)} className="h-full w-full object-cover" />
          : <span className="font-display text-3xl font-bold" style={{ color: `color-mix(in srgb, ${accent} 70%, #1c2b28)` }}>{initialsOf(person.name)}</span>}
      </div>
      {shot && <figcaption className="mt-1 text-[10px] text-faint">{photoCredit(shot)}</figcaption>}
    </figure>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  const text = value?.trim();
  return (
    <div className="grid gap-x-4 gap-y-0.5 border-b border-border py-2.5 last:border-b-0 sm:grid-cols-[120px_minmax(0,1fr)]">
      <dt className="pt-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{label}</dt>
      <dd className={cn('text-[14px] leading-snug', text ? 'text-content' : 'text-faint')}>{text || 'Not reported'}</dd>
    </div>
  );
}

export function PersonProfile({
  people, selectedId, onSelect, company, onAsk,
}: {
  people: readonly OrgNode[];
  selectedId: string;
  onSelect: (id: string) => void;
  company: ProfileCompany;
  onAsk: (person: OrgNode) => void;
}) {
  const repo = useRepository();
  const canResearch = useSupports('deepDive');
  const person = people.find((p) => p.id === selectedId) ?? people[0]!;
  const accent = companyAccent(company);
  const shot = useWikiHeadshot(person.name, company.name);
  const printer = usePrintJob();
  const [deeper, setDeeper] = useState<Record<string, Deeper>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mine = deeper[person.id] ?? null;
  const ordered = useMemo(() => [...people], [people]);

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
    <div className="grid gap-5 md:grid-cols-[200px_minmax(0,1fr)]">
      <nav aria-label="People on this team" className="max-h-[60vh] overflow-y-auto md:border-r md:border-border md:pr-3">
        <ul className="space-y-0.5">
          {ordered.map((p) => (
            <li key={p.id}>
              <button type="button" aria-current={p.id === person.id ? 'true' : undefined} onClick={() => onSelect(p.id)}
                className={cn('w-full rounded-lg px-2.5 py-1.5 text-left transition-colors', p.id === person.id ? 'bg-primary/8 text-content' : 'text-muted hover:bg-surface-2 hover:text-content')}>
                <span className="block truncate text-[13px] font-medium">{p.name}</span>
                <span className="block truncate text-[11px] text-faint">{p.role || 'Role not reported'}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 space-y-5">
        <header className="flex items-start gap-4">
          <Portrait person={person} company={company} accent={accent} />
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold text-content">{person.name}</h2>
            <p className="mt-0.5 text-[14px] text-content">{person.role || 'Role not reported'}</p>
            <p className="mt-1 text-[12px] text-muted">{GROUP_LABEL[person.group]} · <span className="font-medium text-content">{company.name}</span></p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-primary" onClick={report}>
                <FileText className="h-4 w-4" /> Download report (PDF)
              </button>
              <button type="button" className="btn-ghost" onClick={() => onAsk(person)}>
                <MessagesSquare className="h-4 w-4" /> Ask about them
              </button>
            </div>
          </div>
        </header>

        <section aria-label="Resume">
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-faint">Resume, as reported</h3>
          <dl className="panel px-4">
            <Row label="Now" value={person.role ? `${person.role}, ${company.name}` : null} />
            <Row label="Tenure" value={person.tenure} />
            <Row label="Previously" value={person.priorCompany} />
            <Row label="Known for" value={person.notableProject} />
            <Row label="About" value={person.bio} />
          </dl>
          {person.sourceUrl && person.supportingQuote && (
            <blockquote className="mt-3 border-l-2 border-primary/40 pl-3 text-[13px] leading-relaxed text-content/90">
              &ldquo;{person.supportingQuote}&rdquo;
              <footer className="mt-1 text-[11px] text-faint">
                <SafeLink href={person.sourceUrl} className="text-primary-ink hover:underline">
                  {publisherOf(person.sourceUrl, null)}
                </SafeLink>
                {person.sourceRetrievedAt ? ` · retrieved ${person.sourceRetrievedAt.slice(0, 10)}` : ''}
              </footer>
            </blockquote>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-faint">
            Not reported means the current research did not surface a credible detail. It is not an inference.
          </p>
        </section>

        <section aria-label="Deeper research">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-faint">Deeper research</h3>
            {canResearch && (
              <button type="button" className="btn-ghost text-[13px]" disabled={busy !== null} onClick={() => void research()}
                title="Runs a grounded research pass on this person. It uses research credits, so it only runs when you ask.">
                {busy === person.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                {busy === person.id ? 'Researching…' : mine ? 'Research again' : 'Research this person'}
              </button>
            )}
          </div>
          {error && <p role="alert" className="mt-2 text-[13px] text-negative">{error}</p>}
          {mine ? (
            <div className="panel mt-2 p-4">
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
            <p className="mt-2 text-[13px] text-muted">
              {canResearch
                ? 'Nothing beyond the stored research yet. Run it for a fuller career history with sources; it is included in the PDF if you do.'
                : 'Deeper research needs a research key. The report below still includes everything stored.'}
            </p>
          )}
        </section>
      </div>
      {printer.host}
    </div>
  );
}

