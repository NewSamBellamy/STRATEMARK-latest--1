/**
 * The roadmap, grouped Now / Next / Later. Each item shows the date a source gave
 * (never an invented one), when it was stated, whether the target date has passed,
 * the page it was reported on, and the product it belongs to (opens that product's page).
 * No public roadmap is said plainly, with one way to look again.
 */
import { ExternalLink } from 'lucide-react';
import type { Product, RoadmapItem } from '@mi/contracts';
import { cn } from '@/lib/cn';
import { safeHttpUrl } from '@/lib/sourceHref';
import { EmptyNote } from './TabKit';
import { hostOf } from './tabHelpers';
import { isPastDue, roadmapProduct } from '../productsReport';

const HORIZONS: Array<{ key: RoadmapItem['horizon']; label: string; dot: string; hint: string }> = [
  { key: 'now', label: 'Now', dot: 'bg-emerald-500', hint: 'Dated within about a month' },
  { key: 'next', label: 'Next', dot: 'bg-amber-500', hint: 'Dated within about six months' },
  { key: 'later', label: 'Later', dot: 'bg-slate-400', hint: 'Further out, or no date stated' },
];

export function RoadmapGroups({ roadmap, products, statedOn, onOpenItem, onOpenProduct, onResearch, researching }: {
  roadmap: readonly RoadmapItem[];
  products: readonly Product[];
  statedOn: string | null;
  onOpenItem: (item: RoadmapItem) => void;
  onOpenProduct: (product: Product) => void;
  onResearch: () => void;
  researching: boolean;
}) {
  if (roadmap.length === 0) {
    return (
      <EmptyNote
        compact
        title="No public roadmap found"
        action={(
          <button type="button" disabled={researching} onClick={onResearch}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-content hover:bg-surface-2 disabled:opacity-60">
            {researching ? 'Researching…' : 'Research now'}
          </button>
        )}
      >
        Research fills this from official announcements, earnings commentary and filings.
        Rumours and guesses are not retained.
      </EmptyNote>
    );
  }
  const now = new Date();
  return (
    <div className="panel divide-y divide-border overflow-hidden p-0">
      {HORIZONS.map(({ key, label, dot, hint }) => {
        const items = roadmap.filter((r) => r.horizon === key);
        if (items.length === 0) return null;
        return (
          <section key={key} aria-label={`Roadmap: ${label}`}>
            <div className="flex items-center gap-2 bg-surface-2/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-content">
              <span className={cn('h-2 w-2 rounded-full', dot)} aria-hidden />
              {label}
              <span className="font-normal normal-case tabular-nums text-muted">{items.length}</span>
              <span className="ml-auto hidden text-[11px] font-normal normal-case text-faint sm:inline">{hint}</span>
            </div>
            <ul aria-label={`${label} roadmap items`} className="divide-y divide-border">
              {items.map((r, i) => {
                const source = safeHttpUrl(r.sourceUrl);
                const owner = roadmapProduct(r, products);
                return (
                  <li key={`${key}-${i}`} className="grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
                    <p className={cn('text-[11px] font-semibold tabular-nums', r.date ? 'text-primary-ink' : 'text-faint')}>{r.date ?? 'No date stated'}</p>
                    <div className="min-w-0">
                      <button type="button" className="block w-full rounded-md text-left transition-colors hover:bg-surface-2/70"
                        title="Open this roadmap item: the full gist, plus grounded research" onClick={() => onOpenItem(r)}>
                        <span className="block text-sm font-medium text-content">{r.title}</span>
                        {r.detail ? <span className="mt-0.5 line-clamp-3 block text-xs text-muted">{r.detail}</span> : null}
                      </button>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] text-faint">
                        {statedOn && <span>stated {statedOn}</span>}
                        {isPastDue(r.date, now) && (
                          <span className="rounded border border-amber-300 bg-amber-50 px-1 text-amber-700"
                            title="The stated target date has passed; this research does not confirm whether it shipped.">past due</span>
                        )}
                        {source && (
                          <a href={source} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary-ink hover:underline">
                            <ExternalLink className="h-3 w-3" aria-hidden />{hostOf(source) ?? 'Source'}
                          </a>
                        )}
                        {owner && (
                          <button type="button" className="text-primary-ink hover:underline" onClick={() => onOpenProduct(owner)}>
                            Product: {owner.name}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
