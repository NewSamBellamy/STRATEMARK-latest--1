import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, FileText, Loader2, SlidersHorizontal } from 'lucide-react';
import type { OrgNode } from '@mi/contracts';
import { useCompany, useDashboardTab, useGenerateReport } from '@/hooks/data';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { HydratingPanel } from './HydratingPanel';
import { Modal } from '@/components/ui/Modal';
import { useDeepDive } from '@/features/deepdive/DeepDive';
import { safeHttpUrl } from '@/lib/sourceHref';
import { LeaderGrid, WikiAvatar } from './LeaderGrid';
import type { ProfileCompany } from './ProfileCard';
import { BoardSkeleton, OrgBoard, useIsNarrow, type BoardColumnKey } from './OrgBoard';
import { PersonProfile } from './PersonProfile';
import { cn } from '@/lib/cn';
import { useCachedDashboardTab } from '../useCachedTab';
import { EmptyNote, FilterChip, SearchBox, SectionHeader, SourceLink } from './TabKit';
import { COLUMN_COLOR, COLUMN_LABEL, GROUP_COLOR, GROUP_LABEL, columnOf, recentMove, type ColumnKey } from './orgRank';
import { footnoteMark, reported, statLines } from './personFacts';
import { buildOrgTree, filterOrgTree, matchesQuery, type OrgTreeNode } from './tabHelpers';

const UNKNOWN = 'Unknown';
const LIST_PAGE = 40;

function reportedValue(value: string | null | undefined): string {
  return value?.trim() || UNKNOWN;
}

/** One person in the list: portrait, name, role, the lines research found, collapse toggle. */
function OrgRow({
  node,
  companyName,
  collapsed,
  forceOpen,
  allowed,
  onToggle,
  onOpen,
}: {
  node: OrgTreeNode;
  companyName: string;
  collapsed: Set<string>;
  forceOpen: boolean;
  /** Ids the list is currently showing (rows beyond the page limit wait behind "Show more"). */
  allowed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const p = node.person;
  if (!allowed.has(p.id)) return null;
  const hasKids = node.children.length > 0;
  const isOpen = forceOpen || !collapsed.has(p.id);
  const stats = statLines(p);
  const ribbon = recentMove(p);
  return (
    <li className="relative">
      {node.depth > 0 && <span className="absolute -left-4 top-7 h-px w-4 bg-border" aria-hidden />}
      <div
        className={cn(
          'flex items-center gap-3 rounded-xl border border-border bg-surface p-2.5 pr-3 transition-colors hover:border-primary/40 hover:bg-surface-2/50',
          node.depth === 0 && 'shadow-card',
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left"
          onClick={() => onOpen(p.id)}
          title={p.bio || `${p.name} — open profile`}
          aria-label={`${p.name}, ${p.role || 'role not reported'} — open profile`}
        >
          <WikiAvatar name={p.name} companyName={companyName} size="sm" />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="break-words text-sm font-semibold text-content">{p.name}</span>
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: GROUP_COLOR[p.group] }}
                title={GROUP_LABEL[p.group]}
                aria-hidden
              />
              {ribbon && (
                <span className="rounded bg-negative/10 px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide text-negative">
                  {ribbon.label}
                </span>
              )}
            </span>
            <span className="block break-words text-xs text-muted">{p.role || 'Role not reported'}</span>
            {stats.length > 0 && (
              <span className="mt-0.5 block break-words text-[11px] text-faint">
                {stats.map((s, i) => (
                  <span key={s.key}>
                    {i > 0 && ' · '}
                    {s.label === 'Previously' ? `ex-${s.value}` : s.value}
                    <sup className="ml-px font-semibold">{footnoteMark(1)}</sup>
                  </span>
                ))}
              </span>
            )}
          </span>
        </button>
        {p.sourceUrl && <SourceLink url={p.sourceUrl} label="Source" className="shrink-0" />}
        {hasKids && (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${p.name}: ${node.descendants} ${node.descendants === 1 ? 'person' : 'people'} below`}
            disabled={forceOpen}
            onClick={() => onToggle(p.id)}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] tabular-nums text-muted transition-colors hover:bg-surface-2 hover:text-content disabled:cursor-default disabled:hover:bg-transparent"
          >
            {node.descendants}
            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-90')} />
          </button>
        )}
      </div>
      {hasKids && isOpen && (
        <ul className="ml-5 mt-2 space-y-2 border-l border-border pl-4">
          {node.children.map((c) => (
            <OrgRow key={c.person.id}
                node={c}
                companyName={companyName}
                collapsed={collapsed}
                forceOpen={forceOpen}
                allowed={allowed}
                onToggle={onToggle}
                onOpen={onOpen}
              />
          ))}
        </ul>
      )}
    </li>
  );
}

type View = 'board' | 'list';
const VIEW_KEY = 'mi.teamOrgView';
/** The old "chart" view is the board now; only an explicit "list" stays a list. */
function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'board';
  } catch {
    return 'board';
  }
}

const FUNCTION_ORDER: ColumnKey[] = ['founders', 'exec', 'ai', 'product_design', 'other'];

export function TeamOrgTab({ companyId }: { companyId: string }) {
  const [view, setViewState] = useState<View>(readView);
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* storage unavailable: the choice just will not persist */
    }
  };
  const query = useDashboardTab(companyId, 'team_org');
  // The board of directors lives on Mission & governance; read it only if that tab is already researched.
  const governance = useCachedDashboardTab(companyId, 'mission_governance').data;
  const boardMembers = useMemo(() => governance?.content.board ?? [], [governance]);
  const companyQ = useCompany(companyId).data;
  const name = companyQ?.name ?? 'this company';
  const profileCompany: ProfileCompany = useMemo(() => ({
    id: companyId,
    name,
    logoUrl: companyQ?.logoUrl ?? null,
    websiteUrl: companyQ?.websiteUrl ?? null,
    brandTheme: companyQ?.brandTheme ?? null,
  }), [companyId, name, companyQ?.logoUrl, companyQ?.websiteUrl, companyQ?.brandTheme]);
  const { chat } = useDeepDive();
  const narrow = useIsNarrow();
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [functions, setFunctions] = useState<ReadonlySet<BoardColumnKey>>(new Set());
  const [moving, setMoving] = useState(false);
  const [hasSource, setHasSource] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [listLimit, setListLimit] = useState(LIST_PAGE);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const orgReport = useGenerateReport();
  const navigate = useNavigate();

  const nodes = query.data?.content.nodes;
  const people = useMemo(() => nodes ?? [], [nodes]);
  const forest = useMemo(() => buildOrgTree(people), [people]);
  // The reporting lines that survived tolerant parsing (a missing manager or a cycle is no line).
  const parentOf = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (n: OrgTreeNode) => {
      for (const child of n.children) {
        map.set(child.person.id, n.person.id);
        walk(child);
      }
    };
    forest.forEach(walk);
    return map;
  }, [forest]);
  const columnCounts = useMemo(() => {
    const counts = new Map<ColumnKey, number>();
    for (const p of people) counts.set(columnOf(p), (counts.get(columnOf(p)) ?? 0) + 1);
    return counts;
  }, [people]);
  const movingCount = useMemo(() => people.filter((p) => recentMove(p) !== null).length, [people]);
  const withSource = useMemo(() => people.filter((p) => safeHttpUrl(p.sourceUrl)).length, [people]);

  const searching = search.trim().length > 0;
  const activeFilters = functions.size + (moving ? 1 : 0) + (hasSource ? 1 : 0);
  const filtering = searching || activeFilters > 0;
  const keep = useMemo(() => (p: OrgNode) =>
    (functions.size === 0 || functions.has(columnOf(p))) &&
    (!moving || recentMove(p) !== null) &&
    (!hasSource || Boolean(safeHttpUrl(p.sourceUrl))) &&
    matchesQuery(`${p.name} ${p.role} ${p.priorCompany ?? ''} ${p.notableProject ?? ''}`, search),
  [functions, moving, hasSource, search]);
  const filtered = useMemo(() => (filtering ? people.filter(keep) : people), [people, filtering, keep]);
  const visible = useMemo(() => (filtering ? filterOrgTree(forest, keep) : forest), [forest, filtering, keep]);
  // Board names carry no per-person source or move: the toggles for those hide them, the search matches them.
  const shownBoard = useMemo(
    () =>
      moving || hasSource || (functions.size > 0 && !functions.has('board'))
        ? []
        : boardMembers.filter((m) => matchesQuery(`${m.name} ${m.affiliation ?? ''}`, search)),
    [boardMembers, moving, hasSource, functions, search],
  );
  const parents = useMemo(() => {
    const ids: string[] = [];
    const walk = (n: OrgTreeNode) => {
      if (n.children.length) ids.push(n.person.id);
      n.children.forEach(walk);
    };
    forest.forEach(walk);
    return ids;
  }, [forest]);
  // The list shows a page of rows at a time: ids in reading order, honouring collapsed branches.
  const listRows = useMemo(() => {
    const ids: string[] = [];
    const walk = (n: OrgTreeNode) => {
      ids.push(n.person.id);
      if (filtering || !collapsed.has(n.person.id)) n.children.forEach(walk);
    };
    visible.forEach(walk);
    return ids;
  }, [visible, collapsed, filtering]);
  const allowedRows = useMemo(() => new Set(listRows.slice(0, listLimit)), [listRows, listLimit]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleFunction = (key: BoardColumnKey) =>
    setFunctions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const clearFilters = () => {
    setSearch('');
    setFunctions(new Set());
    setMoving(false);
    setHasSource(false);
  };
  const hasLines = parentOf.size > 0;

  // The org-chart teardown: a report researched specifically about how this team is set up.
  const orgReportButton = (
    <button
      type="button"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-content transition-colors hover:bg-surface-2 disabled:opacity-60"
      disabled={orgReport.isPending}
      title="Research a full report on this org: leadership, structure, how the teams are set up (one grounded pass on your key)"
      onClick={() =>
        orgReport.mutate(
          {
            kind: 'company',
            subjectId: companyId,
            focus:
              'The team and org chart: leadership, reporting structure, how the teams are organized, key hires and departures, and what the org design signals about strategy.',
          },
          { onSuccess: (r) => navigate(`/reports/${r.id}`) },
        )
      }
    >
      {orgReport.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <FileText className="h-3.5 w-3.5" />
      )}
      {orgReport.isPending ? 'Researching the org…' : 'Org report'}
    </button>
  );

  const filterControls = (
    <>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by function">
        <FilterChip active={functions.size === 0} onClick={() => setFunctions(new Set())} count={people.length}>
          All
        </FilterChip>
        {FUNCTION_ORDER.filter((k) => (columnCounts.get(k) ?? 0) > 0).map((k) => (
          <FilterChip key={k} active={functions.has(k)} onClick={() => toggleFunction(k)} count={columnCounts.get(k)}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: COLUMN_COLOR[k] }} aria-hidden />
            {COLUMN_LABEL[k]}
          </FilterChip>
        ))}
        {boardMembers.length > 0 && view === 'board' && (
          <FilterChip active={functions.has('board')} onClick={() => toggleFunction('board')} count={boardMembers.length}>
            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" aria-hidden />
            Board
          </FilterChip>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="More filters">
        <span title={movingCount === 0 ? 'No sourced moves in this research' : undefined}>
          <FilterChip active={moving} onClick={() => setMoving((m) => !m)} count={movingCount} disabled={movingCount === 0}>
            Moving
          </FilterChip>
        </span>
        <span title={withSource === 0 ? 'No source pages were retained in this research' : undefined}>
          <FilterChip active={hasSource} onClick={() => setHasSource((s) => !s)} count={withSource} disabled={withSource === 0}>
            Has source
          </FilterChip>
        </span>
      </div>
    </>
  );

  return (
    <QueryBoundary
      query={query}
      loading={(
        <div className="space-y-4">
          <HydratingPanel label="Team & Org" variant="banner" />
          <BoardSkeleton />
        </div>
      )}
      isEmpty={(r) => r.content.nodes.length === 0}
      empty={() => (
        <EmptyNote title="No leadership surfaced yet" action={orgReportButton}>
          Team &amp; Org lists named executives and their reporting lines. It stays empty until
          research finds sourced names and titles for {name}; nothing is inferred.
        </EmptyNote>
      )}
    >
      {(result) => {
        const selected =
          selectedPersonId !== null
            ? result.content.nodes.find((n) => n.id === selectedPersonId)
            : undefined;
        const total = result.content.nodes.length;
        const nothingShown = filtered.length === 0 && shownBoard.length === 0;
        return (
          <div className="cascade">
            <SectionHeader
              title="Team & organization"
              count={`${total} ${total === 1 ? 'person' : 'people'} · ${withSource} with a source`}
              description={
                view === 'board'
                  ? hasLines
                    ? 'Pinned by function. Red strings show who reports to whom, as reported by sources. Turn a card over for its sources; open a profile for the background.'
                    : 'Pinned by function. No reporting lines were sourced, so there are no strings. Turn a card over for its sources; open a profile for the background.'
                  : 'Who reports to whom, as reported by sources. Select a person for background and sources. Collapse branches to focus.'
              }
              actions={
                orgReportButton
              }
            />

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <SearchBox
                value={search}
                onChange={setSearch}
                label="Search people"
                placeholder="Search name, role, prior company"
                className="w-full sm:w-80"
              />
              {narrow ? (
                <button
                  type="button"
                  aria-expanded={filtersOpen}
                  onClick={() => setFiltersOpen((o) => !o)}
                  className="chip border-border bg-surface text-muted hover:text-content"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
                  Filter{activeFilters > 0 ? ` (${activeFilters})` : ''}
                </button>
              ) : (
                filterControls
              )}
              <div className="ml-auto inline-flex rounded-lg border border-border bg-surface-2/60 p-0.5" role="group" aria-label="View">
                {(['board', 'list'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={cn(
                      'rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors',
                      view === v ? 'bg-surface text-content shadow-card' : 'text-muted hover:text-content',
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
              {view === 'list' && parents.length > 0 && !filtering && (
                <span className="flex items-center gap-1 text-[11px]">
                  <button
                    type="button"
                    className="rounded px-1.5 py-1 text-muted hover:bg-surface-2 hover:text-content"
                    onClick={() => setCollapsed(new Set())}
                  >
                    Expand all
                  </button>
                  <button
                    type="button"
                    className="rounded px-1.5 py-1 text-muted hover:bg-surface-2 hover:text-content"
                    onClick={() => setCollapsed(new Set(parents))}
                  >
                    Collapse all
                  </button>
                </span>
              )}
            </div>
            {narrow && filtersOpen && (
              <div className="mb-3 space-y-2 rounded-xl border border-border bg-surface p-3">{filterControls}</div>
            )}

            {view === 'board' ? (
              <div className="space-y-4">
                {/* The human layer: the founders and chiefs, named in full. */}
                {!filtering && (
                  <LeaderGrid nodes={result.content.nodes} companyName={name} onOpenPerson={setSelectedPersonId} />
                )}
                {nothingShown ? (
                  <NoMatches search={search} onClear={clearFilters} />
                ) : (
                  <OrgBoard
                    people={filtered}
                    parentOf={parentOf}
                    company={profileCompany}
                    board={shownBoard}
                    onOpen={setSelectedPersonId}
                  />
                )}
              </div>
            ) : visible.length === 0 ? (
              <NoMatches search={search} onClear={clearFilters} />
            ) : (
              <>
                <ul className={cn(!hasLines ? 'grid gap-2 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-2')}>
                  {visible.map((root) => (
                    <OrgRow
                      key={root.person.id}
                      node={root}
                      companyName={name}
                      collapsed={collapsed}
                      forceOpen={filtering}
                      allowed={allowedRows}
                      onToggle={toggle}
                      onOpen={setSelectedPersonId}
                    />
                  ))}
                </ul>
                {listRows.length > listLimit && (
                  <button
                    type="button"
                    className="mt-3 w-full rounded-xl border border-dashed border-border px-3 py-2.5 text-[12px] font-semibold text-primary-ink hover:bg-surface-2"
                    onClick={() => setListLimit((n) => n + LIST_PAGE)}
                  >
                    Show {Math.min(LIST_PAGE, listRows.length - listLimit)} more of {listRows.length - listLimit}
                  </button>
                )}
              </>
            )}
            <p className="mt-4 text-[11px] leading-relaxed text-faint">
              Titles, tenure and prior roles appear only when a source reported them. A missing
              detail means research has not found it yet; deeper research on a person fills it in.
            </p>

            {selected && (
              <Modal
                open
                size="xl"
                onOpenChange={(open) => {
                  if (!open) setSelectedPersonId(null);
                }}
                title={selected.name}
                description={selected.role}
              >
                <PersonProfile
                  people={result.content.nodes}
                  selectedId={selected.id}
                  onSelect={setSelectedPersonId}
                  company={profileCompany}
                  showHeading={false}
                  onAsk={(person) => {
                    const pinnedContext = [
                      `Name: ${person.name}`,
                      `Role: ${person.role}`,
                      `Company: ${name}`,
                      `Tenure: ${reportedValue(reported(person.tenure))}`,
                      `Prior company: ${reportedValue(reported(person.priorCompany))}`,
                      `Notable project: ${reportedValue(reported(person.notableProject))}`,
                      `Reported background: ${reportedValue(person.bio)}`,
                    ].join('\n');
                    chat(
                      { kind: 'datapoint', deckId: null, companyId, subject: person.name },
                      {
                        seed: `Research ${person.name} at ${name}. Verify the pinned dashboard context below with grounded, current sources. Expand their background, track record, relevant projects, and any meaningful influence on the company. Keep unknowns explicit and distinguish sourced facts from inference.\n\nPinned dashboard context:\n${pinnedContext}`,
                      },
                    );
                    setSelectedPersonId(null);
                  }}
                />
              </Modal>
            )}
          </div>
        );
      }}
    </QueryBoundary>
  );
}

function NoMatches({ search, onClear }: { search: string; onClear: () => void }) {
  const q = search.trim();
  return (
    <EmptyNote
      compact
      title={q ? `No one matches “${q}”` : 'No one matches these filters'}
      action={
        <button type="button" onClick={onClear} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-content hover:bg-surface-2">
          {q ? 'Clear search' : 'Clear filters'}
        </button>
      }
    >
      Clear the filters to see everyone research has surfaced.
    </EmptyNote>
  );
}
