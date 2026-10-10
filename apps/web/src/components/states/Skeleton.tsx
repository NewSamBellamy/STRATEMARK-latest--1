import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-surface-2', className)} aria-hidden />;
}

/** Individual single card skeleton matching the authentic GameCard layout. */
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'relative flex flex-col justify-between rounded-2xl border border-border bg-surface p-4 shadow-card',
        className,
      )}
      aria-hidden="true"
    >
      {/* Top Identity Row */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            {/* Logo Box */}
            <div className="h-11 w-11 shrink-0 rounded-[10px] border border-border/60 bg-surface-2 animate-pulse" />
            <div className="min-w-0 flex-1 pt-0.5">
              {/* Company Name */}
              <div className="h-4.5 w-28 rounded-md bg-surface-2 animate-pulse mb-1.5" />
              {/* Pills / Tags */}
              <div className="flex items-center gap-1.5">
                <div className="h-3.5 w-14 rounded bg-surface-2 animate-pulse" />
                <div className="h-3.5 w-12 rounded bg-surface-2 animate-pulse" />
              </div>
            </div>
          </div>
          {/* Score Ring */}
          <div className="h-10 w-10 shrink-0 rounded-full border-2 border-dashed border-border/70 bg-surface-2/40 animate-pulse flex items-center justify-center" />
        </div>

        {/* Description lines */}
        <div className="mt-3.5 space-y-1.5">
          <div className="h-3 w-full rounded bg-surface-2/80 animate-pulse" />
          <div className="h-3 w-4/5 rounded bg-surface-2/80 animate-pulse" />
        </div>

        {/* Location tag */}
        <div className="mt-2 flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-full bg-surface-2 animate-pulse" />
          <div className="h-2.5 w-20 rounded bg-surface-2/70 animate-pulse" />
        </div>
      </div>

      {/* Bottom Metrics & Footer */}
      <div className="mt-4">
        {/* Financial Metrics — 3 Columns */}
        <div className="border-t border-border/70 pt-3">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="h-4 w-12 rounded bg-surface-2 animate-pulse mb-1" />
              <div className="h-2.5 w-8 rounded bg-surface-2/60 animate-pulse" />
            </div>
            <div>
              <div className="h-4 w-12 rounded bg-surface-2 animate-pulse mb-1" />
              <div className="h-2.5 w-10 rounded bg-surface-2/60 animate-pulse" />
            </div>
            <div>
              <div className="h-4 w-10 rounded bg-surface-2 animate-pulse mb-1" />
              <div className="h-2.5 w-12 rounded bg-surface-2/60 animate-pulse" />
            </div>
          </div>
        </div>

        {/* Footer info pills */}
        <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-2.5">
          <div className="flex items-center gap-1.5">
            <div className="h-4 w-14 rounded-full bg-surface-2 animate-pulse" />
            <div className="h-4 w-12 rounded-full bg-surface-2 animate-pulse" />
          </div>
          <div className="h-3 w-16 rounded bg-surface-2/60 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

/** A grid of card-shaped skeletons for the deck/card loading state. */
export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      role="status"
      aria-label="Loading cards"
    >
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}
