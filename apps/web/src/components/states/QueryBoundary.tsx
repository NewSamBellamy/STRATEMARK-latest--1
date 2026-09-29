import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { FullPageLoader } from './FullPageLoader';
import { ErrorState } from './ErrorState';
import { EmptyState } from './EmptyState';
import { KeyRound } from 'lucide-react';
import { SettingsLink } from '@/components/SettingsLink';

/**
 * Enforces the "all four states" rule (loading / error / empty / data) for a
 * query in one place, so no data-driven view can silently skip a state.
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
  empty?: ReactNode;
  errorTitle?: string;
}) {
  if (query.isPending) return <>{loading ?? <FullPageLoader />}</>;
  if (query.isError) {
    const message = query.error instanceof Error ? query.error.message : String(query.error);
    if (/api key|gemini key/i.test(message)) {
      return (
        <EmptyState
          icon={<KeyRound className="h-6 w-6" aria-hidden />}
          title="Connect Gemini to research this view"
          description="Cached research remains available without a key. This view has not been researched yet."
          action={<SettingsLink className="btn-primary">Open Settings</SettingsLink>}
        />
      );
    }
    return (
      <ErrorState
        title={errorTitle ?? 'Failed to load'}
        message={message}
        onRetry={() => void query.refetch()}
      />
    );
  }
  const data = query.data;
  if (data == null) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  if (isEmpty?.(data as NonNullable<T>)) {
    return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  }
  return <>{children(data as NonNullable<T>)}</>;
}
