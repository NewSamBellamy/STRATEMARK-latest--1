/**
 * A person on the team page: portrait, name, title, and only what research
 * actually found. One calm card in two sizes: `lead` for the founders and the
 * chief executive at the top of the page, `compact` for everyone else. The
 * whole card is one button that opens the person's profile, where every line
 * is footnoted to its source.
 *
 * Honesty: a portrait is shown only when a verified one exists (a supplied
 * licensed photo, or a headshot lookup whose article names the company);
 * otherwise the card shows the person's initials. The card never pads itself
 * with "Not reported": a person with only a name and a title gets a card with
 * a name and a title. A move tag needs a sourced move from the last year.
 */
import { useState, type HTMLAttributes } from 'react';
import type { OrgNode } from '@mi/contracts';
import { deriveTriad } from '@/lib/brand';
import { cn } from '@/lib/cn';
import { safeHttpUrl } from '@/lib/sourceHref';
import { initialsOf, photoCredit, useWikiHeadshot } from './LeaderGrid';
import { GROUP_LABEL, recentMove } from './orgRank';
import { cardBio, moveNote, statLines } from './personFacts';

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

const PORTRAIT_SIZE = {
  sm: 'h-11 w-11 rounded-lg text-[15px]',
  md: 'h-[72px] w-[72px] rounded-xl text-2xl',
  lg: 'h-28 w-28 rounded-2xl text-4xl',
} as const;

/**
 * A verified photo, or the person's initials set in the display face on a
 * quiet tile. Never a stand-in picture.
 */
export function Portrait({
  person,
  companyName,
  size,
  className,
}: {
  person: Pick<OrgNode, 'name' | 'photoUrl'>;
  companyName: string;
  size: keyof typeof PORTRAIT_SIZE;
  className?: string;
}) {
  const shot = useWikiHeadshot(person.name, companyName);
  const supplied = safeHttpUrl(person.photoUrl);
  const [failed, setFailed] = useState(false);
  const useSupplied = Boolean(supplied) && !failed;
  const src = useSupplied ? supplied! : shot?.thumb;
  return (
    <span
      className={cn(
        'relative grid shrink-0 place-items-center overflow-hidden bg-gradient-to-br from-primary/15 to-primary/[0.04] ring-1 ring-inset ring-primary/15',
        PORTRAIT_SIZE[size],
        className,
      )}
    >
      {src ? (
        <img
          src={src}
          alt={person.name}
          title={!useSupplied && shot ? photoCredit(shot) : undefined}
          loading="lazy"
          onError={useSupplied ? () => setFailed(true) : undefined}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="font-display font-semibold tracking-tight text-primary-ink" aria-hidden>
          {initialsOf(person.name)}
        </span>
      )}
    </span>
  );
}

/** A quiet, outlined label: the function on a leadership card, a sourced move on any card. */
export function QuietTag({ children, className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...rest}
      className={cn(
        'inline-flex items-center rounded-full border border-border px-2 py-px text-[10.5px] font-medium leading-4 text-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ProfileCard({
  person,
  company,
  onOpenProfile,
  variant = 'compact',
}: {
  person: OrgNode;
  company: ProfileCompany;
  onOpenProfile: () => void;
  /** `lead`: a larger card for the leadership row, with the function tag and the reported background. */
  variant?: 'lead' | 'compact';
}) {
  const stats = statLines(person);
  const move = recentMove(person);
  const lead = variant === 'lead';
  const bio = lead ? cardBio(person.bio) : null;
  const role = person.role?.trim();
  const moveText = move ? moveNote(person) : null;

  return (
    <button
      type="button"
      data-person-id={person.id}
      data-variant={variant}
      onClick={onOpenProfile}
      aria-label={`${person.name}${role ? `, ${role}` : ''}. Open profile`}
      className={cn(
        'group/person flex h-full w-full min-w-0 items-start text-left transition-[border-color,box-shadow,transform] duration-150',
        'rounded-xl border border-border bg-surface shadow-card hover:border-primary/35 hover:shadow-card-hover',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        'motion-safe:hover:-translate-y-px',
        lead ? 'gap-4 p-4' : 'gap-3 p-3',
      )}
    >
      <Portrait person={person} companyName={company.name} size={lead ? 'md' : 'sm'} />
      <span className="flex min-w-0 flex-1 flex-col">
        {lead && (
          <span className="mb-1.5 flex flex-wrap gap-1">
            <QuietTag>{GROUP_LABEL[person.group]}</QuietTag>
          </span>
        )}
        <span className={cn('break-words font-semibold leading-tight text-content', lead ? 'font-display text-[16px]' : 'text-[14px]')}>
          {person.name}
        </span>
        {role && (
          <span className={cn('mt-0.5 break-words leading-snug text-muted', lead ? 'text-[13px]' : 'text-[12.5px]')}>{role}</span>
        )}
        {bio && <span className="mt-2 line-clamp-3 text-[12.5px] leading-relaxed text-content/80">{bio}</span>}
        {stats.length > 0 && (
          <span className="mt-1.5 block break-words text-[11.5px] leading-snug text-faint">
            {stats.map((s, i) => (
              <span key={s.key} data-stat={s.key}>
                {i > 0 && ' · '}
                {s.label} {s.value}
              </span>
            ))}
          </span>
        )}
        {move && moveText && (
          <span className="mt-2 flex">
            <QuietTag data-move-ribbon title={`Reported move, sourced. ${move.supportingQuote ?? ''}`.trim()} className="border-primary/30 text-primary-ink">
              <span className="sr-only">Recent move: </span>
              {moveText}
            </QuietTag>
          </span>
        )}
      </span>
    </button>
  );
}
