import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { FullPageLoader } from './FullPageLoader';
import { ErrorState } from './ErrorState';
import { Link } from 'react-router-dom';
import { EmptyState } from './EmptyState';

/** A missing record is "not found" with a way back, never a vague empty page. */
function NotFound() {
  return (
    <EmptyState
      title="Not found"
      description="This may have been deleted, or the link is out of date."
      action={<Link to="/history" className="btn-primary">Go to your decks</Link>}
    />
  );
}

/**
 * Enforces the "all four states" rule (loading / error / empty / data) for a
 * query in one place, so no data-driven view can silently skip a state.
 *
 * `empty` may be a render prop receiving the result data — an empty state can
 * then distinguish "researched, and nothing surfaced" (lastRefreshedAt set)
 * from "never researched" (null), which the red team called materially
 * different states that must not look the same.
 */
export function QueryBoundary<T>({
  query,
  children,
  loading,
  isEmpty,
  empty,
  errorTitle,
}: {
  query: UseQueryResult<T>;
  children: (data: NonNullable<T>) => ReactNode;
  loading?: ReactNode;
  isEmpty?: (data: NonNullable<T>) => boolean;
  empty?: ReactNode | ((data: NonNullable<T>) => ReactNode);
  errorTitle?: string;
}) {
  if (query.isPending) return <>{loading ?? <FullPageLoader />}</>;
  if (query.isError) {
    return (
      <ErrorState
        title={errorTitle ?? 'Failed to load'}
        message={query.error instanceof Error ? query.error.message : String(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  }
  const data = query.data;
  if (data == null) return <>{empty ?? <NotFound />}</>;
  if (isEmpty?.(data as NonNullable<T>)) {
    if (typeof empty === 'function') return <>{empty(data as NonNullable<T>)}</>;
    return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  }
  return <>{children(data as NonNullable<T>)}</>;
}
