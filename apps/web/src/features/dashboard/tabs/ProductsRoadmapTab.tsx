import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Product, RoadmapItem } from '@mi/contracts';
import { useCompany, useDashboardTab } from '@/hooks/data';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { Modal } from '@/components/ui/Modal';
import { InsightReader } from '@/components/reader/InsightReader';
import { DigDeeper, DigDeeperMenu } from '@/features/deepdive/DeepDive';
import { cn } from '@/lib/cn';

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
  {
    key: 'now',
    label: 'Now',
    accent: 'text-content border-border bg-surface-2/60',
    dot: 'bg-emerald-500',
  },
  {
    key: 'next',
    label: 'Next',
    accent: 'text-content border-border bg-surface-2/60',
    dot: 'bg-amber-500',
  },
  {
    key: 'later',
    label: 'Later',
    accent: 'text-muted border-border bg-surface-2/60',
    dot: 'bg-slate-400',
  },
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
        <p className="text-sm leading-relaxed text-content/90">{product.description}</p>
        {product.revenueNote && (
          <p className="rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-[12px] text-muted">
            <span className="font-semibold text-content">Reported revenue role:</span>{' '}
            {product.revenueNote}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          {hasUrl ? (
            <a
              href={product.url!}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary"
            >
              <ExternalLink className="h-4 w-4" />
              Open the product
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

export function ProductsRoadmapTab({ companyId }: { companyId: string }) {
  const query = useDashboardTab(companyId, 'products_roadmap');
  const name = useCompany(companyId).data?.name ?? 'this company';
  const [openProduct, setOpenProduct] = useState<Product | null>(null);
  const [openRoadmap, setOpenRoadmap] = useState<RoadmapItem | null>(null);
  return (
    <QueryBoundary query={query}>
      {(result) => {
        const c = result.content;
        return (
          <div className="space-y-6">
            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-sm font-semibold text-content">
                    Product lineup
                  </h3>
                  <p className="text-xs text-muted">
                    Ranked by reported revenue contribution — breadwinners first, loss-leaders last.
                    Ranking follows what sources actually say; “not disclosed” stays honest.
                  </p>
                </div>
                <DigDeeperMenu
                  topics={['Product strategy & pricing', 'Roadmap & upcoming launches']}
                  companyId={companyId}
                  companyName={name}
                />
              </div>
              <ol className="space-y-2.5">
                {c.products.map((p, i) => {
                  const hasUrl = !!p.url && /^https?:\/\//.test(p.url);
                  return (
                    <li
                      key={p.name}
                      className="panel flex cursor-pointer items-start gap-3.5 p-4 transition-all hover:-translate-y-px hover:shadow-card-hover"
                      onClick={() => setOpenProduct(p)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setOpenProduct(p);
                        }
                      }}
                      title="Open this product — capture, full description, research"
                    >
                      <span
                        className={cn(
                          'mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg font-display text-sm font-bold',
                          i === 0
                            ? 'bg-primary text-white'
                            : 'border border-border bg-surface-2 text-muted',
                        )}
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-medium text-content">{p.name}</h4>
                          <span className={cn('chip capitalize', STATUS_STYLE[p.status])}>
                            {p.status}
                          </span>
                          {p.revenueNote && (
                            <span
                              className="chip border-border bg-surface-2 text-muted"
                              title="What sources report about revenue contribution"
                            >
                              {p.revenueNote}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-muted">{p.description}</p>
                        {hasUrl && (
                          <a
                            href={p.url!}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-primary-ink hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            {p.url!.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>

            <section>
              <h3 className="mb-3 font-display text-sm font-semibold text-content">Roadmap</h3>
              <div className="grid gap-3 md:grid-cols-3">
                {HORIZONS.map(({ key, label, accent, dot }) => {
                  const items = c.roadmap.filter((r) => r.horizon === key);
                  return (
                    <div key={key} className="panel overflow-hidden p-0">
                      <div
                        className={cn(
                          'flex items-center gap-2 border-b px-4 py-2 text-xs font-semibold uppercase tracking-wide',
                          accent,
                        )}
                      >
                        <span className={cn('h-2 w-2 rounded-full', dot)} />
                        {label}
                        <span className="ml-1.5 font-normal normal-case opacity-70">
                          {items.length} item{items.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <ul className="space-y-0 px-4 py-3">
                        {items.map((r, i) => (
                          <li key={i} className="relative pb-3 pl-5 last:pb-0">
                            {/* Timeline spine: dot per item, line connecting them. */}
                            <span
                              className={cn('absolute left-0 top-1.5 h-2 w-2 rounded-full', dot)}
                            />
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
                                  <span className="shrink-0 text-[10px] font-bold tabular-nums text-primary-ink">
                                    {r.date}
                                  </span>
                                )}
                              </div>
                              <div className="line-clamp-2 text-xs text-muted">{r.detail}</div>
                            </button>
                          </li>
                        ))}
                        {items.length === 0 && (
                          <li className="py-1 text-xs text-faint">
                            Nothing announced for this horizon.
                          </li>
                        )}
                      </ul>
                    </div>
                  );
                })}
              </div>
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
