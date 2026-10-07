import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Loader2 } from 'lucide-react';
import { ReactFlow, Background, Controls, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { OrgNode } from '@mi/contracts';
import { useCompany, useDashboardTab, useGenerateReport } from '@/hooks/data';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { Modal } from '@/components/ui/Modal';
import { useDeepDive } from '@/features/deepdive/DeepDive';
import { LeaderGrid } from './LeaderGrid';
import { UnknownInline } from '@/features/card/UnknownValue';

const GROUP_COLOR: Record<OrgNode['group'], string> = {
  exec: '#6366f1',
  ai: '#06b6d4',
  product: '#10b981',
  design: '#ec4899',
  other: '#64748b',
};

/** Simple layered tree layout: depth (distance from a root) → row, siblings spread across columns. */
function layout(nodes: OrgNode[]): { rfNodes: Node[]; rfEdges: Edge[] } {
  const depthOf = new Map<string, number>();
  const resolveDepth = (n: OrgNode): number => {
    if (depthOf.has(n.id)) return depthOf.get(n.id)!;
    if (!n.parentId) {
      depthOf.set(n.id, 0);
      return 0;
    }
    const parent = nodes.find((x) => x.id === n.parentId);
    const d = parent ? resolveDepth(parent) + 1 : 0;
    depthOf.set(n.id, d);
    return d;
  };
  nodes.forEach(resolveDepth);

  const perDepthCount = new Map<number, number>();
  const rfNodes: Node[] = nodes.map((n) => {
    const d = depthOf.get(n.id) ?? 0;
    const col = perDepthCount.get(d) ?? 0;
    perDepthCount.set(d, col + 1);
    return {
      id: n.id,
      position: { x: col * 220 + (d % 2) * 40, y: d * 130 },
      // Hover → the sourced bio (native tooltip); click → the person detail card.
      data: {
        label: (
          <span title={n.bio || `${n.name} — click for person details`}>
            {n.name} · {n.role}
          </span>
        ),
      },
      style: {
        background: '#ffffff',
        color: '#18181B',
        border: `2px solid ${GROUP_COLOR[n.group]}`,
        borderRadius: 10,
        fontSize: 12,
        padding: 8,
        width: 190,
        boxShadow: '0 1px 2px rgba(17,17,26,0.06)',
        cursor: 'pointer',
      },
    };
  });

  const rfEdges: Edge[] = nodes
    .filter((n) => n.parentId)
    .map((n) => ({
      id: `${n.parentId}->${n.id}`,
      source: n.parentId as string,
      target: n.id,
      style: { stroke: '#D8D7D2' },
      animated: false,
    }));

  return { rfNodes, rfEdges };
}

const UNKNOWN = 'Unknown';

function reportedValue(value: string | null | undefined): string {
  return value?.trim() || UNKNOWN;
}

function PersonDetail({
  person,
  companyName,
  onDigDeeper,
}: {
  person: OrgNode;
  companyName: string;
  onDigDeeper: () => void;
}) {
  const details = [
    ['Tenure', person.tenure],
    ['Prior company', person.priorCompany],
    ['Notable project', person.notableProject],
  ] as const;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 font-display text-lg font-semibold text-primary-ink">
          {person.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-content">{person.role}</p>
          <p className="mt-1 text-xs text-muted">
            Company context: <span className="font-medium text-content">{companyName}</span>
          </p>
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        {details.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border bg-surface-2/60 px-3 py-2.5">
            <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              {label}
            </dt>
            <dd className="mt-1 text-sm text-content">
              {reportedValue(value) === UNKNOWN ? <UnknownInline /> : reportedValue(value)}
            </dd>
          </div>
        ))}
      </dl>

      <div>
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          Reported background
        </h3>
        {reportedValue(person.bio) === UNKNOWN ? (
          <p className="mt-2"><UnknownInline /></p>
        ) : (
          <p className="mt-2 text-sm leading-relaxed text-content/90">{reportedValue(person.bio)}</p>
        )}
      </div>

      {person.sourceUrl && person.supportingQuote && (
        <div className="rounded-lg border border-border bg-surface-2/60 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Reported source{person.sourceRetrievedAt ? ` · retrieved ${person.sourceRetrievedAt.slice(0, 10)}` : ''}
            </h3>
            <a href={person.sourceUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary-ink hover:underline">
              Open original ↗
            </a>
          </div>
          <blockquote className="mt-2 border-l-2 border-primary/40 pl-3 text-sm leading-relaxed text-content/90">
            “{person.supportingQuote}”
          </blockquote>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="max-w-xs text-[11px] leading-relaxed text-faint">
          Unknown means the current research did not surface a credible detail; it is not an
          inference.
        </p>
        <button type="button" className="btn-primary shrink-0" onClick={onDigDeeper}>
          Ask about them
        </button>
      </div>
    </div>
  );
}

export function TeamOrgTab({ companyId }: { companyId: string }) {
  const query = useDashboardTab(companyId, 'team_org');
  const graph = useMemo(() => layout(query.data?.content.nodes ?? []), [query.data]);
  const name = useCompany(companyId).data?.name ?? 'this company';
  const { chat } = useDeepDive();
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const orgReport = useGenerateReport();
  const navigate = useNavigate();

  return (
    <QueryBoundary query={query} isEmpty={(r) => r.content.nodes.length === 0}>
      {(result) => (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              Exec, AI, product, and design leadership. Hover a portrait for their background;
              click for the full profile. The chart below maps who reports to whom.
            </p>
            {/* The org-chart teardown: a report researched specifically about
                how this team is set up — competitive-analysis gold. */}
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
          </div>
          {/* The human layer: framed portraits, hover profiles, click-through research. */}
          <LeaderGrid
            nodes={result.content.nodes}
            companyName={name}
            onOpenPerson={setSelectedPersonId}
          />

          <div className="panel h-[520px] overflow-hidden">
            <ReactFlow
              nodes={graph.rfNodes}
              edges={graph.rfEdges}
              fitView
              proOptions={{ hideAttribution: true }}
              nodesDraggable
              nodesConnectable={false}
              onNodeClick={(_, node) => {
                const person = result.content.nodes.find((n) => n.id === node.id);
                if (person) setSelectedPersonId(person.id);
              }}
            >
              <Background color="#E5E3DD" gap={20} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          {selectedPersonId !== null &&
            (() => {
              const person = result.content.nodes.find((n) => n.id === selectedPersonId);
              if (!person) return null;
              return (
                <Modal
                  open
                  onOpenChange={(open) => {
                    if (!open) setSelectedPersonId(null);
                  }}
                  title={person.name}
                  description={person.role}
                >
                  <PersonDetail
                    person={person}
                    companyName={name}
                    onDigDeeper={() => {
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
              );
            })()}
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
            {Object.entries(GROUP_COLOR).map(([group, color]) => (
              <span key={group} className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm" style={{ background: color }} />
                {group}
              </span>
            ))}
          </div>
        </div>
      )}
    </QueryBoundary>
  );
}
