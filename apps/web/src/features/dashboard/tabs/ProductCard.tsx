/**
 * One product in the lineup, as a report card: its picture (only a product-specific
 * one; a card never wears the company's homepage), name and lifecycle, what it is as
 * a source states it, up to two sourced metrics, and what has been researched about it.
 * Opens the full product page. Nothing is shown that research did not source.
 */
import { ExternalLink, Newspaper, Play, Route } from 'lucide-react';
import type { Product, ProductBrief } from '@mi/contracts';
import { cn } from '@/lib/cn';
import { metricRows } from '@/features/export/productReportModel';
import { hostOf, splitSearchReport } from './tabHelpers';
import { ProductPicture, type PictureSubject } from './ProductPicture';
import { STATUS_LABEL, STATUS_STYLE, pictureCandidates } from '../productsReport';

const hasHttpUrl = (url: string | null | undefined): url is string => !!url && /^https?:\/\//.test(url);

export function ProductCard({ product: p, brief, siblings, company, roadmapCount, anySource, hideStatus, onOpen }: {
  product: Product;
  brief: ProductBrief | null;
  siblings: readonly string[];
  company: PictureSubject;
  roadmapCount: number;
  anySource: boolean;
  /** Every product shares one status: said once in the header, not on each card. */
  hideStatus: boolean;
  onOpen: () => void;
}) {
  const hasUrl = hasHttpUrl(p.url);
  const candidates = pictureCandidates({ product: p, brief, siblings, company: { websiteUrl: company.website } });
  const facts = metricRows(p, brief)
    .filter((m) => m.value && m.source && m.label !== 'Status' && m.label !== 'Revenue role').slice(0, 2);
  const news = brief?.news?.length ?? 0;
  const videos = brief?.videos?.length ?? 0;
  return (
    <li
      className="panel group flex cursor-pointer flex-col overflow-hidden transition-colors hover:border-primary/40"
      onClick={onOpen}
      title="Open this product's report: overview, metrics, news, videos and sources"
    >
      {/* The picture the product's own page publishes for link previews; no band when it has none. */}
      <ProductPicture candidates={candidates} product={p.name} company={company} onlyProduct className="aspect-[16/9] border-b border-border" />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          {/* The card opens on a click anywhere; the name is the real button for keyboards and screen readers. */}
          <h4 className="font-medium text-content">
            <button type="button" className="text-left" onClick={(e) => { e.stopPropagation(); onOpen(); }}>{p.name}</button>
          </h4>
          {p.status && !hideStatus && (
            <span className={cn('chip shrink-0 py-0.5 text-[11px]', STATUS_STYLE[p.status])}>{STATUS_LABEL[p.status]}</span>
          )}
        </div>
        {brief?.launched && (
          <p className="mt-0.5 text-[11px] text-faint">First launch: {brief.launched.date}</p>
        )}
        {p.description && splitSearchReport(p.description).searchReported && (
          <span className="mt-1 inline-block text-[11px] text-faint" title="Reported by Google Search; the original page was not retrieved">
            Search-reported · original not retrieved
          </span>
        )}
        {p.description ? (
          <p className="mt-1.5 line-clamp-3 text-sm text-muted">{splitSearchReport(p.description).text}</p>
        ) : (
          <p className="mt-1.5 text-sm text-faint">No description retained.</p>
        )}
        {facts.length > 0 && (
          <dl className="mt-2.5 grid grid-cols-2 gap-2">
            {facts.map((m) => (
              <div key={m.label} className="rounded-lg bg-surface-2/60 px-2.5 py-1.5">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{m.label}</dt>
                <dd className="line-clamp-2 text-[12px] leading-snug text-content">{m.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="mt-auto flex items-end justify-between gap-3 pt-3">
          <span className="min-w-0 text-[11px] text-muted" title="What sources report about revenue contribution">
            {/* Said once in the section header; a repeat on every card was noise. */}
            {p.revenueNote ? <span className="line-clamp-2">{p.revenueNote}</span> : null}
          </span>
          {hasUrl ? (
            <a href={p.url!} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
              className="inline-flex shrink-0 items-center gap-1 text-[11px] text-primary-ink hover:underline">
              <ExternalLink className="h-3 w-3" />
              {hostOf(p.url!) ?? 'Source'}
            </a>
          ) : anySource ? (
            <span className="shrink-0 text-[11px] text-faint">Source not recorded</span>
          ) : null}
        </div>
        {(news > 0 || videos > 0 || roadmapCount > 0) && (
          <ul className="mt-2.5 flex flex-wrap gap-1.5 border-t border-border pt-2.5 text-[11px] text-muted" aria-label="Researched on this product">
            {news > 0 && <li className="inline-flex items-center gap-1"><Newspaper className="h-3 w-3" aria-hidden />{news} {news === 1 ? 'news story' : 'news stories'}</li>}
            {videos > 0 && <li className="inline-flex items-center gap-1"><Play className="h-3 w-3" aria-hidden />{videos} {videos === 1 ? 'video' : 'videos'}</li>}
            {roadmapCount > 0 && <li className="inline-flex items-center gap-1"><Route className="h-3 w-3" aria-hidden />{roadmapCount} on the roadmap</li>}
          </ul>
        )}
      </div>
    </li>
  );
}
