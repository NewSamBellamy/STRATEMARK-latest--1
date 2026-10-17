import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkLoadError } from '@/lib/lazyRoute';
import { ErrorState } from './ErrorState';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}
interface State {
  error: Error | null;
}

/** Route-level + global error boundary so a render error never blanks the app. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // A telemetry hook would go here; kept as console in the front-end phase.
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  override render(): ReactNode {
    if (this.state.error) {
      // A page whose code could not be fetched is a connection or deploy
      // problem, not a crash; only a reload fetches it again.
      const chunk = isChunkLoadError(this.state.error);
      return (
        <div className="p-8">
          <ErrorState
            title={chunk ? 'This page could not load' : this.props.fallbackTitle ?? 'This view crashed'}
            message={chunk ? 'Check your connection, then try again.' : this.state.error.message}
            onRetry={chunk ? () => window.location.reload() : this.reset}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
