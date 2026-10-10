import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Product, RoadmapItem } from '@mi/contracts';
import { useCompany, useDashboardTab } from '@/hooks/data';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { HydratingPanel } from './HydratingPanel';
import { AiCover } from '@/components/media/AiCover';
import { Modal } from '@/components/ui/Modal';
import { InsightReader } from '@/components/reader/InsightReader';
import { DigDeeper, DigDeeperMenu } from '@/features/deepdive/DeepDive';
import { cn } from '@/lib/cn';
import { EmptyNote, FilterChip, SearchBox, SectionHeader } from './TabKit';
import { classifyEvent, hostOf, matchesQuery } from './tabHelpers';
import { parseOverviewSections } from '../dashboardModel';
import { useCachedDashboardTab } from '../useCachedTab';
import { Paragraph } from './OverviewTab';

const STATUS_STYLE: Record<Product['status'], string> = {
  live: 'border-emerald-300 text-emerald-700 bg-emerald-50',
  beta: 'border-amber-300 text-amber-700 bg-amber-50',
  sunset: 'border-slate-300 text-slate-600 bg-slate-100',
};

/**
 * Quiet horizon columns (audit: the loud tinted headers read "vibe code-y").
 * The colored DOT carries each horizon's identity; headers stay neutral.
 */
const HORIZONS: {
  key: RoadmapItem['horizon'];
  label: string;
  accent: string;
  dot: string;
}[] = [
  { key: 'now', label: 'Now', accent: 'text-content border-border bg-surface-2/60', dot: 'bg-emerald-500' },
  { key: 'next', label: 'Next', accent: 'text-content border-border bg-surface-2/60', dot: 'bg-amber-500' },
  { key: 'later', label: 'Later', accent: 'text-muted border-border bg-surface-2/60', dot: 'bg-slate-400' },
];

/** The product, opened like a newsletter feature: capture, paragraph, link. */
function ProductReader({
  product,
  companyId,
  companyName,
  onClose,
}: {
  product: Product;
  companyId: string;
  companyName: string;
  onClose: () => void;
}) {
  const hasUrl = !!product.url && /^https?:\/\//.test(product.url);
  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={product.name}
      description={`${companyName} · ${product.status}`}
    >
      <div className="space-y-4">
        {/* The card art: a generated illustration of the product experience,
            prompted from the research (page captures kept hitting bot walls —
            a CAPTCHA is not product art). */}
        <div className="h-[200px] overflow-hidden rounded-xl border border-border">
          <AiCover
            cacheKey={`product:${companyName}:${product.name}`}
            title={`${companyName} — ${product.name}`}
            context={`Product card art. ${product.description} Depict the essence of using this product — the experience, the interface mood, the domain — as premium collectible-card artwork.`}
            url={product.url ?? ''}
            source="news"
          />
        </div>
        <p className="text-sm leading-relaxed text-content/90">{product.description}</p>
        {product.revenueNote && (
          <p className="rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-[12px] text-muted">
            <span className="font-semibold text-content">Reported revenue role:</span>{' '}
            {product.revenueNote}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          {hasUrl ? (
            <a href={product.url!} target="_blank" rel="noopener noreferrer" className="btn-primary">
              <ExternalLink className="h-4 w-4" />
              Open official source
            </a>
          ) : (
            <span className="text-[11px] text-faint">No official page surfaced yet.</span>
          )}
          <DigDeeper
            topic={`${product.name} — product deep dive`}
            companyId={companyId}
            companyName={companyName}
            context={`${companyName}'s product "${product.name}": ${product.description}. Research its positioning, pricing, adoption, and how it fits the company's strategy — grounded and current.`}
            label="Research this product"
          />
        </div>
      </div>
    </Modal>
  );
}

const STATUS_LABEL: Record<Product['status'], string> = {
  live: 'Live',
  beta: 'Beta',
  sunset: 'Sunset',
};

/**
 * When no product passed the strict lineup bar, the research the company
 * already has still says what it sells: the brief's own products section
 * (with its source chips) and the dated launches from the timeline. Nothing
 * new is generated; both are reused verbatim from cached, sourced tabs.
 */
function ProductsFromResearch({ companyId }: { companyId: string }) {
  const overview = useCachedDashboardTab(companyId, 'overview').data;
  const history = useCachedDashboardTab(companyId, 'history').data;
  const brief = overview
    ? parseOverviewSections(overview.content.markdown).sections.find((s) => /products?\b/i.test(s.title))
    : undefined;
  const blocks = brief ? brief.body.split('\n\n').map((b) => b.trim()).filter(Boolean).slice(0, 3) : [];
  const launches = (history?.content.timeline ?? [])
    .filter((t) => classifyEvent(t.title, t.detail) === 'product')
    .slice(-6)
    .reverse();
  if (blocks.length === 0 && launches.length === 0) return null;
  return (
    <div className="panel mt-3 space-y-4 p-5">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">From this company's research brief</p>
      {blocks.length > 0 && (
        <div className="max-w-[72ch] space-y-3">
          {blocks.map((block, i) => <Paragraph key={i} block={block} />)}
        </div>
      )}
      {launches.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">Product milestones</p>
          <ol className="space-y-1.5 border-l border-border pl-3">
            {launches.map((e, i) => (
              <li key={i} className="relative text-[13px] leading-snug">
                <span className="absolute -left-[16.5px] top-1.5 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                <span className="tabular-nums text-faint">{e.date}</span>
                <span className="font-medium text-content"> {e.title}</span>
                {e.detail && <span className="block text-[12.5px] text-muted">{e.detail}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

export function ProductsRoadmapTab({ companyId }: { companyId: string }) {
  const query = useDashboardTab(companyId, 'products_roadmap');
  const name = useCompany(companyId).data?.name ?? 'this company';
  const [openProduct, setOpenProduct] = useState<Product | null>(null);
  const [openRoadmap, setOpenRoadmap] = useState<RoadmapItem | null>(null);
  const [status, setStatus] = useState<Product['status'] | 'all'>('all');
  const [search, setSearch] = useState('');
  return (
    <QueryBoundary query={query} loading={<HydratingPanel label="Products & Roadmap" />}>
      {(result) => {
        const c = result.content;
        const statusCounts = c.products.reduce<Partial<Record<Product['status'], number>>>((acc, p) => {
          acc[p.status] = (acc[p.status] ?? 0) + 1;
          return acc;
        }, {});
        const products = c.products.filter(
          (p) =>
            (status === 'all' || p.status === status) &&
            matchesQuery(`${p.name} ${p.description} ${p.revenueNote}`, search),
        );
        return (
          <div className="space-y-8 cascade">
            <section aria-label="Product lineup">
              <SectionHeader
                title="Product lineup"
                count={c.products.length > 0 ? c.products.length : undefined}
                description={
                  c.products.length
                    ? 'Company-reported product disclosures, not a revenue ranking. Revenue contribution is not established.'
                    : (result.lastRefreshedAt
                      ? `Last researched ${new Date(result.lastRefreshedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}.`
                      : 'No original-backed product details are available yet. Refresh research to check official sources; earlier notes remain saved.')
                }
                actions={
                  <DigDeeperMenu
                    topics={['Product strategy & pricing', 'Roadmap & upcoming launches']}
                    companyId={companyId}
                    companyName={name}
                  />
                }
              />
              {c.products.length === 0 ? (
                <>
                  <EmptyNote compact title="No product lineup confirmed yet">
                    Named products with a lifecycle status (live, beta, sunset) appear once research
                    finds an official page or filing that describes them.
                  </EmptyNote>
                  <ProductsFromResearch companyId={companyId} />
                </>
              ) : (
                <>
                  {(c.products.length > 3 || Object.keys(statusCounts).length > 1) && (
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      {c.products.length > 8 && (
                        <SearchBox
                          value={search}
                          onChange={setSearch}
                          label="Search products"
                          placeholder="Search products"
                          className="w-full sm:w-56"
                        />
                      )}
                      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status">
                        <FilterChip active={status === 'all'} onClick={() => setStatus('all')} count={c.products.length}>
                          All
                        </FilterChip>
                        {(['live', 'beta', 'sunset'] as const)
                          .filter((s) => (statusCounts[s] ?? 0) > 0)
                          .map((s) => (
                            <FilterChip key={s} active={status === s} onClick={() => setStatus(s)} count={statusCounts[s]}>
                              {STATUS_LABEL[s]}
                            </FilterChip>
                          ))}
                      </div>
                    </div>
                  )}
                  {products.length === 0 ? (
                    <EmptyNote compact title="No products match these filters">
                      Clear the search or choose All.
                    </EmptyNote>
                  ) : (
                    <ul className={cn('grid gap-3', products.length > 1 && 'md:grid-cols-2')}>
                      {products.map((p) => {
                        const hasUrl = !!p.url && /^https?:\/\//.test(p.url);
                        return (
                          <li
                            key={p.name}
                            className="panel group flex cursor-pointer flex-col overflow-hidden transition-colors hover:border-primary/40"
                            onClick={() => setOpenProduct(p)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setOpenProduct(p);
                              }
                            }}
                            title="Open this product — source disclosure and research"
                          >
                            {/* The card art, in miniature — generated, never a CAPTCHA. */}
                            <span className="block h-[110px] overflow-hidden border-b border-border">
                              <AiCover
                                cacheKey={`product:${name}:${p.name}`}
                                title={`${name} — ${p.name}`}
                                context={`Product card art. ${p.description} Depict the essence of using this product — the experience, the interface mood, the domain — as premium collectible-card artwork.`}
                                url={p.url ?? ''}
                                source="news"
                                compact
                              />
                            </span>
                            <div className="flex flex-1 flex-col p-4">
                              <div className="flex items-start justify-between gap-2">
                                <h4 className="font-medium text-content">{p.name}</h4>
                                <span className={cn('chip shrink-0 py-0.5 text-[11px]', STATUS_STYLE[p.status])}>
                                  {STATUS_LABEL[p.status]}
                                </span>
                              </div>
                              {p.description ? (
                                <p className="mt-1.5 line-clamp-3 text-sm text-muted">{p.description}</p>
                              ) : (
                                <p className="mt-1.5 text-sm text-faint">No description retained.</p>
                              )}
                              <div className="mt-auto flex items-end justify-between gap-3 pt-3">
                                <span
                                  className="min-w-0 text-[11px] text-muted"
                                  title="What sources report about revenue contribution"
                                >
                                  {p.revenueNote ? (
                                    <span className="line-clamp-2">{p.revenueNote}</span>
                                  ) : (
                                    <span className="text-faint">Revenue role not disclosed</span>
                                  )}
                                </span>
                                {hasUrl && (
                                  <a
                                    href={p.url!}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex shrink-0 items-center gap-1 text-[11px] text-primary-ink hover:underline"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    {hostOf(p.url!) ?? 'Source'}
                                  </a>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </section>

            <section aria-label="Roadmap">
              <SectionHeader
                title="Roadmap"
                count={c.roadmap.length > 0 ? c.roadmap.length : undefined}
                description="Announced or reported plans grouped by horizon. Dates appear only when a source gave one."
              />
              {c.roadmap.length === 0 ? (
                <EmptyNote compact title="No source-backed roadmap retained">
                  Research fills this from official announcements, earnings commentary and filings.
                  Rumours and guesses are not retained.
                </EmptyNote>
              ) : (
                <div className="grid gap-3 md:grid-cols-3">
                  {HORIZONS.map(({ key, label, dot }) => {
                    const items = c.roadmap.filter((r) => r.horizon === key);
                    return (
                      <div key={key} className="panel overflow-hidden p-0">
                        <div className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-content">
                          <span className={cn('h-2 w-2 rounded-full', dot)} />
                          {label}
                          <span className="ml-1.5 font-normal normal-case tabular-nums text-muted">{items.length}</span>
                        </div>
                        <ul className="px-4 py-3">
                          {items.map((r, i) => (
                            <li key={i} className="relative pb-3 pl-5 last:pb-0">
                              {/* Timeline spine: dot per item, line connecting them. */}
                              <span className={cn('absolute left-0 top-1.5 h-2 w-2 rounded-full', dot)} />
                              {i < items.length - 1 && (
                                <span className="absolute bottom-0 left-[3.5px] top-4 w-px bg-border" />
                              )}
                              <button
                                type="button"
                                className="w-full rounded-md text-left transition-colors hover:bg-surface-2/70"
                                title="Open this roadmap item — the full gist, plus grounded research"
                                onClick={() => setOpenRoadmap(r)}
                              >
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="text-sm font-medium text-content">{r.title}</span>
                                  {r.date && (
                                    <span className="shrink-0 text-[10px] font-semibold tabular-nums text-primary-ink">
                                      {r.date}
                                    </span>
                                  )}
                                </div>
                                <div className="line-clamp-2 text-xs text-muted">{r.detail}</div>
                              </button>
                            </li>
                          ))}
                          {items.length === 0 && (
                            <li className="py-1 text-xs text-faint">Nothing source-backed for this horizon.</li>
                          )}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {openProduct && (
              <ProductReader
                product={openProduct}
                companyId={companyId}
                companyName={name}
                onClose={() => setOpenProduct(null)}
              />
            )}
            {openRoadmap && (
              <InsightReader
                open
                onClose={() => setOpenRoadmap(null)}
                tone="roadmap"
                title={openRoadmap.title}
                date={openRoadmap.date ?? null}
                body={openRoadmap.detail ?? null}
                companyId={companyId}
                companyName={name}
                researchSeed={`${name}'s announced roadmap item: "${openRoadmap.title}"${openRoadmap.date ? ` (${openRoadmap.date})` : ''}. Research the full story with grounded sources: what exactly was announced, by whom, the timeline, and what it signals about their strategy.`}
              />
            )}
          </div>
        );
      }}
    </QueryBoundary>
  );
}
