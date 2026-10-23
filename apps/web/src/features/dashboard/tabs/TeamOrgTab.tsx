import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, FileText, Loader2 } from 'lucide-react';
import type { OrgNode } from '@mi/contracts';
import { useCompany, useDashboardTab, useGenerateReport } from '@/hooks/data';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { HydratingPanel } from './HydratingPanel';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/Modal';
import { useDeepDive } from '@/features/deepdive/DeepDive';
import { safeHttpUrl } from '@/lib/sourceHref';
import { WikiAvatar } from './LeaderGrid';
import type { ProfileCompany } from './ProfileCard';
import { BoardSkeleton, OrgBoard } from './OrgBoard';
import { PersonProfile } from './PersonProfile';
import { cn } from '@/lib/cn';
import { useCachedDashboardTab } from '../useCachedTab';
import { EmptyNote, SearchBox, SectionHeader, SourceLink } from './TabKit';
import { COLUMN_LABEL, COLUMN_ORDER, columnOf, recentMove, type ColumnKey } from './orgRank';
import { footnoteMark, moveNote, statLines } from './personFacts';
import { boardOnly, buildOrgTree, filterOrgTree, matchesQuery, type OrgTreeNode } from './tabHelpers';
import { personAskSeed } from '@/features/deepdive/askSeed';

const LIST_PAGE = 40;

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
          aria-label={`${p.name}${p.role ? `, ${p.role}` : ''}. Open profile`}
        >
          <WikiAvatar name={p.name} companyName={companyName} size="sm" />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="break-words text-sm font-semibold text-content">{p.name}</span>
              {ribbon && (
                <span className="rounded-full border border-primary/30 px-2 py-px text-[10.5px] font-medium text-primary-ink">
                  {moveNote(p)}
                </span>
              )}
            </span>
            {p.role && <span className="block break-words text-xs text-muted">{p.role}</span>}
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

type View = 'people' | 'lines';
const VIEW_KEY = 'mi.teamOrgView';
/** Stored under the old names ("board" / "list") so a choice made before the redesign carries over; "chart" was the board too. */
function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'lines' : 'people';
  } catch {
    return 'people';
  }
}

type Section = 'all' | ColumnKey;

/** One segmented control for the sections that have anyone in them. On a phone it scrolls sideways inside itself. */
function SectionPicker({
  options,
  value,
  onChange,
}: {
  options: Array<{ key: Section; label: string; count: number }>;
  value: Section;
  onChange: (key: Section) => void;
}) {
  return (
    <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
      <div className="inline-flex whitespace-nowrap rounded-lg border border-border bg-surface-2/60 p-0.5" role="group" aria-label="Show section">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            aria-pressed={value === o.key}
            onClick={() => onChange(o.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
              value === o.key ? 'bg-surface text-content shadow-card' : 'text-muted hover:text-content',
            )}
          >
            {o.label}
            <span className={cn('tabular-nums', value === o.key ? 'text-muted' : 'text-faint')}>{o.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function TeamOrgTab({ companyId }: { companyId: string }) {
  const [view, setViewState] = useState<View>(readView);
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v === 'lines' ? 'list' : 'board');
    } catch {
      /* storage unavailable: the choice just will not persist */
    }
  };
  const query = useDashboardTab(companyId, 'team_org');
  // The board of directors lives on Mission & governance; read it only if that tab is already researched.
  const governance = useCachedDashboardTab(companyId, 'mission_governance').data;
  const governanceBoard = useMemo(() => governance?.content.board ?? [], [governance]);
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
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [section, setSection] = useState<Section>('all');
  const [listLimit, setListLimit] = useState(LIST_PAGE);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const orgReport = useGenerateReport();
  const navigate = useNavigate();

  const nodes = query.data?.content.nodes;
  const people = useMemo(() => nodes ?? [], [nodes]);
  const forest = useMemo(() => buildOrgTree(people), [people]);
  // A director who is already on the team list is shown there, not a second time.
  const boardMembers = useMemo(() => boardOnly(governanceBoard, people), [governanceBoard, people]);
  // Reporting lines that survived tolerant parsing (a missing manager or a cycle is no line).
  const hasLines = useMemo(() => forest.some((root) => root.children.length > 0), [forest]);
  const counts = useMemo(() => {
    const map = new Map<ColumnKey, number>();
    for (const p of people) map.set(columnOf(p), (map.get(columnOf(p)) ?? 0) + 1);
    if (boardMembers.length) map.set('board', (map.get('board') ?? 0) + boardMembers.length);
    return map;
  }, [people, boardMembers]);
  const withSource = useMemo(() => people.filter((p) => safeHttpUrl(p.sourceUrl)).length, [people]);
  // The reporting-lines view earns its place only when research sourced a line.
  const shownView: View = hasLines ? view : 'people';

  const searching = search.trim().length > 0;
  const filtering = searching || section !== 'all';
  const keep = useMemo(() => (p: OrgNode) =>
    (section === 'all' || columnOf(p) === section) &&
    matchesQuery(`${p.name} ${p.role} ${p.priorCompany ?? ''} ${p.notableProject ?? ''}`, search),
  [section, search]);
  const filtered = useMemo(() => (filtering ? people.filter(keep) : people), [people, filtering, keep]);
  const visible = useMemo(() => (filtering ? filterOrgTree(forest, keep) : forest), [forest, filtering, keep]);
  // Directors from the governance research carry a name and an affiliation; the search matches both.
  const shownBoard = useMemo(
    () =>
      section !== 'all' && section !== 'board'
        ? []
        : boardMembers.filter((m) => matchesQuery(`${m.name} ${m.affiliation ?? ''}`, search)),
    [boardMembers, section, search],
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
  const clearFilters = () => {
    setSearch('');
    setSection('all');
  };

  const sectionOptions = useMemo(
    () => [
      { key: 'all' as Section, label: 'Everyone', count: people.length + boardMembers.length },
      ...COLUMN_ORDER.filter((k) => (counts.get(k) ?? 0) > 0).map((k) => ({ key: k as Section, label: COLUMN_LABEL[k], count: counts.get(k)! })),
    ],
    [people.length, boardMembers.length, counts],
  );

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
              count={`${total} ${total === 1 ? 'person' : 'people'}${withSource > 0 ? ` · ${withSource} with a source` : ''}`}
              description={
                shownView === 'lines'
                  ? 'Who reports to whom, as sources reported it. Select a person for their background and sources.'
                  : `The people who run ${name}, grouped by role. Select a person for their background and sources.`
              }
              actions={orgReportButton}
            />

            {/* Toolbar: search and the view switch, then one segmented control for the sections. */}
            <div className="mb-6 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <SearchBox
                  value={search}
                  onChange={setSearch}
                  label="Search people"
                  placeholder="Search name, role, prior company"
                  className="w-full sm:w-80"
                />
                {hasLines && (
                  <div className="ml-auto inline-flex rounded-lg border border-border bg-surface-2/60 p-0.5" role="group" aria-label="View">
                    {([['people', 'People'], ['lines', 'Reporting lines']] as const).map(([v, label]) => (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={shownView === v}
                        onClick={() => setView(v)}
                        className={cn(
                          'rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
                          shownView === v ? 'bg-surface text-content shadow-card' : 'text-muted hover:text-content',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {sectionOptions.length > 2 && <SectionPicker options={sectionOptions} value={section} onChange={setSection} />}
              {shownView === 'lines' && parents.length > 0 && !filtering && (
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

            {shownView === 'people' ? (
              nothingShown ? (
                <NoMatches search={search} onClear={clearFilters} />
              ) : (
                <OrgBoard people={filtered} company={profileCompany} board={shownBoard} onOpen={setSelectedPersonId} />
              )
            ) : visible.length === 0 ? (
              <NoMatches search={search} onClear={clearFilters} />
            ) : (
              <>
                <ul className="space-y-2">
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
            <p className="mt-6 text-[11px] leading-relaxed text-faint">
              Only details a source reported are shown. Deeper research on a person, from their profile, can fill in more.
            </p>

            {selected && (
              <Dialog
                open
                onOpenChange={(open) => {
                  if (!open) setSelectedPersonId(null);
                }}
              >
                <DialogContent size="xl" aria-describedby={undefined}>
                  <DialogTitle className="sr-only">{selected.name}</DialogTitle>
                  <PersonProfile
                    people={result.content.nodes}
                    selectedId={selected.id}
                    onSelect={setSelectedPersonId}
                    company={profileCompany}
                    onAsk={(person) => {
                      chat(
                        { kind: 'datapoint', deckId: null, companyId, subject: person.name },
                        {
                          seed: personAskSeed({
                            name: person.name,
                            role: person.role,
                            company: name === 'this company' ? null : name,
                            tenure: person.tenure,
                            priorCompany: person.priorCompany,
                            notableProject: person.notableProject,
                            bio: person.bio,
                          }),
                        },
                      );
                      setSelectedPersonId(null);
                    }}
                  />
                </DialogContent>
              </Dialog>
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
