/**
 * The team page's main view: people in labelled sections, in the order a
 * reader meets a company. Leadership (founders and the chief executive) comes
 * first as larger cards, then executives, research, product and design, other
 * roles, and the board last. Each section is a clean grid of calm cards; a
 * card opens the person's profile.
 *
 * Reporting lines are not drawn here: when research sourced them, the tab's
 * "Reporting lines" view shows them as a tree and each profile names the
 * manager. Honesty lives in the data layer: empty sections are not drawn, and
 * a director known only from the governance research is a name with its
 * reported affiliation (no card, no profile, nothing made up).
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { BoardMember, OrgNode } from '@mi/contracts';
import { cn } from '@/lib/cn';
import { ProfileCard, Portrait, type ProfileCompany } from './ProfileCard';
import { COLUMN_LABEL, groupColumns, type ColumnKey } from './orgRank';

/** Cards per section before the rest wait behind "Show N more" (two rows on a wide screen). */
export const SECTION_LIMIT = 8;
/** Kept for callers that still say column. */
export const COLUMN_LIMIT = SECTION_LIMIT;

/** What the section filter can pick: a people section (the board includes directors from governance research). */
export type BoardColumnKey = ColumnKey;

/** Whether a media query matches. Safe where `matchMedia` is missing (false). */
function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, [query]);
  return matches;
}

/** True under 768px: the phone layout. */
export function useIsNarrow(): boolean {
  return useMedia('(max-width: 767px)');
}

const SECTION_HINT: Partial<Record<ColumnKey, string>> = {
  founders: 'Founders and the chief executive',
};

function SectionTitle({ id, label, count, hint }: { id: string; label: string; count: number; hint?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-border pb-2">
      <h3 id={id} className="font-display text-[15px] font-semibold text-content">
        {label}
      </h3>
      <span className="text-[12px] tabular-nums text-faint">{count}</span>
      {hint && <span className="text-[12px] text-muted">· {hint}</span>}
    </div>
  );
}

function ShowMore({ count, label, onClick }: { count: number; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Show ${count} more in ${label}`}
      className="mt-3 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] font-medium text-primary-ink hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    >
      Show {count} more <ChevronDown className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

/** A director named by the governance research: a name, the reported affiliation when there is one, and initials. */
function DirectorTile({ member, companyName }: { member: BoardMember; companyName: string }) {
  const affiliation = member.affiliation?.trim();
  return (
    <div data-director className="flex h-full min-w-0 items-start gap-3 rounded-xl border border-dashed border-border bg-surface/60 p-3">
      <Portrait person={{ name: member.name, photoUrl: null }} companyName={companyName} size="sm" />
      <span className="min-w-0">
        <span className="block break-words text-[14px] font-semibold leading-tight text-content">{member.name}</span>
        {affiliation && <span className="mt-0.5 block break-words text-[12.5px] leading-snug text-muted">{affiliation}</span>}
      </span>
    </div>
  );
}

const LEAD_GRID = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3';
/** Leadership rows never leave one card alone on a line: four sit 2 by 2, or 4 across on a wide screen. */
function leadGrid(count: number): string {
  if (count <= 1) return 'grid max-w-xl gap-3';
  if (count === 2) return 'grid gap-3 sm:grid-cols-2';
  if (count === 4) return 'grid gap-3 sm:grid-cols-2 2xl:grid-cols-4';
  return LEAD_GRID;
}
const CARD_GRID = 'grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr))]';

export interface OrgBoardProps {
  /** People to show (already filtered). */
  people: readonly OrgNode[];
  company: ProfileCompany;
  /** Directors from the governance research who are not already on the team list (already filtered). */
  board: readonly BoardMember[];
  onOpen: (id: string) => void;
}

export function OrgBoard({ people, company, board, onOpen }: OrgBoardProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const expand = (key: string) => setExpanded((prev) => new Set(prev).add(key));

  const directors = useMemo(() => {
    const seen = new Set<string>();
    return board.filter((m) => {
      const key = m.name?.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [board]);

  const sections = useMemo(() => {
    const cols = groupColumns(people);
    if (directors.length > 0 && !cols.some((c) => c.key === 'board')) {
      cols.push({ key: 'board', label: COLUMN_LABEL.board, people: [] });
    }
    return cols;
  }, [people, directors.length]);

  return (
    <div className="space-y-8" role="group" aria-label="Org board">
      {sections.map((section) => {
        const lead = section.key === 'founders';
        const isBoard = section.key === 'board';
        const open = lead || expanded.has(section.key);
        const shownPeople = open ? section.people : section.people.slice(0, SECTION_LIMIT);
        const room = Math.max(0, SECTION_LIMIT - shownPeople.length);
        const shownDirectors = isBoard ? (open ? directors : directors.slice(0, room)) : [];
        const total = section.people.length + (isBoard ? directors.length : 0);
        const hidden = total - shownPeople.length - shownDirectors.length;
        const headingId = `team-section-${section.key}`;
        return (
          <section key={section.key} aria-labelledby={headingId} data-section={section.key}>
            <SectionTitle id={headingId} label={section.label} count={total} hint={SECTION_HINT[section.key]} />
            <ul className={lead ? leadGrid(shownPeople.length) : CARD_GRID}>
              {shownPeople.map((p) => (
                <li key={p.id} className="min-w-0">
                  <ProfileCard person={p} company={company} onOpenProfile={() => onOpen(p.id)} variant={lead ? 'lead' : 'compact'} />
                </li>
              ))}
              {shownDirectors.map((m) => (
                <li key={`director:${m.name}`} className="min-w-0">
                  <DirectorTile member={m} companyName={company.name} />
                </li>
              ))}
            </ul>
            {isBoard && directors.length > 0 && (
              <p className="mt-2 text-[11.5px] text-faint">Names in a dashed outline come from the governance research and have no profile here.</p>
            )}
            {hidden > 0 && <ShowMore count={hidden} label={section.label} onClick={() => expand(section.key)} />}
          </section>
        );
      })}
    </div>
  );
}

/** Loading state: a leadership row and a grid of outlined cards, no names. */
export function BoardSkeleton() {
  return (
    <div className="space-y-8" aria-hidden>
      {[3, 8].map((n, s) => (
        <div key={s}>
          <div className="mb-3 h-4 w-28 animate-pulse rounded motion-reduce:animate-none bg-border" />
          <div className={s === 0 ? LEAD_GRID : CARD_GRID}>
            {Array.from({ length: n }, (_, i) => (
              <div
                key={i}
                className={cn('animate-pulse rounded-xl motion-reduce:animate-none border border-border bg-surface/60', s === 0 ? 'h-[132px]' : 'h-[72px]')}
                style={{ animationDelay: `${i * 60}ms` }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
