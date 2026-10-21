/**
 * A person as a sports card: portrait, name and title on the front with the
 * company's mark and a frame in the company's own colour; press it and it turns
 * over to the basics at a glance. It sits on the org whiteboard like the
 * company cards sit in a deck, in a different shape (a player card, not a
 * trading card) so the two never get mixed up.
 *
 * Honesty: a portrait is shown only when the headshot lookup found a verified
 * one (credited); otherwise the card shows the person's initials on the frame
 * colour. A field research did not report says "Not reported". Nothing is guessed.
 */
import { useId, type KeyboardEvent } from 'react';
import { ArrowUpRight, RotateCcw } from 'lucide-react';
import type { OrgNode } from '@mi/contracts';
import { deriveTriad } from '@/lib/brand';
import { cn } from '@/lib/cn';
import { safeHttpUrl } from '@/lib/sourceHref';
import { Logo } from '@/features/card/Logo';
import { initialsOf, photoCredit, useWikiHeadshot } from './LeaderGrid';

export const CARD_W = 188;
export const CARD_H = 272;

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

const GROUP_LABEL: Record<OrgNode['group'], string> = { exec: 'Executive', ai: 'AI & research', product: 'Product', design: 'Design', other: 'Board & other' };

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  const text = value?.trim();
  return (
    <div className="min-w-0">
      <dt className="text-[8.5px] font-semibold uppercase tracking-[0.14em] text-[#7b7766]">{label}</dt>
      <dd className={cn('truncate text-[11.5px] leading-snug', text ? 'text-[#1c2b28]' : 'text-[#9a9684]')} title={text || undefined}>{text || 'Not reported'}</dd>
    </div>
  );
}

export function ProfileCard({
  person, company, flipped, onFlip, onOpenProfile, dim = false,
}: {
  person: OrgNode;
  company: ProfileCompany;
  flipped: boolean;
  onFlip: () => void;
  onOpenProfile: () => void;
  dim?: boolean;
}) {
  const accent = companyAccent(company);
  const shot = useWikiHeadshot(person.name, company.name);
  const faceId = useId();
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFlip(); }
  };
  const frame = { background: `linear-gradient(150deg, ${accent}, color-mix(in srgb, ${accent} 55%, #0e1a17))` };
  return (
    <div className={cn('group/card relative transition-opacity', dim && 'opacity-30')} style={{ width: CARD_W, height: CARD_H, perspective: 900 }}>
      <div
        className="relative h-full w-full transition-transform duration-500 ease-out motion-reduce:transition-none"
        style={{ transformStyle: 'preserve-3d', transform: flipped ? 'rotateY(180deg)' : 'none' }}
      >
        {/* Front */}
        <div
          role="button"
          tabIndex={flipped ? -1 : 0}
          aria-hidden={flipped}
          aria-label={`${person.name}, ${person.role || 'role not reported'}. Press to turn the card over.`}
          aria-pressed={false}
          onClick={onFlip}
          onKeyDown={key}
          className="absolute inset-0 cursor-pointer rounded-2xl p-1.5 shadow-card outline-none transition-shadow hover:shadow-card-hover focus-visible:ring-2 focus-visible:ring-primary"
          style={{ ...frame, backfaceVisibility: 'hidden' }}
        >
          <div className="flex h-full flex-col rounded-xl bg-[#f6f3ea] p-2">
            <div className="flex items-center justify-between gap-2">
              <Logo name={company.name} website={company.websiteUrl} logoUrl={company.logoUrl} className="h-5 w-5 rounded" />
              <span className="truncate text-[8.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: accent }}>{GROUP_LABEL[person.group]}</span>
            </div>
            <div className="relative mt-1.5 aspect-square w-full overflow-hidden rounded-lg" style={{ background: `linear-gradient(160deg, color-mix(in srgb, ${accent} 22%, #f6f3ea), color-mix(in srgb, ${accent} 40%, #e7e2d2))` }}>
              {shot ? (
                <img src={shot.thumb} alt={person.name} title={photoCredit(shot)} loading="lazy" className="h-full w-full object-cover" />
              ) : (
                <span className="grid h-full w-full place-items-center font-display text-5xl font-bold" style={{ color: `color-mix(in srgb, ${accent} 70%, #1c2b28)` }} aria-hidden>
                  {initialsOf(person.name)}
                </span>
              )}
              {shot && (
                <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1 py-px text-[7.5px] text-white/85">{photoCredit(shot)}</span>
              )}
            </div>
            <div className="mt-2 min-w-0">
              <p className="line-clamp-2 font-display text-[15px] font-bold leading-tight text-[#14201d]">{person.name}</p>
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[#4d554f]">{person.role || 'Role not reported'}</p>
            </div>
            <div className="mt-auto flex items-center justify-between rounded-md px-2 py-1 text-[9.5px] font-medium text-white" style={{ background: accent }}>
              <span className="truncate">{person.tenure?.trim() || (person.priorCompany?.trim() ? `Previously ${person.priorCompany.trim()}` : company.name)}</span>
              <RotateCcw className="ml-1.5 h-3 w-3 shrink-0 opacity-80" aria-hidden />
            </div>
          </div>
        </div>

        {/* Back */}
        <div
          id={faceId}
          aria-hidden={!flipped}
          className="absolute inset-0 rounded-2xl p-1.5 shadow-card"
          style={{ ...frame, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          <div className="flex h-full flex-col rounded-xl bg-[#f6f3ea] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-display text-[13px] font-bold text-[#14201d]">{person.name}</p>
              <button type="button" tabIndex={flipped ? 0 : -1} onClick={onFlip} className="rounded p-1 text-[#4d554f] hover:bg-black/5" aria-label={`Turn ${person.name}'s card back over`}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.16em]" style={{ color: accent }}>At a glance</p>
            <dl className="mt-2 space-y-1.5">
              <Field label="Role" value={person.role} />
              <Field label="Tenure" value={person.tenure} />
              <Field label="Previously" value={person.priorCompany} />
              <Field label="Known for" value={person.notableProject} />
            </dl>
            {person.bio?.trim() && <p className="mt-2 line-clamp-3 text-[10.5px] leading-snug text-[#4d554f]">{person.bio.trim()}</p>}
            <div className="mt-auto flex items-center justify-between gap-2 pt-2">
              {safeHttpUrl(person.sourceUrl) ? (
                <a href={safeHttpUrl(person.sourceUrl)} target="_blank" rel="noopener noreferrer" tabIndex={flipped ? 0 : -1} className="truncate text-[10px] underline-offset-2 hover:underline" style={{ color: accent }}>
                  Source
                </a>
              ) : <span className="text-[10px] text-[#9a9684]">No source link</span>}
              <button type="button" tabIndex={flipped ? 0 : -1} onClick={onOpenProfile}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-semibold text-white" style={{ background: accent }}>
                Open profile <ArrowUpRight className="h-3 w-3" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
