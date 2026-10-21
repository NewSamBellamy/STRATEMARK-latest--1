/**
 * Small shared building blocks so every dashboard tab has the same header,
 * filter, search and empty-state grammar. Uses only existing tokens.
 */
import type { ReactNode } from 'react';
import { ExternalLink, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { hostOf } from './tabHelpers';

/** Section title + one-line description + right-aligned actions. */
export function SectionHeader({
  title,
  description,
  count,
  actions,
  as: Tag = 'h3',
}: {
  title: string;
  description?: ReactNode;
  count?: number | string;
  actions?: ReactNode;
  as?: 'h2' | 'h3';
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <Tag className="flex items-baseline gap-2 font-display text-base font-semibold text-content">
          {title}
          {count !== undefined && (
            <span className="text-xs font-normal tabular-nums text-muted">{count}</span>
          )}
        </Tag>
        {description && <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A labelled page section on the standard header: the section element plus
 * `SectionHeader`, so a tab composes sections without re-deriving the pattern. */
export function TabSection({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="min-w-0">
      <SectionHeader title={title} description={hint} actions={action} as="h2" />
      {children}
    </section>
  );
}

/** Toggle chip used for every filter row. */
export function FilterChip({
  active,
  onClick,
  children,
  count,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'chip transition-colors disabled:opacity-40',
        active
          ? 'border-primary/40 bg-primary/10 text-primary-ink'
          : 'border-border bg-surface text-muted hover:text-content',
      )}
    >
      {children}
      {count !== undefined && <span className="tabular-nums">{count}</span>}
    </button>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden />
      <input
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-surface py-1.5 pl-9 pr-8 text-sm text-content outline-none placeholder:text-faint focus:border-primary/50"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-content"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * Intentional, labelled empty state: says what is missing and what research
 * would fill it. Never a blank panel, never a placeholder figure.
 */
export function EmptyNote({
  title,
  children,
  action,
  compact,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-dashed border-border bg-surface-2/40 text-center',
        compact ? 'px-4 py-5' : 'px-6 py-9',
      )}
    >
      <p className="text-sm font-medium text-content">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted">{children}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

/** A source affordance: host pill linking to the original. */
export function SourceLink({
  url,
  label,
  className,
}: {
  url: string;
  label?: string;
  className?: string;
}) {
  const host = hostOf(url);
  if (!host || !/^https?:\/\//.test(url)) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'inline-flex items-center gap-1 text-[11px] text-primary-ink hover:underline',
        className,
      )}
    >
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{label || host}</span>
    </a>
  );
}

/** Small uppercase field label used in definition grids. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">{children}</span>
  );
}
