import { useState } from 'react';
import { formatDate } from '@/lib/format';
import { ExternalLink } from 'lucide-react';
import type { BusinessRelationship, Product, RoadmapItem } from '@mi/contracts';
import { useCompany, useDashboardTab } from '@/hooks/data';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { HydratingPanel } from './HydratingPanel';
import { InsightReader } from '@/components/reader/InsightReader';
import { DigDeeperMenu } from '@/features/deepdive/DeepDive';
import { cn } from '@/lib/cn';
import { EmptyNote, FilterChip, SearchBox, SectionHeader } from './TabKit';
import { classifyEvent, hostOf, matchesQuery, splitSearchReport } from './tabHelpers';
import { parseOverviewSections } from '../dashboardModel';
import { useCachedDashboardTab } from '../useCachedTab';
import { Paragraph } from './OverviewTab';
import { ProductPage } from './ProductPage';

/** A product's lifecycle when a source states it; null renders no badge. */
type ProductStatus = NonNullable<Product['status']>;

const STATUS_STYLE: Record<ProductStatus, string> = {
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

const RELATIONSHIP_KINDS: { key: BusinessRelationship['kind']; label: string; dot: string }[] = [
  { key: 'customer', label: 'Customers', dot: 'bg-emerald-500' },
  { key: 'supplier', label: 'Suppliers', dot: 'bg-amber-500' },
  { key: 'partner', label: 'Partners', dot: 'bg-slate-400' },
];

const STATUS_LABEL: Record<ProductStatus, string> = {
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

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const FULL_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * End of the period a stated target covers ("2026-03-15", "March 2026",
 * "Q3 2026", "2026 H2", "2026"), or null when the text is not a date we can
 * read with confidence. Unreadable text is never guessed at.
 */
export function targetEnd(date: string | null | undefined): Date | null {
  const s = (date ?? '').trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
    // A date that rolled over (month 13, Feb 31) was not a real date.
    return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
  }
  m = /^(?:Q([1-4])\s+(\d{4})|(\d{4})\s+Q([1-4]))$/i.exec(s);
  if (m) {
    const q = Number(m[1] ?? m[4]);
    return new Date(Number(m[2] ?? m[3]), q * 3, 0, 23, 59, 59);
  }
  m = /^(?:H([12])\s+(\d{4})|(\d{4})\s+H([12]))$/i.exec(s);
  if (m) {
    const h = Number(m[1] ?? m[4]);
    return new Date(Number(m[2] ?? m[3]), h * 6, 0, 23, 59, 59);
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(s);
  if (m) {
    const word = m[1]!.toLowerCase();
    const mi = MONTHS.findIndex((mo) => word === mo || FULL_MONTHS[MONTHS.indexOf(mo)] === word || (word === 'sept' && mo === 'sep'));
    if (mi >= 0) return new Date(Number(m[2]), mi + 1, 0, 23, 59, 59);
  }
  m = /^(\d{4})$/.exec(s);
  if (m) return new Date(Number(m[1]), 12, 0, 23, 59, 59);
  return null;
}

/** True only when a readable stated target date is already behind us. */
export function isPastDue(date: string | null | undefined, now: Date): boolean {
  const end = targetEnd(date);
  return end !== null && end.getTime() < now.getTime();
}

/** Dense one-line-per-product view: name, description, status, source. */
const hasHttpUrl = (url: string | null | undefined) => !!url && /^https?:\/\//.test(url);

// One column per populated group, never a hollow one; 1-3 columns by count.
const GROUP_COLS: Record<number, string> = { 1: '', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3' };

/** The one status every product shares ("live" for all 21), or null when they differ or any has none. */
export function uniformProductStatus(products: readonly Product[]): ProductStatus | null {
  const first = products[0]?.status;
  return products.length >= 2 && first && products.every((p) => p.status === first) ? first : null;
}

function ProductTable({ products, onOpen, showStatus = true }: { products: Product[]; onOpen: (p: Product) => void; showStatus?: boolean }) {
  // A column that says "Source not recorded" on every row is noise: omit it when no row has a link.
  const showSource = products.some((p) => hasHttpUrl(p.url));
  return (
    <div className="panel overflow-x-auto p-0">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-border bg-surface-2/60 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">
            <th className="px-3 py-2">Product</th>
            <th className="hidden px-3 py-2 md:table-cell">Description</th>
            {showStatus && <th className="px-3 py-2">Status</th>}
            {showSource && <th className="px-3 py-2">Source</th>}
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const hasUrl = !!p.url && /^https?:\/\//.test(p.url);
            const desc = p.description ? splitSearchReport(p.description).text : '';
            return (
              <tr key={p.name} className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-2/50" onClick={() => onOpen(p)}>
                <td className="px-3 py-1.5 font-medium text-content md:whitespace-nowrap">
                  <button type="button" className="text-left" onClick={(e) => { e.stopPropagation(); onOpen(p); }}>{p.name}</button>
                </td>
                <td className="hidden max-w-0 px-3 py-1.5 text-muted md:table-cell md:w-full">
                  <span className="block truncate" title={desc || undefined}>{desc || 'No description retained.'}</span>
                </td>
                {showStatus && (
                <td className="whitespace-nowrap px-3 py-1.5">
                  {p.status ? (
                    <span className={cn('chip py-0.5 text-[11px]', STATUS_STYLE[p.status])}>{STATUS_LABEL[p.status]}</span>
                  ) : (
                    <span className="text-faint">-</span>
                  )}
                </td>
                )}
                {showSource && (
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {hasUrl ? (
                      <a
                        href={p.url!}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-[11px] text-primary-ink hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {hostOf(p.url!) ?? 'Source'}
                      </a>
                    ) : (
                      <span className="text-[11px] text-faint">Source not recorded</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ProductsRoadmapTab({ companyId }: { companyId: string }) {
  const query = useDashboardTab(companyId, 'products_roadmap');
  const companyRecord = useCompany(companyId).data;
  const name = companyRecord?.name ?? 'this company';
  const [openProduct, setOpenProduct] = useState<Product | null>(null);
  const [openRoadmap, setOpenRoadmap] = useState<RoadmapItem | null>(null);
  const [status, setStatus] = useState<ProductStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'cards' | 'table' | null>(null);
  return (
    <QueryBoundary query={query} loading={<HydratingPanel label="Products & Roadmap" />}>
      {(result) => {
        const c = result.content;
        const relationships = c.relationships ?? [];
        const statusCounts = c.products.reduce<Partial<Record<ProductStatus, number>>>((acc, p) => {
          if (p.status) acc[p.status] = (acc[p.status] ?? 0) + 1;
          return acc;
        }, {});
        // Said once in the header when every product has the same status; a pill per item adds nothing then.
        const sharedStatus = uniformProductStatus(c.products);
        // The tab's own recorded research capture date; null stamps nothing.
        const statedOn = result.lastRefreshedAt
          ? formatDate(result.lastRefreshedAt)
          : null;
        // Dense table by default for a long lineup; the reader can switch.
        const anySource = c.products.some((p) => hasHttpUrl(p.url));
        const viewMode = view ?? (c.products.length > 8 ? 'table' : 'cards');
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
                    ? `Company-reported product disclosures, not a revenue ranking. Revenue contribution is not established.${sharedStatus ? ` All ${c.products.length} are ${STATUS_LABEL[sharedStatus].toLowerCase()}.` : ''}`
                    : (result.lastRefreshedAt
                      ? `Last researched ${formatDate(result.lastRefreshedAt)}.`
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
                      {Object.keys(statusCounts).length > 1 && (
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
                      )}
                      <div className="ml-auto flex items-center gap-1.5" role="group" aria-label="Product layout">
                        <FilterChip active={viewMode === 'cards'} onClick={() => setView('cards')}>Cards</FilterChip>
                        <FilterChip active={viewMode === 'table'} onClick={() => setView('table')}>Table</FilterChip>
                      </div>
                    </div>
                  )}
                  {products.length === 0 ? (
                    <EmptyNote compact title="No products match these filters">
                      Clear the search or choose All.
                    </EmptyNote>
                  ) : (
                    viewMode === 'table' ? (
                    <ProductTable products={products} onOpen={setOpenProduct} showStatus={!sharedStatus} />
                    ) : (
                    <ul className={cn('grid gap-3', products.length > 1 && 'md:grid-cols-2')}>
                      {products.map((p) => {
                        const hasUrl = !!p.url && /^https?:\/\//.test(p.url);
                        return (
                          <li
                            key={p.name}
                            className="panel group flex cursor-pointer flex-col overflow-hidden transition-colors hover:border-primary/40"
                            onClick={() => setOpenProduct(p)}
                            title="Open this product — source disclosure and research"
                          >
                            <div className="flex flex-1 flex-col p-4">
                              <div className="flex items-start justify-between gap-2">
                                {/* The card opens on a click anywhere; the name is the real button for keyboards and screen readers. */}
                                <h4 className="font-medium text-content">
                                  <button type="button" className="text-left" onClick={(e) => { e.stopPropagation(); setOpenProduct(p); }}>{p.name}</button>
                                </h4>
                                {p.status && !sharedStatus && (
                                  <span className={cn('chip shrink-0 py-0.5 text-[11px]', STATUS_STYLE[p.status])}>
                                    {STATUS_LABEL[p.status]}
                                  </span>
                                )}
                              </div>
                              {p.description && splitSearchReport(p.description).searchReported && (
                                <span
                                  className="mt-1 inline-block text-[11px] text-faint"
                                  title="Reported by Google Search; the original page was not retrieved"
                                >
                                  Search-reported · original not retrieved
                                </span>
                              )}
                              {p.description ? (
                                <p className="mt-1.5 line-clamp-3 text-sm text-muted">{splitSearchReport(p.description).text}</p>
                              ) : (
                                <p className="mt-1.5 text-sm text-faint">No description retained.</p>
                              )}
                              <div className="mt-auto flex items-end justify-between gap-3 pt-3">
                                <span
                                  className="min-w-0 text-[11px] text-muted"
                                  title="What sources report about revenue contribution"
                                >
                                  {/* Said once in the section header; a repeat on every card was noise. */}
                                  {p.revenueNote ? <span className="line-clamp-2">{p.revenueNote}</span> : null}
                                </span>
                                {hasUrl ? (
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
                                ) : anySource ? (
                                  <span className="shrink-0 text-[11px] text-faint">Source not recorded</span>
                                ) : null}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    )
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
                HORIZONS.every(({ key }) => c.roadmap.filter((r) => r.horizon === key).length <= 2) ? (
                  /* Sparse roadmap: hollow one-item columns read as empty cards, so one
                     list carries a Now / Next / Later tag per row instead. */
                  <ul className="panel divide-y divide-border p-0" aria-label="Roadmap items">
                    {HORIZONS.flatMap(({ key, label, dot }) =>
                      c.roadmap.filter((r) => r.horizon === key).map((r, i) => (
                        <li key={`${key}-${i}`}>
                          <button
                            type="button"
                            className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/70"
                            title="Open this roadmap item — the full gist, plus grounded research"
                            onClick={() => setOpenRoadmap(r)}
                          >
                            <span className="mt-0.5 inline-flex w-16 shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                              <span className={cn('h-2 w-2 rounded-full', dot)} aria-hidden />
                              {label}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-baseline justify-between gap-2">
                                <span className="text-sm font-medium text-content">{r.title}</span>
                                {r.date ? (
                                  <span className="shrink-0 text-[10px] font-semibold tabular-nums text-primary-ink">{r.date}</span>
                                ) : null}
                              </span>
                              {r.detail ? <span className="block text-xs text-muted">{r.detail}</span> : null}
                              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10.5px] text-faint">
                                {statedOn && <span>stated {statedOn}</span>}
                                {isPastDue(r.date, new Date()) && (
                                  <span
                                    className="rounded border border-amber-300 bg-amber-50 px-1 text-amber-700"
                                    title="The stated target date has passed; this research does not confirm whether it shipped."
                                  >
                                    past due
                                  </span>
                                )}
                              </span>
                            </span>
                          </button>
                        </li>
                      )),
                    )}
                  </ul>
                ) : (
                <div className={cn('grid gap-3', GROUP_COLS[HORIZONS.filter(({ key }) => c.roadmap.some((r) => r.horizon === key)).length])}>
                  {HORIZONS.map(({ key, label, dot }) => {
                    const items = c.roadmap.filter((r) => r.horizon === key);
                    if (items.length === 0) return null;
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
                                  {r.date ? (
                                    <span className="shrink-0 text-[10px] font-semibold tabular-nums text-primary-ink">
                                      {r.date}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="text-xs text-muted">{r.detail}</div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10.5px] text-faint">
                                  {statedOn && <span>stated {statedOn}</span>}
                                  {isPastDue(r.date, new Date()) && (
                                    <span
                                      className="rounded border border-amber-300 bg-amber-50 px-1 text-amber-700"
                                      title="The stated target date has passed; this research does not confirm whether it shipped."
                                    >
                                      past due
                                    </span>
                                  )}
                                </div>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
                )
              )}
            </section>

            {relationships.length > 0 && (
              <section aria-label="Customers, suppliers and partners">
                <SectionHeader
                  title="Customers, suppliers & partners"
                  count={relationships.length}
                  description="Named only where a reported sentence states the relationship; each links to where it was reported."
                />
                <div className={cn('grid gap-3', GROUP_COLS[RELATIONSHIP_KINDS.filter(({ key }) => relationships.some((r) => r.kind === key)).length])}>
                  {RELATIONSHIP_KINDS.map(({ key, label, dot }) => {
                    const items = relationships.filter((r) => r.kind === key);
                    if (items.length === 0) return null;
                    return (
                      <div key={key} className="panel overflow-hidden p-0">
                        <div className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-content">
                          <span className={cn('h-2 w-2 rounded-full', dot)} />
                          {label}
                          <span className="ml-1.5 font-normal normal-case tabular-nums text-muted">{items.length}</span>
                        </div>
                        <ul className="space-y-3 px-4 py-3">
                          {items.map((r) => (
                            <li key={r.name}>
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-sm font-medium text-content">{r.name}</span>
                                {r.sourceUrl && /^https?:\/\//.test(r.sourceUrl) && (
                                  <a
                                    href={r.sourceUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex shrink-0 items-center gap-1 text-[11px] text-primary-ink hover:underline"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    {r.sourceTitle || hostOf(r.sourceUrl) || 'Source'}
                                  </a>
                                )}
                              </div>
                              <div className="line-clamp-2 text-xs text-muted" title={r.quote}>“{r.quote}”</div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {openProduct && (
              <ProductPage
                product={openProduct}
                companyId={companyId}
                company={{ name, logoUrl: companyRecord?.logoUrl ?? null, websiteUrl: companyRecord?.websiteUrl ?? null }}
                roadmap={c.roadmap}
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
