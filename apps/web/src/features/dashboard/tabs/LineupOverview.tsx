/**
 * The top of the Products & Roadmap report: how much of the lineup is established,
 * the split by lifecycle status, what changed lately on these products, and the one
 * bounded action that researches the lead products. Every count comes from retained,
 * sourced research; a status no source states is counted as "not stated", never guessed.
 */
import { Loader2, Search } from 'lucide-react';
import type { LiveIntelItem, Product, ProductBrief, RoadmapItem } from '@mi/contracts';
import { SafeLink } from '@/components/SafeLink';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { publisherOf } from '@mi/contracts';
import { TOP_PRODUCTS, lineupCounts, recentChanges } from '../productsReport';
import type { ProductsReportData } from '../useProductsReportData';

const BAR: Array<{ key: 'live' | 'beta' | 'sunset' | 'unstated'; label: string; fill: string }> = [
  { key: 'live', label: 'live', fill: 'bg-emerald-500' },
  { key: 'beta', label: 'beta', fill: 'bg-amber-500' },
  { key: 'sunset', label: 'sunset', fill: 'bg-slate-400' },
  { key: 'unstated', label: 'status not stated', fill: 'bg-border' },
];

export function LineupOverview({ products, roadmap, partners, statedOn, data }: {
  products: readonly Product[];
  roadmap: readonly RoadmapItem[];
  partners: number;
  statedOn: string | null;
  data: Pick<ProductsReportData, 'briefs' | 'intel' | 'canResearch' | 'bulk'>;
}) {
  if (products.length + roadmap.length + partners === 0) return null;
  const counts = lineupCounts(products, roadmap, data.briefs as ReadonlyMap<string, ProductBrief>);
  const changes = recentChanges(products, data.briefs as ReadonlyMap<string, ProductBrief>, data.intel as readonly LiveIntelItem[]);
  const stats: Array<{ label: string; value: number; note: string | null }> = [
    { label: 'Products', value: counts.total, note: [counts.live > 0 && `${counts.live} live`, counts.beta > 0 && `${counts.beta} beta`].filter(Boolean).join(' · ') || null },
    { label: 'Roadmap items', value: roadmap.length, note: roadmap.length ? `${counts.now} now · ${counts.next} next · ${counts.later} later` : null },
    { label: 'Named partners', value: partners, note: partners ? 'customers, suppliers, partners' : null },
  ];
  const { bulk } = data;
  const lead = products.slice(0, TOP_PRODUCTS).map((p) => p.name);
  return (
    <div className="space-y-4">
      <section aria-label="Lineup at a glance">
        <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border bg-border">
          {stats.map((stat) => (
            <div key={stat.label} className="bg-surface px-4 py-3">
              <dt className="text-[11px] font-medium text-muted">{stat.label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-content">
                {stat.value > 0 ? stat.value : <span className="text-base font-medium text-faint">None found</span>}
                {stat.note && <span className="mt-0.5 block text-[11px] font-normal text-faint">{stat.note}</span>}
              </dd>
            </div>
          ))}
        </dl>
        {counts.total > 0 && (
          <div className="mt-3">
            <div className="flex h-2 overflow-hidden rounded-full bg-border" role="img"
              aria-label={BAR.filter((b) => counts[b.key] > 0).map((b) => `${counts[b.key]} ${b.label}`).join(', ')}>
              {BAR.map((b) => counts[b.key] > 0 && <span key={b.key} className={cn('h-full', b.fill)} style={{ width: `${(counts[b.key] / counts.total) * 100}%` }} />)}
            </div>
            <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
              {BAR.filter((b) => counts[b.key] > 0).map((b) => (
                <span key={b.key} className="inline-flex items-center gap-1.5">
                  <span className={cn('h-2 w-2 rounded-full', b.fill)} aria-hidden />{counts[b.key]} {b.label}
                </span>
              ))}
              <span className="text-faint">· {counts.researched} of {counts.total} researched in depth</span>
            </p>
          </div>
        )}
        {statedOn && <p className="mt-1.5 text-[11px] text-faint">Researched {statedOn}. Counts include only what a source states.</p>}
      </section>

      {counts.total > 0 && (
        <section aria-label="Latest on these products" className="grid gap-4 md:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="panel p-4">
            <h4 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">Latest on these products</h4>
            {changes.length > 0 ? (
              <ul className="space-y-2.5">
                {changes.map((c) => (
                  <li key={c.url} className="text-[13px] leading-snug">
                    <SafeLink href={c.url} className="font-medium text-content hover:text-primary-ink hover:underline">{c.title}</SafeLink>
                    <span className="block text-[11px] text-faint">
                      {[c.product, c.publisher ?? publisherOf(c.url, null), formatDate(c.at)].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">
                No dated story naming a product is stored yet. {data.canResearch ? 'Researching a product searches its news.' : 'Product news needs a research key.'}
              </p>
            )}
          </div>
          {data.canResearch && (
            <div className="panel flex flex-col gap-2 p-4">
              <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">Go deeper</h4>
              <p className="text-[12.5px] leading-snug text-muted">
                {lead.length > 0 ? `One click researches the lead products (${lead.join(', ')}): brief, news and videos. The rest are researched from their own page. Results are cached.` : 'Research a product from its page.'}
              </p>
              <button type="button" className="btn-ghost mt-auto justify-center" disabled={bulk.pending || bulk.remaining === 0} onClick={bulk.run}>
                {bulk.pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {bulk.pending && bulk.progress ? `Researching ${Math.min(bulk.progress.done + 1, bulk.progress.total)} of ${bulk.progress.total}…` : bulk.remaining === 0 ? 'Top products researched' : 'Research top products'}
              </button>
              {bulk.failed > 0 && !bulk.pending && <p role="alert" className="text-[11px] text-negative">{bulk.failed} could not be researched. Try again or open the product.</p>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
