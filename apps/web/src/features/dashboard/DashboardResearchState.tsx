import { Loader2, Search } from 'lucide-react';
import { EmptyState } from '@/components/states/EmptyState';
import { SettingsLink } from '@/components/SettingsLink';

export function DashboardResearchState({
  loading,
  hasKey,
  researching,
  readError,
  researchError,
  onResearch,
  onRetry,
}: {
  loading: boolean;
  hasKey: boolean;
  researching: boolean;
  readError?: unknown;
  researchError?: unknown;
  onResearch: () => void;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div
        role="status"
        className="panel flex items-center justify-center gap-2 px-6 py-12 text-sm text-muted"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading saved research…
      </div>
    );
  }

  if (readError) {
    return (
      <div
        role="alert"
        className="panel flex flex-col items-center justify-center gap-3 px-6 py-12 text-center"
      >
        <h3 className="font-display text-lg text-content">Saved research could not be loaded</h3>
        <p className="max-w-md text-sm text-muted">
          Retry is a free cached read. It will not contact a provider or start research.
        </p>
        <button type="button" className="btn-ghost" onClick={onRetry}>
          Retry saved research
        </button>
      </div>
    );
  }

  if (researchError) {
    return (
      <div
        role="alert"
        className="panel flex flex-col items-center justify-center gap-3 px-6 py-12 text-center"
      >
        <h3 className="font-display text-lg text-content">Research did not finish</h3>
        <p className="max-w-md text-sm text-muted">
          The provider could not complete this request. Retrying contacts your connected provider
          and may incur API charges.
        </p>
        {!hasKey && (
          <p className="text-sm text-muted">
            Connect a provider in{' '}
            <SettingsLink className="text-primary-ink underline">Settings</SettingsLink> before
            retrying.
          </p>
        )}
        <button
          type="button"
          className="btn-primary"
          disabled={!hasKey || researching}
          onClick={onRetry}
        >
          {researching && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Retry research
        </button>
      </div>
    );
  }

  return (
    <EmptyState
      icon={<Search className="h-6 w-6" aria-hidden />}
      title="This section hasn’t been researched yet"
      description="Saved research appears here when available. You can request a fresh, sourced pass for this section."
      action={
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            className="btn-primary"
            disabled={!hasKey || researching}
            onClick={onResearch}
          >
            {researching && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {researching ? 'Researching…' : 'Research this section'}
          </button>
          {!hasKey && (
            <p className="text-sm text-muted">
              Connect a provider in{' '}
              <SettingsLink className="text-primary-ink underline">Settings</SettingsLink> to
              research this section.
            </p>
          )}
          {researching && (
            <p role="status" className="text-sm text-muted">
              Research is running.
            </p>
          )}
          <p className="max-w-md text-xs text-faint">
            Uses your connected provider and may incur API charges.
          </p>
        </div>
      }
    />
  );
}
