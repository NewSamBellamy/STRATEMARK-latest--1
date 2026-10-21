/**
 * A person as a pinned player card: a header band in their function's colour,
 * a portrait, full name and title, then only the career lines research actually
 * found, each footnoted to a source. Press it and it turns over to the basics,
 * the full bio and the numbered sources. It hangs on the org board like the
 * company cards sit in a deck, in a different shape (a player card, not a
 * trading card) so the two never get mixed up.
 *
 * Honesty: a portrait is shown only when a verified one exists (a supplied
 * licensed photo, or a headshot lookup whose article names the company);
 * otherwise the card shows the person's initials. The front shows what is
 * known and nothing else: no "Not reported" rows, no repeated company name.
 * The MOVING ribbon needs a sourced move from the last year.
 */
import { useId, useState, type KeyboardEvent } from 'react';
import { ArrowUpRight, RotateCcw } from 'lucide-react';
import type { OrgNode } from '@mi/contracts';
import { deriveTriad } from '@/lib/brand';
import { cn } from '@/lib/cn';
import { safeHttpUrl } from '@/lib/sourceHref';
import { Logo } from '@/features/card/Logo';
import { initialsOf, photoCredit, useWikiHeadshot } from './LeaderGrid';
import { GROUP_COLOR, GROUP_LABEL, recentMove } from './orgRank';
import { footnoteMark, moveNote, NO_SOURCE_NOTE, personSources, reported, statLines } from './personFacts';
export interface ProfileCompany {
  id: string;
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  brandTheme?: { source?: string; primary?: string } | null;
}

/** Quiet hues for companies with no researched brand colour: still different from one company to the next. */
const FALLBACK_ACCENTS = ['#2f5d50', '#4b4a88', '#85582a', '#2b5f7a', '#7a3b4f', '#4d6b2f', '#3d4f8f', '#6b5a3a'] as const;

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** The company's own colour when research found one (scraped or set by a person); a stable quiet hue otherwise. */
export function companyAccent(company: Pick<ProfileCompany, 'id' | 'brandTheme'>): string {
  const theme = company.brandTheme;
  if (theme && (theme.source === 'scraped' || theme.source === 'manual') && theme.primary && /^#[0-9a-f]{6}$/i.test(theme.primary)) {
    return deriveTriad(theme as Parameters<typeof deriveTriad>[0], null).primary;
  }
  return FALLBACK_ACCENTS[hash(company.id) % FALLBACK_ACCENTS.length]!;
}

/** Text colour that reads on the company accent: white on dark hues, near-black on light ones (AA either way). */
export function onAccent(accent: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(accent);
  if (!m) return '#ffffff';
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1]!.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (lum + 0.05) >= 4.5 ? '#ffffff' : '#14201d';
}

/** The hidden face leaves the tab order and the accessibility tree (`inert`); React 18 has no typed prop for it. */
const inert = (on: boolean) => (on ? ({ inert: '' } as Record<string, string>) : {});

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  const text = reported(value);
  return (
    <div className="min-w-0">
      <dt className="text-[8.5px] font-semibold uppercase tracking-[0.14em] text-[#6b6757]">{label}</dt>
      <dd className={cn('break-words text-[11.5px] leading-snug', text ? 'text-[#1c2b28]' : 'text-[#6b6757]')}>{text || 'Not reported'}</dd>
    </div>
  );
}

export function ProfileCard({
  person, company, flipped, onFlip, onOpenProfile, dim = false, reportsTo = null, enterIndex, careerNote = true,
}: {
  /** False when the board says "no career details reported" once for everyone, so the card does not repeat it. */
  careerNote?: boolean;
  person: OrgNode;
  company: ProfileCompany;
  flipped: boolean;
  onFlip: () => void;
  onOpenProfile: () => void;
  dim?: boolean;
  /** Name of the manager, shown on the back (the strings carry it on a wide board). */
  reportsTo?: string | null;
  /** Position in the board's first render: staggers the pin-drop. Omit for no entrance. */
  enterIndex?: number;
}) {
  const accent = companyAccent(company);
  // The accent as link text on the cream card: pulled toward ink so a light brand colour still reads.
  const ink = `color-mix(in srgb, ${accent} 40%, #14201d)`;
  const groupColor = GROUP_COLOR[person.group];
  const shot = useWikiHeadshot(person.name, company.name);
  const suppliedPhoto = safeHttpUrl(person.photoUrl);
  const [photoFailed, setPhotoFailed] = useState(false);
  const faceId = useId();
  const stats = statLines(person);
  const sources = personSources(person);
  const ribbon = recentMove(person);
  const note = moveNote(person);
  const started = reported(person.startedAt);
  const bio = person.bio?.trim();
  const frame = { background: `linear-gradient(150deg, ${accent}, color-mix(in srgb, ${accent} 55%, #0e1a17))` };
  const plate = `linear-gradient(160deg, color-mix(in srgb, ${groupColor} 14%, #f6f3ea), color-mix(in srgb, ${groupColor} 30%, #e7e2d2))`;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && flipped) { e.stopPropagation(); onFlip(); }
  };
  const openProfile = (tabbable: boolean) => (
    <button
      type="button"
      tabIndex={tabbable ? 0 : -1}
      onClick={onOpenProfile}
      className="inline-flex items-center gap-0.5 rounded text-[10.5px] font-semibold underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{ color: ink, outlineColor: ink }}
      aria-label={`Open ${person.name}'s profile`}
    >
      Open profile <ArrowUpRight className="h-3 w-3" aria-hidden />
    </button>
  );
  return (
    <div
      data-person-id={person.id}
      onKeyDown={onKeyDown}
      className={cn(
        'group/card relative transition-[opacity,transform] duration-200 hover:-translate-y-0.5 focus-within:-translate-y-0.5 motion-reduce:transform-none',
        enterIndex !== undefined && 'sm-pin-drop',
        dim && 'opacity-40',
      )}
      style={{ perspective: 900, ...(enterIndex !== undefined ? { animationDelay: `${Math.min(enterIndex * 40, 140)}ms` } : null) }}
    >
      {/* The pin the strings are tied to. Decorative. */}
      <span
        data-pin
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'radial-gradient(circle at 35% 30%, #ff9a8d, #c62828 58%, #7f1d1d)', boxShadow: '0 1px 2px rgb(0 0 0 / 0.45)' }}
      />
      <div
        className="grid min-h-[236px] transition-transform duration-[400ms] ease-out motion-reduce:transition-none"
        style={{ transformStyle: 'preserve-3d', transform: flipped ? 'rotateY(180deg)' : 'none' }}
      >
        {/* Front */}
        <div
          data-face="front"
          {...inert(flipped)}
          className="relative flex flex-col rounded-xl p-[2px] shadow-card"
          style={{ ...frame, gridArea: '1 / 1', backfaceVisibility: 'hidden' }}
        >
          {/* A mouse can press anywhere on the card; the keyboard and screen readers use the flip button below. */}
          <div onClick={onFlip} className="absolute inset-0 z-0 cursor-pointer rounded-xl transition-shadow hover:shadow-card-hover" />
          <div className="pointer-events-none flex flex-1 flex-col rounded-[10px] bg-[#f6f3ea] p-1.5">
            <div className="flex items-center justify-between gap-2 rounded px-1.5 py-0.5 text-white" style={{ background: groupColor }}>
              <span className="text-[9px] font-semibold uppercase tracking-[0.16em]">{GROUP_LABEL[person.group]}</span>
              <span className="rounded bg-white/95 p-0.5" title={company.name}>
                <Logo name={company.name} website={company.websiteUrl} logoUrl={company.logoUrl} className="h-3.5 w-3.5 rounded-sm text-[8px] [&>img]:p-0" />
              </span>
            </div>
            {ribbon && (
              <span
                data-move-ribbon
                className="mt-1 block rounded bg-[#b4231a] px-1.5 py-0.5 text-center text-[8.5px] font-bold uppercase tracking-wide text-white"
                title={`Reported move, sourced. ${ribbon.supportingQuote ?? ''}`.trim()}
              >
                <span className="sr-only">Moving: </span>{ribbon.label}
              </span>
            )}
            <div className="mt-1.5 flex items-end justify-center gap-1.5 rounded-md py-1.5" style={{ background: plate }}>
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-[#f6f3ea] shadow-sm ring-1 ring-black/10">
                {suppliedPhoto && !photoFailed ? (
                  <img src={suppliedPhoto} alt={person.name} loading="lazy" onError={() => setPhotoFailed(true)} className="h-full w-full object-cover" />
                ) : shot ? (
                  <img src={shot.thumb} alt={person.name} title={photoCredit(shot)} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="grid h-full w-full place-items-center font-display text-2xl font-bold" style={{ color: `color-mix(in srgb, ${groupColor} 70%, #1c2b28)`, background: `color-mix(in srgb, ${groupColor} 12%, #f6f3ea)` }} aria-hidden>
                    {initialsOf(person.name)}
                  </span>
                )}
              </div>
              {!(suppliedPhoto && !photoFailed) && shot && (
                <span className="max-w-[56px] break-words text-[7.5px] leading-tight text-[#3f4742]">{photoCredit(shot)}</span>
              )}
            </div>
            <div className="mt-2 min-w-0">
              <p className="break-words font-display text-[14px] font-bold leading-tight text-[#14201d]">{person.name}</p>
              <p className="mt-0.5 break-words text-[11px] leading-snug text-[#3f4742]">{person.role || 'Role not reported'}</p>
            </div>
            {stats.length > 0 ? (
              <ul className="mt-1.5 space-y-0.5">
                {stats.map((line) => (
                  <li key={line.key} data-stat={line.key} className="break-words text-[11px] leading-snug text-[#1c2b28]">
                    <span className="mr-1 text-[8.5px] font-semibold uppercase tracking-[0.12em] text-[#6b6757]">{line.label}</span>
                    {line.value}
                    <sup className="ml-0.5 text-[10px] font-semibold" style={{ color: ink }} title="Source 1, on the back of the card">
                      {footnoteMark(1)}<span className="sr-only"> (source 1, on the back)</span>
                    </sup>
                  </li>
                ))}
              </ul>
            ) : careerNote && (
              <p className="mt-1.5 text-[10px] italic leading-snug text-[#6b6757]">No career details reported</p>
            )}
            <div className="mt-auto flex items-center justify-between gap-2 pt-2">
              <div className="pointer-events-auto relative z-10">{openProfile(!flipped)}</div>
              <button
                type="button"
                aria-pressed={flipped}
                aria-label={`${person.name}, ${person.role || 'role not reported'}. Press to turn the card over.`}
                title={stats.length > 0 ? 'Turn over for sources' : 'Turn over for details'}
                onClick={onFlip}
                className="pointer-events-auto relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-black/15 text-[#3f4742] hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{ outlineColor: ink }}
              >
                <RotateCcw className="h-3 w-3" aria-hidden />
              </button>
            </div>
          </div>
        </div>

        {/* Back: sized by the front (contain: size), so a long bio scrolls instead of stretching the card. */}
        <div
          id={faceId}
          data-face="back"
          {...inert(!flipped)}
          className="relative flex flex-col rounded-xl p-[2px] shadow-card [contain:size]"
          style={{ ...frame, gridArea: '1 / 1', backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          <div className="flex min-h-0 flex-1 flex-col rounded-[10px] bg-[#f6f3ea] p-2.5">
            <div className="flex items-start justify-between gap-2">
              <p className="break-words font-display text-[13px] font-bold leading-tight text-[#14201d]">{person.name}</p>
              <button type="button" onClick={onFlip} className="shrink-0 rounded p-1 text-[#3f4742] hover:bg-black/5 focus-visible:outline focus-visible:outline-2" aria-label={`Turn ${person.name}'s card back over`}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.16em]" style={{ color: groupColor }}>At a glance</p>
            <div className="mt-1.5 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1" tabIndex={0} role="region" aria-label={`More about ${person.name}`}>
              <dl className="space-y-1.5">
                <Field label="Role" value={person.role} />
                {reportsTo && <Field label="Reports to" value={reportsTo} />}
                <Field label="Tenure" value={person.tenure} />
                {started && <Field label="Started" value={started} />}
                <Field label="Previously" value={person.priorCompany} />
                <Field label="Known for" value={person.notableProject} />
                {note && <Field label="Move" value={note} />}
              </dl>
              {bio && <p className="text-[10.5px] leading-snug text-[#3f4742]">{bio}</p>}
              <div>
                <p className="text-[8.5px] font-semibold uppercase tracking-[0.14em] text-[#6b6757]">Sources</p>
                <ol className="mt-1 space-y-1.5">
                  {sources.map((s) => (
                    <li key={s.n} id={`${faceId}-src-${s.n}`} className="text-[10px] leading-snug text-[#3f4742]">
                      <span className="mr-1 font-semibold" style={{ color: ink }}>{s.n}.</span>
                      {s.url ? (
                        <>
                          {s.about && <span className="mr-1 text-[#6b6757]">{s.about}:</span>}
                          <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-semibold underline-offset-2 hover:underline" style={{ color: ink }}>{s.host}</a>
                          {s.retrieved && <span className="text-[#6b6757]"> · retrieved {s.retrieved}</span>}
                        </>
                      ) : (
                        <span className="text-[#6b6757]">{NO_SOURCE_NOTE}</span>
                      )}
                      {s.quote && <span className="mt-0.5 block italic text-[#4d554f]">&ldquo;{s.quote}&rdquo;</span>}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
            <div className="mt-2 flex justify-end border-t border-black/10 pt-2">{openProfile(flipped)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
