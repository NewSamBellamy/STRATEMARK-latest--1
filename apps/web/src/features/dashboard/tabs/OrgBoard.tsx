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

/** True under 768px: the phone layout (no canvas, swipe rows). */
export function useIsNarrow(): boolean {
  return useMedia('(max-width: 767px)');
}

/** From 1024px up a long column flows into two sub-columns; below that the board scrolls sideways instead. */
const useIsWide = () => useMedia('(min-width: 1024px)');

/** A column with more cards than this flows into two sub-columns at wide widths. */
export const SPLIT_ABOVE = 4;
/** A manager with more direct reports than this gets one trunk per column, not a string to every report. */
export const FAN_LIMIT = 6;

/** `hw`: half the width of the card the pin sits on, so a string can clear the card's edge. */
interface Point {
  x: number;
  y: number;
  hw?: number;
  /** The y of the gutter strip just under this pin's column header, where a string runs sideways before it drops into the pin. */
  strip?: number;
}
interface Edge {
  key: string;
  from: string;
  to: string;
  /** A trunk to a column header pin: lit with its manager and with any of the reports it stands for. */
  reports?: readonly string[];
}

const cardKey = (id: string) => `card:${id}`;
const moreKey = (col: string) => `more:${col}`;
const headKey = (col: string) => `head:${col}`;

const n1 = (v: number) => v.toFixed(1);

/**
 * A thread between two pins, routed to stay in the gaps where it can (it is drawn behind the cards):
 * - pins in one column, one under the other: it loops out into the gutter beside the column;
 * - anything else rises into the strip just above the target's column, sags a little along it, then drops into the pin.
 */
function threadPath(a: Point, b: Point): string {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx < 40 && dy > 30) {
    const reach = ((Math.min(a.hw ?? 70, b.hw ?? 70)) + 7) / 0.75;
    const x = Math.min(a.x, b.x) - reach;
    return `M ${n1(a.x)} ${n1(a.y)} C ${n1(x)} ${n1(a.y)} ${n1(x)} ${n1(b.y)} ${n1(b.x)} ${n1(b.y)}`;
  }
  // Up into the strip above the target's column, a slight sag along it, then down into the pin.
  const mx = (a.x + b.x) / 2;
  const s = b.strip ?? Math.min(a.y, b.y) - 8;
  const sag = Math.min(3 + dx * 0.02, 10);
  return `M ${n1(a.x)} ${n1(a.y)} C ${n1(a.x)} ${n1(s)} ${n1(a.x)} ${n1(s + sag)} ${n1(mx)} ${n1(s + sag)} C ${n1(b.x)} ${n1(s + sag)} ${n1(b.x)} ${n1(s)} ${n1(b.x)} ${n1(b.y)}`;
}

/** `pinKey` hangs a pin on the header's rule: where a trunk string for a big team ties off. */
function ColumnHeader({ label, count, color, pinKey }: { label: string; count: number; color?: string; pinKey?: string }) {
  return (
    <h4 className="relative mb-4 flex items-center gap-1.5 whitespace-nowrap border-b border-border pb-2 font-display text-[10.5px] font-semibold uppercase tracking-[0.08em] text-content">
      {color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />}
      {label}
      <span className="font-sans text-[11px] font-normal tabular-nums text-muted">{count}</span>
      {pinKey && (
        <span
          data-pin-for={pinKey}
          data-pin
          aria-hidden
          className="pointer-events-none absolute -bottom-px left-1/2 h-2.5 w-2.5 -translate-x-1/2 translate-y-1/2 rounded-full"
          style={{ background: 'radial-gradient(circle at 35% 30%, #ff9a8d, #c62828 58%, #7f1d1d)', boxShadow: '0 1px 2px rgb(0 0 0 / 0.45)' }}
        />
      )}
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
  const wide = useIsWide();
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
    const reportsOf = new Map<string, string[]>();
    for (const [personId, managerId] of parentOf) reportsOf.set(managerId, [...(reportsOf.get(managerId) ?? []), personId]);
    const out: Edge[] = [];
    const seen = new Set<string>();
    const add = (edge: Edge) => {
      if (edge.from === edge.to || seen.has(edge.key)) return;
      seen.add(edge.key);
      out.push(edge);
    };
    for (const [managerId, reportIds] of reportsOf) {
      const from = resolve(managerId);
      if (!from) continue;
      // A big team is not a fan of strings: the reports sharing a column hang from one trunk to that column's header.
      const trunked = new Set<string>();
      if (reportIds.length > FAN_LIMIT) {
        const byColumn = new Map<string, string[]>();
        for (const id of reportIds) {
          const col = columnOfPerson.get(id);
          if (col) byColumn.set(col, [...(byColumn.get(col) ?? []), id]);
        }
        for (const [col, ids] of byColumn) {
          add({ key: `${from}>${headKey(col)}`, from, to: headKey(col), reports: ids });
          for (const id of ids) trunked.add(id);
        }
      }
      for (const id of reportIds) {
        const to = trunked.has(id) ? null : resolve(id);
        if (to) add({ key: `${from}>${to}`, from, to });
      }
    }
    return out;
  }, [shownColumns, parentOf]);

  const touches = (e: Edge, id: string) => e.from === cardKey(id) || e.to === cardKey(id) || (e.reports?.includes(id) ?? false);

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
      if (owner) next[key]!.hw = Math.round(owner.getBoundingClientRect().width / 2);
      // The strip sits in the gap between the column header's rule and the first card; a header pin sits on the rule itself.
      const header = pin.closest('section')?.querySelector('h4');
      if (header && !pin.closest('h4')) next[key]!.strip = Math.round((header.getBoundingClientRect().bottom - origin.top + 8) * 10) / 10;
      else if (pin.closest('h4')) next[key]!.strip = next[key]!.y;
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
  }, [measure, narrow, wide, shownColumns, showBoard, movers.length]);

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
        // Cards stay opaque so the strings behind them never show through; the strings dim instead.
        dim={false}
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

  const splits = (col: { shown: OrgNode[] }) => wide && col.shown.length > SPLIT_ABOVE;
  // Card tracks are tight so the whole board fits a 1400px window; the Moves and Board notes need less than a card.
  const template = [
    ...shownColumns.map((col) => (splits(col) ? 'minmax(308px, 464px)' : 'minmax(148px, 232px)')),
    ...(movers.length > 0 ? ['minmax(124px, 168px)'] : []),
    ...(showBoard ? ['minmax(112px, 156px)'] : []),
  ].join(' ');

  // Endpoints that actually carry a string get a knot on the pin.
  const ends = [...new Set(edges.flatMap((e) => [e.from, e.to]))].filter((k) => points[k]);
  const drawn = activeId === null ? [] : edges.filter((e) => touches(e, activeId));

  return (
    <div className="panel relative overflow-hidden" role="group" aria-label="Org board">
      <div ref={scrollerRef} onScroll={measure} className={cn('overflow-x-auto', DOT_GRID)}>
        <div
          ref={contentRef}
          className="relative grid items-start gap-x-3 px-4 pb-6 pt-6"
          style={{ gridTemplateColumns: template, justifyContent: 'safe center' }}
        >
          {/* Every string, hung BEHIND the cards (they are opaque, one layer up): a string shows only in the gaps and above the cards, never across a name. */}
          <svg data-string-layer="back" className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible" aria-hidden focusable="false">
            {edges.map((e) => (
              <path
                key={e.key}
                data-string
                data-from={e.from}
                data-to={e.to}
                className="sm-string sm-thread"
                pathLength={1}
                d={pathFor(e)}
                fill="none"
                strokeLinecap="round"
                strokeWidth={1.5}
                style={{ opacity: related ? 0.4 : 1, transition: 'opacity 150ms' }}
              />
            ))}
          </svg>
          {/* The hovered or focused card's own strings come to the front, bolder; the rest dim to 40 percent behind. */}
          <svg data-string-layer="front" className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible" aria-hidden focusable="false">
            {drawn.map((e) => (
              <path key={e.key} data-string-lit className="sm-thread" d={pathFor(e)} fill="none" strokeLinecap="round" strokeWidth={3} />
            ))}
            {/* Knots at each pin that carries a string, above the cards. */}
            {ends.map((k) => (
              <circle key={k} data-string-end={k} className="sm-thread" cx={points[k]!.x} cy={points[k]!.y} r={2.5} fill="currentColor" style={{ stroke: 'none', opacity: related ? 0.4 : 1 }} />
            ))}
          </svg>
          {shownColumns.map((col) => (
            <section key={col.key} aria-label={col.label} className="relative z-10 min-w-0">
              <ColumnHeader label={col.label} count={col.people.length} color={COLUMN_COLOR[col.key]} pinKey={headKey(col.key)} />
              {splits(col) ? (
                // Two sub-columns, dealt out in rank order (1st left, 2nd right, 3rd left ...) so the top ranks sit side by side.
                <div data-split className="grid grid-cols-2 items-start gap-x-3">
                  {[0, 1].map((side) => (
                    <div key={side} className="min-w-0 space-y-5">
                      {col.shown.filter((_, i) => i % 2 === side).map(card)}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-5">{col.shown.map(card)}</div>
              )}
              {col.people.length > col.shown.length && (
                <div className="mt-5">
                  <MorePin colKey={col.key} count={col.people.length - col.shown.length} label={col.label} onExpand={() => expand(col.key)} />
                </div>
              )}
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
