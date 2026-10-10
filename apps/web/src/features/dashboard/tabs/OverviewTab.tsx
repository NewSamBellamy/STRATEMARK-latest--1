import { ResearchMarkdown } from '@/components/ResearchMarkdown';
import { ConfidenceBadge } from '@/features/card/ConfidenceBadge';
import { ExternalLink, MapPin } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { METRIC_TYPE_LABELS, metricDefinitionLabel } from '@mi/contracts';
import { useCompany, useCompanyMetrics, useDashboardTab } from '@/hooks/data';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { HydratingPanel } from './HydratingPanel';
import { formatMetricValue } from '@/lib/format';
import { METRIC_COLORS } from '@/lib/theme';
import { DigDeeperMenu } from '@/features/deepdive/DeepDive';
import { AiCover } from '@/components/media/AiCover';

/**
 * Overview — the company's front page.
 *
 * The research pipeline emits sections with stable "## " headings (both the
 * live and saved renderers). This tab reads that structure and lays it out the
 * way an analyst reads a company: WHO THEY ARE, WHAT THEY DO, BY THE NUMBERS,
 * then WHAT MATTERS — passages pulled from the deck's own research archive.
 * Cached or unexpected formats fall back to straight markdown rendering.
 */

interface Section { title: string; body: string }

function parseSections(markdown: string): { sections: Section[]; figures: string[] } {
  const lines = markdown.split('\n');
  const sections: Section[] = [];
  let current: Section | null = null;
  const figures: string[] = [];
  let inFigures = false;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      if (current) sections.push(current);
      current = { title: heading[1]!.trim(), body: '' };
      inFigures = false;
      continue;
    }
    const bullet = line.match(/^-\s+(.+)$/);
    // Figure bullets are self-produced: "- Label: value — attribution ([source](url))".
    if (current && bullet && /:\s/.test(bullet[1]!) && /\s—\s/.test(bullet[1]!)) {
      inFigures = true;
      figures.push(bullet[1]!);
      continue;
    }
    if (inFigures && line.trim() === '' && !bullet) continue;
    inFigures = false;
    if (current) current.body += line + '\n';
  }
  if (current) sections.push(current);
  return { sections, figures };
}

const SECTION_LABELS: Record<string, string> = {
  'source-reported background': 'Who they are',
  'products and services': 'What they do',
  'market position': 'Where they stand',
  'customers and distribution': 'How they reach customers',
};

function SectionLabel({ children }: { children: string }) {
  return (
    <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
      {children}
    </h3>
  );
}

function ParagraphBlock({ block }: { block: string }) {
  // Attribution lines are one or more [title](url) tokens joined by ' · '.
  // Consume every fully-link trailing line so multi-source paragraphs get
  // chips instead of orphan links.
  const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
  const links: Array<{ title: string; url: string }> = [];
  while (lines.length) {
    const last = lines[lines.length - 1]!;
    const tokens = [...last.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map(m => ({ title: m[1]!, url: m[2]! }));
    if (!tokens.length) break;
    const remainder = last.replace(/\[[^\]]+\]\([^)]+\)/g, '').replace(/·/g, '').trim();
    if (remainder) break;
    links.unshift(...tokens);
    lines.pop();
  }
  const text = lines.join(' ');
  return (
    <div className="space-y-1.5">
      <ResearchMarkdown text={text} />
      {links.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {links.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-muted hover:text-primary-ink">
              <ExternalLink className="h-3 w-3" />
              {link.title}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionBody({ body }: { body: string }) {
  const blocks = body.split('\n\n').map(chunk => chunk.trim()).filter(Boolean);
  return (
    <div className="space-y-4">
      {blocks.map((block, index) => <ParagraphBlock key={index} block={block} />)}
    </div>
  );
}

/** "- Label: value — attribution ([source](url))" → a clean figure row. */
function FigureRow({ line }: { line: string }) {
  const match = line.match(/^(.+?):\s*(.+?)\s+—\s+(.+)$/);
  if (!match) return <li className="text-sm text-content">{line}</li>;
  const [, label = '', value = '', attribution = ''] = match;
  return (
    <li className="flex items-baseline justify-between gap-4 py-2.5">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-right">
        <span className="font-display text-base font-semibold tabular-nums text-content">{value}</span>
        <span className="block text-xs text-muted"><ResearchMarkdown text={attribution} /></span>
      </span>
    </li>
  );
}

/** WHAT MATTERS — the deck's own archive, retrieved locally (free, no web call). */
function WhatMatters({ companyId }: { companyId: string }) {
  const repo = useRepository();
  const enabled = typeof repo.searchResearchCorpus === 'function';
  const query = useQuery({
    queryKey: ['corpus', 'what-matters', companyId],
    queryFn: async () => (await repo.searchResearchCorpus!({
      query: 'market position competition momentum risks headwinds outlook customers',
      companyIds: [companyId], limit: 3,
    })) ?? [],
    enabled,
    staleTime: 60_000,
  });
  const passages = query.data ?? [];
  if (!enabled || (query.isSuccess && passages.length === 0)) return null;
  return (
    <section aria-label="What matters">
      <SectionLabel>What matters</SectionLabel>
      {query.isLoading && <p className="text-sm text-muted">Searching the research archive…</p>}
      <div className="grid gap-3 md:grid-cols-3">
        {passages.map((passage) => (
          <article key={passage.evidenceId} className="panel-2 p-4">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
              {passage.topic} · {passage.capturedAt.slice(0, 10)}
            </p>
            <p className="text-sm leading-relaxed text-content">{passage.snippet}</p>
            {passage.citations.length > 0 && (
              <p className="mt-2 text-xs text-muted">
                {passage.citations.slice(0, 2).map((citation, index) => (
                  <a key={citation.url ?? index} href={citation.url} target="_blank" rel="noopener noreferrer"
                    className="text-primary-ink hover:underline">
                    {citation.title || citation.url.replace(/^https?:\/\//, '').slice(0, 40)}{index < Math.min(1, passage.citations.length - 1) ? ' · ' : ''}
                  </a>
                ))}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

export function OverviewTab({ companyId }: { companyId: string }) {
  const query = useDashboardTab(companyId, 'overview');
  const company = useCompany(companyId).data;
  const metrics = useCompanyMetrics(companyId).data ?? [];
  const name = company?.name ?? 'this company';

  return (
    <QueryBoundary query={query} loading={<HydratingPanel label="Overview" />}>
      {(result) => {
        const { sections, figures } = parseSections(result.content.markdown);
        const structured = sections.length > 0 || figures.length > 0;
        const background = sections.find(s => /background/i.test(s.title));
        return (
          <div className="grid gap-5 cascade lg:grid-cols-[1fr_300px]">
            <div className="space-y-6">
              {structured ? (
                <>
                  {sections.map((section) => {
                    const label = SECTION_LABELS[section.title.toLowerCase()] ?? section.title;
                    return (
                      <section key={section.title} aria-label={label} className="panel p-6">
                        <SectionLabel>{label}</SectionLabel>
                        <SectionBody body={section.body} />
                      </section>
                    );
                  })}
                  {figures.length > 0 && background && (
                    <section aria-label="By the numbers" className="panel p-6">
                      <SectionLabel>By the numbers</SectionLabel>
                      <ul className="divide-y divide-border">
                        {figures.map((line, index) => <FigureRow key={index} line={line} />)}
                      </ul>
                    </section>
                  )}
                  <WhatMatters companyId={companyId} />
                </>
              ) : (
                <article className="markdown panel p-6">
                  {result.content.markdown.trim()
                    ? <ResearchMarkdown text={result.content.markdown} />
                    : <p className="text-sm text-muted">No overview is available from the saved research yet.</p>}
                </article>
              )}
              <div className="flex justify-end">
                <DigDeeperMenu
                  topics={[
                    'Business model & how they make money',
                    'Competitive landscape & closest rivals',
                    'Risks & headwinds',
                  ]}
                  companyId={companyId}
                  companyName={name}
                />
              </div>
            </div>

            <aside className="space-y-4">
              <div className="panel p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
                  At a glance
                </h3>
                <ul className="space-y-2.5">
                  {metrics.slice(0, 6).map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2 text-muted">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: METRIC_COLORS[m.metricType] }}
                        />
                        {metricDefinitionLabel(m) ?? METRIC_TYPE_LABELS[m.metricType]}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="font-semibold tabular-nums text-content">
                          {formatMetricValue(m.metricType, m.value)}
                        </span>
                        {/* Trust state at a glance: the same badge the metrics
                            tab uses, so an estimate never looks verified. */}
                        <ConfidenceBadge
                          confidence={m.confidence}
                          note={m.methodNote}
                          source={m.source}
                          citations={m.citations}
                          metricLabel={metricDefinitionLabel(m) ?? METRIC_TYPE_LABELS[m.metricType]}
                        />
                      </span>
                    </li>
                  ))}
                  {metrics.length === 0 && (
                    <li className="text-sm text-muted">No quantitative metrics found.</li>
                  )}
                </ul>
              </div>

              {company && (
                <div className="panel space-y-2 p-4 text-sm">
                  {company.hqLocation && (
                    <>
                      <p className="flex items-start gap-2 text-muted">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                        {company.hqLocation}
                      </p>
                      {/* A glimpse of the place — generated from the HQ location
                          itself, so every company's panel carries its city's
                          light (founder's ask: "give people a glimpse of where
                          it's based out of"). */}
                      <div className="h-[110px] overflow-hidden rounded-lg border border-border">
                        <AiCover
                          cacheKey={`hq:${companyId}`}
                          title={`${name} — ${company.hqLocation}`}
                          context={`A cityscape of ${company.hqLocation} that is INSTANTLY RECOGNIZABLE as that specific place: its most famous landmarks, skyline silhouette, geography and light (e.g. San Francisco = Golden Gate Bridge + fog + hills + bay). Concrete and place-specific, never a generic city.`}
                          url={company.websiteUrl ?? ''}
                          source="news"
                          compact
                        />
                      </div>
                    </>
                  )}
                  {company.websiteUrl && (
                    <a
                      href={company.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-primary-ink hover:underline"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {company.websiteUrl.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                </div>
              )}
            </aside>
          </div>
        );
      }}
    </QueryBoundary>
  );
}
