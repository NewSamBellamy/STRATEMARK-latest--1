import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, FileText, Loader2 } from 'lucide-react';
import type { OrgNode } from '@mi/contracts';
import { ReactFlow, Background, Controls, Handle, Position, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCompany, useDashboardTab, useGenerateReport } from '@/hooks/data';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { HydratingPanel } from './HydratingPanel';
import { Modal } from '@/components/ui/Modal';
import { useDeepDive } from '@/features/deepdive/DeepDive';
import { LeaderGrid, WikiAvatar } from './LeaderGrid';
import { CARD_H, CARD_W, ProfileCard, type ProfileCompany } from './ProfileCard';
import { PersonProfile } from './PersonProfile';
import { cn } from '@/lib/cn';
import { EmptyNote, FilterChip, SearchBox, SectionHeader, SourceLink } from './TabKit';
import {
  buildOrgTree,
  countByGroup,
  filterOrgTree,
  matchesQuery,
  type OrgTreeNode,
} from './tabHelpers';

const GROUP_LABEL: Record<OrgNode['group'], string> = {
  exec: 'Executive',
  ai: 'AI & research',
  product: 'Product',
  design: 'Design',
  other: 'Board & other',
};
const GROUP_DOT: Record<OrgNode['group'], string> = {
  exec: 'bg-indigo-500',
  ai: 'bg-cyan-500',
  product: 'bg-emerald-500',
  design: 'bg-pink-500',
  other: 'bg-slate-400',
};

const UNKNOWN = 'Unknown';

function reportedValue(value: string | null | undefined): string {
  return value?.trim() || UNKNOWN;
}

/** One person in the chart: portrait, name, role, provenance, collapse toggle. */
function OrgRow({
  node,
  companyName,
  collapsed,
  forceOpen,
  onToggle,
  onOpen,
}: {
  node: OrgTreeNode;
  companyName: string;
  collapsed: Set<string>;
  forceOpen: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const p = node.person;
  const hasKids = node.children.length > 0;
  const isOpen = forceOpen || !collapsed.has(p.id);
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
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-content">{p.name}</span>
              <span
                className={cn('h-1.5 w-1.5 shrink-0 rounded-full', GROUP_DOT[p.group])}
                title={GROUP_LABEL[p.group]}
                aria-hidden
              />
            </span>
            <span className="block truncate text-xs text-muted">{p.role || 'Role not reported'}</span>
            {(p.tenure || p.priorCompany) && (
              <span className="mt-0.5 block truncate text-[11px] text-faint">
                {[p.tenure, p.priorCompany ? `ex-${p.priorCompany}` : null].filter(Boolean).join(' · ')}
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
                onToggle={onToggle}
                onOpen={onOpen}
              />
          ))}
        </ul>
      )}
    </li>
  );
}

interface OrgCardData extends Record<string, unknown> {
  person: OrgNode;
  company: ProfileCompany;
  dim: boolean;
  flipped: boolean;
  onFlip: () => void;
  onOpen: () => void;
}

/** A person on the whiteboard: a sports-style profile card that turns over to the basics. */
function OrgCardNode({ data }: NodeProps) {
  const { person, company, dim, flipped, onFlip, onOpen } = data as OrgCardData;
  return (
    <div className="nopan">
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-border" />
      <ProfileCard person={person} company={company} dim={dim} flipped={flipped} onFlip={onFlip} onOpenProfile={onOpen} />
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-border" />
    </div>
  );
}

const NODE_TYPES = { person: OrgCardNode };
const NODE_W = CARD_W;
const GAP_X = 28;
const ROW_H = CARD_H + 64;

/** Tidy tree layout: each subtree is as wide as its leaves; parents centre over children. */
function layoutForest(
  forest: OrgTreeNode[],
  company: ProfileCompany,
  matches: Set<string> | null,
  flipped: ReadonlySet<string>,
  toggleFlip: (id: string) => void,
  onOpen: (id: string) => void,
) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let cursor = 0;
  const place = (n: OrgTreeNode, parentId: string | null): number => {
    let x: number;
    if (n.children.length === 0) {
      x = cursor;
      cursor += NODE_W + GAP_X;
    } else {
      const xs = n.children.map((c) => place(c, n.person.id));
      x = (xs[0]! + xs[xs.length - 1]!) / 2;
    }
    nodes.push({
      id: n.person.id,
      type: 'person',
      position: { x, y: n.depth * ROW_H },
      data: {
        person: n.person,
        company,
        dim: matches ? !matches.has(n.person.id) : false,
        flipped: flipped.has(n.person.id),
        onFlip: () => toggleFlip(n.person.id),
        onOpen: () => onOpen(n.person.id),
      } satisfies OrgCardData,
    });
    if (parentId) {
      edges.push({
        id: `${parentId}->${n.person.id}`,
        source: parentId,
        target: n.person.id,
        type: 'smoothstep',
        style: { stroke: 'rgb(var(--c-border))' },
      });
    }
    return x;
  };
  forest.forEach((r) => place(r, null));
  return { nodes, edges };
}

/** The reporting-lines graph: pan/zoom, fit to view, filter dims non-matches. */
function OrgChart({
  forest,
  company,
  matches,
  onOpen,
}: {
  forest: OrgTreeNode[];
  company: ProfileCompany;
  matches: Set<string> | null;
  onOpen: (id: string) => void;
}) {
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const toggleFlip = (id: string) => setFlipped((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const graph = useMemo(
    () => layoutForest(forest, company, matches, flipped, toggleFlip, onOpen),
    // toggleFlip only closes over a state setter
    [forest, company, matches, flipped, onOpen],
  );
  return (
    <div className="panel h-[680px] overflow-hidden bg-[radial-gradient(circle_at_1px_1px,rgb(var(--c-border))_1px,transparent_0)] [background-size:22px_22px]" aria-label="Org whiteboard">
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background color="rgb(var(--c-border))" gap={22} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

const VIEW_KEY = 'mi.teamOrgView';
function readView(): 'chart' | 'list' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'chart';
  } catch {
    return 'chart';
  }
}

export function TeamOrgTab({ companyId }: { companyId: string }) {
  const [view, setViewState] = useState<'chart' | 'list'>(readView);
  const setView = (v: 'chart' | 'list') => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* storage unavailable: the choice just will not persist */
    }
  };
  const query = useDashboardTab(companyId, 'team_org');
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
  const [group, setGroup] = useState<OrgNode['group'] | 'all'>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const orgReport = useGenerateReport();
  const navigate = useNavigate();

  const nodes = query.data?.content.nodes;
  const forest = useMemo(() => buildOrgTree(nodes ?? []), [nodes]);
  const counts = useMemo(() => countByGroup(nodes ?? []), [nodes]);
  const filtering = search.trim().length > 0 || group !== 'all';
  const visible = useMemo(
    () =>
      filtering
        ? filterOrgTree(
            forest,
            (p) =>
              (group === 'all' || p.group === group) &&
              matchesQuery(`${p.name} ${p.role} ${p.priorCompany ?? ''} ${p.notableProject ?? ''}`, search),
          )
        : forest,
    [forest, filtering, group, search],
  );
  // Chart view dims non-matches (keeps the whole structure visible) instead of pruning.
  const matches = useMemo(() => {
    if (!filtering) return null;
    const ids = new Set<string>();
    for (const p of nodes ?? []) {
      if (
        (group === 'all' || p.group === group) &&
        matchesQuery(`${p.name} ${p.role} ${p.priorCompany ?? ''} ${p.notableProject ?? ''}`, search)
      ) ids.add(p.id);
    }
    return ids;
  }, [nodes, filtering, group, search]);
  const parents = useMemo(() => {
    const ids: string[] = [];
    const walk = (n: OrgTreeNode) => {
      if (n.children.length) ids.push(n.person.id);
      n.children.forEach(walk);
    };
    forest.forEach(walk);
    return ids;
  }, [forest]);
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const flat = forest.length > 0 && forest.every((r) => r.children.length === 0);

  return (
    <QueryBoundary
      query={query}
      loading={<HydratingPanel label="Team & Org" />}
      isEmpty={(r) => r.content.nodes.length === 0}
      empty={() => (
        <EmptyNote title="No leadership surfaced yet">
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
        return (
          <div className="cascade">
            <SectionHeader
              title="Team & organization"
              count={`${total} ${total === 1 ? 'person' : 'people'}`}
              description={
                flat
                  ? 'Named leadership. No reporting lines were sourced, so people are listed rather than charted. Select a person for background and sources.'
                  : 'Who reports to whom, as reported by sources. Select a person for background and sources. Switch to List to collapse branches.'
              }
              actions={
                // The org-chart teardown: a report researched specifically about
                // how this team is set up.
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
              }
            />

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <SearchBox
                value={search}
                onChange={setSearch}
                label="Search people"
                placeholder="Search name, role, prior company"
                className="w-full sm:w-64"
              />
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by function">
                <FilterChip active={group === 'all'} onClick={() => setGroup('all')} count={total}>
                  All
                </FilterChip>
                {(Object.keys(GROUP_LABEL) as OrgNode['group'][])
                  .filter((g) => counts[g] > 0)
                  .map((g) => (
                    <FilterChip key={g} active={group === g} onClick={() => setGroup(g)} count={counts[g]}>
                      <span className={cn('h-1.5 w-1.5 rounded-full', GROUP_DOT[g])} aria-hidden />
                      {GROUP_LABEL[g]}
                    </FilterChip>
                  ))}
              </div>
              {!flat && (
                <div className="ml-auto inline-flex rounded-lg border border-border bg-surface-2/60 p-0.5" role="group" aria-label="View">
                  {(['chart', 'list'] as const).map((v) => (
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
              )}
              {view === 'list' && !flat && parents.length > 0 && !filtering && (
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

            {!flat && view === 'chart' ? (
              <div className="space-y-4">
                {/* The human layer: framed portraits, hover profiles, click-through research. */}
                <LeaderGrid nodes={result.content.nodes} companyName={name} onOpenPerson={setSelectedPersonId} />
                {matches && matches.size === 0 && (
                  <EmptyNote compact title="No one matches these filters">
                    Clear the search or choose All to see everyone research has surfaced.
                  </EmptyNote>
                )}
                <OrgChart forest={forest} company={profileCompany} matches={matches} onOpen={setSelectedPersonId} />
              </div>
            ) : visible.length === 0 ? (
              <EmptyNote compact title="No one matches these filters">
                Clear the search or choose All to see everyone research has surfaced.
              </EmptyNote>
            ) : (
              <ul className={cn(flat ? 'grid gap-2 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-2')}>
                {visible.map((root) => (
                  <OrgRow
                    key={root.person.id}
                    node={root}
                    companyName={name}
                    collapsed={collapsed}
                    forceOpen={filtering}
                    onToggle={toggle}
                    onOpen={setSelectedPersonId}
                  />
                ))}
              </ul>
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
                  onAsk={(person) => {
                    const pinnedContext = [
                      `Name: ${person.name}`,
                      `Role: ${person.role}`,
                      `Company: ${name}`,
                      `Tenure: ${reportedValue(person.tenure)}`,
                      `Prior company: ${reportedValue(person.priorCompany)}`,
                      `Notable project: ${reportedValue(person.notableProject)}`,
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
