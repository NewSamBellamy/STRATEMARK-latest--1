import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

export function EmptyState({
  title,
  description,
  action,
  icon,
  compact = false,
  page = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  /** Tighter padding for a list that sits among other content rather than being the whole page. */
  compact?: boolean;
  /** Whole-page empty state: one narrow centred width and one padding on every page (Today, Saved, ...). */
  page?: boolean;
}) {
  return (
    <div
      className={`panel flex flex-col items-center justify-center gap-3 px-6 text-center ${
        page ? 'mx-auto w-full max-w-xl py-12' : compact ? 'py-10' : 'py-16'
      }`}
    >
      <div className="rounded-full bg-surface-2 p-3 text-muted">
        {icon ?? <Inbox className="h-6 w-6" aria-hidden />}
      </div>
      <h3 className="font-display text-lg text-content">{title}</h3>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action}
    </div>
  );
}
