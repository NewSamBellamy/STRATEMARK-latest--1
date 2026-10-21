/**
 * The murder board: a dot-grid pinboard with one column per function, each a
 * stack of pinned player cards at full size (never fit-to-zoom). Red strings
 * tie a card to its manager, and only where research sourced a reporting line.
 *
 * No chart library: the board is a CSS grid of columns plus one SVG overlay
 * for the strings, anchored to each card's pin. On a phone there is no canvas:
 * each function is a swipe row of cards and the reporting line is text on the
 * back of the card.
 *
 * Honesty lives in the data layer, not here: empty columns are not drawn, a
 * board member is only a name tag with its reported affiliation, and a card
 * that was never given a reporting line has no string.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import type { BoardMember, OrgNode } from '@mi/contracts';
import { cn } from '@/lib/cn';
import { safeHttpUrl } from '@/lib/sourceHref';
import { ProfileCard, type ProfileCompany } from './ProfileCard';
import { COLUMN_COLOR, groupColumns, recentMove, type ColumnKey, type OrgColumn } from './orgRank';

/** People per column before the rest fold into a "+N more" pin. */
export const COLUMN_LIMIT = 6;
const BOARD_LIMIT = 8;

/** What the Function filter can switch off: a people column, or the board of directors. */
export type BoardColumnKey = ColumnKey | 'board';

const DOT_GRID =
  'bg-[radial-gradient(circle_at_1px_1px,rgb(var(--c-border))_1px,transparent_0)] [background-size:22px_22px]';

/** True under 768px: the phone layout (no canvas, swipe rows). Safe where `matchMedia` is missing. */
export function useIsNarrow(): boolean {
  const query = '(max-width: 767px)';
  const [narrow, setNarrow] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const onChange = () => setNarrow(mql.matches);
    onChange();
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);
  return narrow;
}

interface Point { x: number; y: number }
interface Edge { key: string; from: string; to: string }

const cardKey = (id: string) => `card:${id}`;
const moreKey = (col: string) => `more:${col}`;

/** A thread between two pins that sags a little under its own weight. */
function threadPath(a: Point, b: Point): string {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const sag = Math.min(10 + dist * 0.08, 48);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 + sag * 2;
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

function ColumnHeader({ label, count, color }: { label: string; count: number; color?: string }) {
  return (
    <h4 className="mb-3 flex items-center gap-2 border-b border-border pb-2 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-content">
      {color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />}
      {label}
      <span className="font-sans text-[11px] font-normal tabular-nums text-muted">{count}</span>
    </h4>
  );
}

/** "+N more": the pin a collapsed column hangs its overflow on. Strings to a hidden card end here. */
function MorePin({ colKey, count, label, onExpand }: { colKey: string; count: number; label: string; onExpand: () => void }) {
  return (
    <div className="relative pt-2">
      <span
        data-pin-for={moreKey(colKey)}
        data-pin
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-2 z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'radial-gradient(circle at 35% 30%, #ff9a8d, #c62828 58%, #7f1d1d)', boxShadow: '0 1px 2px rgb(0 0 0 / 0.45)' }}
      />
      <button
        type="button"
        onClick={onExpand}
        aria-label={`Show ${count} more in ${label}`}
        className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-surface px-3 py-3 text-[12px] font-semibold text-primary-ink shadow-card transition-colors hover:bg-surface-2"
      >
        +{count} more <ChevronRight className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

function BoardTags({ members, expanded, onExpand }: { members: BoardMember[]; expanded: boolean; onExpand: () => void }) {
  const shown = expanded ? members : members.slice(0, BOARD_LIMIT);
  return (
    <ul className="space-y-2">
      {shown.map((m) => (
        <li key={m.name} className="rounded-lg border border-border bg-surface px-3 py-2 shadow-card">
          <p className="break-words text-[12.5px] font-semibold leading-snug text-content">{m.name}</p>
          <p className="break-words text-[11px] leading-snug text-muted">{m.affiliation?.trim() || 'Affiliation not yet sourced'}</p>
        </li>
      ))}
      {members.length > shown.length && (
        <li>
          <button type="button" onClick={onExpand} className="w-full rounded-lg border border-dashed border-border px-3 py-2 text-[12px] font-semibold text-primary-ink hover:bg-surface-2">
            +{members.length - shown.length} more
          </button>
        </li>
      )}
    </ul>
  );
}

/** A reported, sourced move from the last year: a note pinned beside the cards, not a second copy of the card. */
function MoveNotes({ movers, onOpen }: { movers: OrgNode[]; onOpen: (id: string) => void }) {
  return (
    <ul className="space-y-2">
      {movers.map((p) => {
        const move = recentMove(p)!;
        return (
          <li key={p.id} className="rounded-lg border border-border bg-surface px-3 py-2 shadow-card">
            <p className="text-[9.5px] font-bold uppercase tracking-wide text-negative">{move.label}</p>
            <button type="button" onClick={() => onOpen(p.id)} className="mt-0.5 break-words text-left text-[12.5px] font-semibold leading-snug text-content hover:underline">
              {p.name}
            </button>
            <p className="break-words text-[11px] leading-snug text-muted">{p.role || 'Role not reported'}</p>
            <a href={safeHttpUrl(move.sourceUrl)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[11px] text-primary-ink hover:underline">
              Source
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export interface OrgBoardProps {
  /** People to show (already filtered). */
  people: readonly OrgNode[];
  /** Reporting lines that survived tolerant parsing: person id to manager id. */
  parentOf: ReadonlyMap<string, string>;
  company: ProfileCompany;
  board: readonly BoardMember[];
  onOpen: (id: string) => void;
}

export function OrgBoard({ people, parentOf, company, board, onOpen }: OrgBoardProps) {
  const narrow = useIsNarrow();
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const toggleFlip = useCallback((id: string) => setFlipped((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);
  const expand = useCallback((col: string) => setExpanded((prev) => new Set(prev).add(col)), []);

  const nameById = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const columns: OrgColumn[] = useMemo(() => groupColumns(people), [people]);
  const shownColumns = useMemo(
    () => columns.map((c) => ({ ...c, shown: expanded.has(c.key) ? c.people : c.people.slice(0, COLUMN_LIMIT) })),
    [columns, expanded],
  );
  const boardRows = useMemo(() => {
    const seen = new Set<string>();
    return board.filter((m) => m.name?.trim() && !seen.has(m.name.trim().toLowerCase()) && seen.add(m.name.trim().toLowerCase()));
  }, [board]);
  const showBoard = boardRows.length > 0;
  const movers = useMemo(() => columns.flatMap((c) => c.people).filter((p) => recentMove(p) !== null), [columns]);

  // Strings: one per reporting line whose two ends are both on the board.
  // An end folded behind "+N more" is tied to that column's pin instead.
  const edges: Edge[] = useMemo(() => {
    const visibleCards = new Set(shownColumns.flatMap((c) => c.shown.map((p) => p.id)));
    const columnOfPerson = new Map(shownColumns.flatMap((c) => c.people.map((p) => [p.id, c.key] as const)));
    const resolve = (id: string): string | null => {
      if (visibleCards.has(id)) return cardKey(id);
      const col = columnOfPerson.get(id);
      return col ? moreKey(col) : null;
    };
    const out: Edge[] = [];
    const seen = new Set<string>();
    for (const [personId, managerId] of parentOf) {
      const from = resolve(managerId);
      const to = resolve(personId);
      if (!from || !to || from === to) continue;
      const key = `${from}>${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, from, to });
    }
    return out;
  }, [shownColumns, parentOf]);

  // Who is lit when a card is hovered or focused: itself, its manager and its reports.
  const related = useMemo(() => {
    if (!activeId) return null;
    const ids = new Set<string>([activeId]);
    const manager = parentOf.get(activeId);
    if (manager) ids.add(manager);
    for (const [personId, managerId] of parentOf) if (managerId === activeId) ids.add(personId);
    return ids;
  }, [activeId, parentOf]);

  const contentRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<Record<string, Point>>({});
  const [fade, setFade] = useState(false);

  const measure = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;
    const origin = content.getBoundingClientRect();
    const next: Record<string, Point> = {};
    for (const pin of content.querySelectorAll<HTMLElement>('[data-pin]')) {
      const owner = pin.closest<HTMLElement>('[data-person-id]');
      const key = owner ? cardKey(owner.dataset.personId!) : pin.dataset.pinFor;
      if (!key) continue;
      const r = pin.getBoundingClientRect();
      next[key] = { x: Math.round((r.left + r.width / 2 - origin.left) * 10) / 10, y: Math.round((r.top + r.height / 2 - origin.top) * 10) / 10 };
    }
    setPoints((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    const scroller = scrollerRef.current;
    if (scroller) setFade(scroller.scrollWidth > scroller.clientWidth + scroller.scrollLeft + 4);
  }, []);

  useLayoutEffect(() => {
    if (narrow) return undefined;
    measure();
    const content = contentRef.current;
    if (!content) return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(content);
    for (const el of content.querySelectorAll('[data-person-id], [data-pin-for]')) ro.observe(el);
    window.addEventListener('resize', measure);
    void document.fonts?.ready.then(measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, narrow, shownColumns, showBoard, movers.length]);

  const pathFor = (e: Edge) => threadPath(points[e.from] ?? { x: 0, y: 0 }, points[e.to] ?? { x: 0, y: 0 });

  const onCardBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActiveId(null);
  };

  let enter = 0;
  const card = (p: OrgNode) => (
    <div
      key={p.id}
      className="w-full"
      onPointerEnter={() => setActiveId(p.id)}
      onPointerLeave={() => setActiveId(null)}
      onFocus={() => setActiveId(p.id)}
      onBlur={onCardBlur}
    >
      <ProfileCard
        person={p}
        company={company}
        flipped={flipped.has(p.id)}
        onFlip={() => toggleFlip(p.id)}
        onOpenProfile={() => onOpen(p.id)}
        dim={related ? !related.has(p.id) : false}
        reportsTo={parentOf.has(p.id) ? nameById.get(parentOf.get(p.id)!) ?? null : null}
        enterIndex={enter++}
      />
    </div>
  );

  const total = columns.reduce((n, c) => n + c.people.length, 0);

  // One person: a single centred card. No columns, no strings.
  if (!narrow && total === 1 && columns.length === 1 && !showBoard) {
    return (
      <div className={cn('panel flex justify-center px-4 py-8', DOT_GRID)} role="group" aria-label="Org board">
        <div className="w-[232px]">{card(columns[0]!.people[0]!)}</div>
      </div>
    );
  }

  if (narrow) {
    return (
      <div className="space-y-5" role="group" aria-label="Org board">
        {shownColumns.map((col) => (
          <section key={col.key} aria-label={col.label}>
            <ColumnHeader label={col.label} count={col.people.length} color={COLUMN_COLOR[col.key]} />
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-3 pt-2">
              {col.shown.map((p) => (
                <div key={p.id} className="w-[200px] shrink-0 snap-start">{card(p)}</div>
              ))}
              {col.people.length > col.shown.length && (
                <div className="w-[120px] shrink-0 snap-start self-start">
                  <MorePin colKey={col.key} count={col.people.length - col.shown.length} label={col.label} onExpand={() => expand(col.key)} />
                </div>
              )}
            </div>
          </section>
        ))}
        {movers.length > 0 && (
          <section aria-label="Moves">
            <ColumnHeader label="Moves" count={movers.length} />
            <MoveNotes movers={movers} onOpen={onOpen} />
          </section>
        )}
        {showBoard && (
          <section aria-label="Board">
            <ColumnHeader label="Board" count={boardRows.length} />
            <BoardTags members={boardRows} expanded={expanded.has('board')} onExpand={() => expand('board')} />
          </section>
        )}
      </div>
    );
  }

  const template = [
    ...shownColumns.map(() => 'minmax(176px, 232px)'),
    ...(movers.length > 0 ? ['minmax(150px, 200px)'] : []),
    ...(showBoard ? ['minmax(136px, 192px)'] : []),
  ].join(' ');

  return (
    <div className="panel relative overflow-hidden" role="group" aria-label="Org board">
      <div ref={scrollerRef} onScroll={measure} className={cn('overflow-x-auto', DOT_GRID)}>
        <div
          ref={contentRef}
          className="relative grid items-start gap-x-3 px-4 pb-6 pt-6"
          style={{ gridTemplateColumns: template, justifyContent: 'safe center' }}
        >
          {/* Every string, tucked behind the cards so the names stay readable. */}
          <svg className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible" aria-hidden focusable="false">
            {edges.map((e) => (
              <path
                key={e.key}
                data-string
                data-from={e.from}
                data-to={e.to}
                className="sm-string"
                pathLength={1}
                d={pathFor(e)}
                fill="none"
                stroke="rgb(var(--c-negative))"
                strokeLinecap="round"
                strokeWidth={1.5}
                style={{ opacity: related ? 0.15 : 0.55, transition: 'opacity 150ms' }}
              />
            ))}
          </svg>
          {/* The hovered or focused card's own strings, drawn bolder (still behind the cards). */}
          <svg className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible" aria-hidden focusable="false">
            {edges
              .filter((e) => activeId !== null && (e.from === cardKey(activeId) || e.to === cardKey(activeId)))
              .map((e) => (
                <path key={e.key} data-string-lit d={pathFor(e)} fill="none" stroke="rgb(var(--c-negative))" strokeLinecap="round" strokeWidth={2.5} />
              ))}
          </svg>
          {shownColumns.map((col) => (
            <section key={col.key} aria-label={col.label} className="relative z-10 min-w-0">
              <ColumnHeader label={col.label} count={col.people.length} color={COLUMN_COLOR[col.key]} />
              <div className="space-y-6">
                {col.shown.map(card)}
                {col.people.length > col.shown.length && (
                  <MorePin colKey={col.key} count={col.people.length - col.shown.length} label={col.label} onExpand={() => expand(col.key)} />
                )}
              </div>
            </section>
          ))}
          {movers.length > 0 && (
            <section aria-label="Moves" className="relative z-10 min-w-0">
              <ColumnHeader label="Moves" count={movers.length} />
              <MoveNotes movers={movers} onOpen={onOpen} />
            </section>
          )}
          {showBoard && (
            <section aria-label="Board" className="relative z-10 min-w-0">
              <ColumnHeader label="Board" count={boardRows.length} />
              <BoardTags members={boardRows} expanded={expanded.has('board')} onExpand={() => expand('board')} />
            </section>
          )}
        </div>
      </div>
      {fade && <div className="pointer-events-none absolute inset-y-0 right-0 z-40 w-12 bg-gradient-to-l from-surface to-transparent" aria-hidden />}
    </div>
  );
}

/** Skeleton columns for the loading state: two outlined cards each, no names. */
export function BoardSkeleton() {
  return (
    <div className={cn('panel grid grid-cols-2 gap-3 overflow-hidden px-4 pb-6 pt-6 md:grid-cols-4 xl:grid-cols-5', DOT_GRID)} aria-hidden>
      {[0, 1, 2, 3, 4].map((c) => (
        <div key={c} className={cn('space-y-6', c > 1 && 'hidden md:block', c > 3 && 'md:hidden xl:block')}>
          <div className="h-3 w-24 animate-pulse rounded bg-border" style={{ animationDelay: `${c * 90}ms` }} />
          {[0, 1].map((r) => (
            <div key={r} className="h-[300px] animate-pulse rounded-2xl border border-border bg-surface/60" style={{ animationDelay: `${c * 90 + r * 60}ms` }} />
          ))}
        </div>
      ))}
    </div>
  );
}
