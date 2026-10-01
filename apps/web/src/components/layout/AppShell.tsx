import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { ErrorBoundary } from '@/components/states/ErrorBoundary';
import { FullPageLoader } from '@/components/states/FullPageLoader';
import { useDeckRefreshSubscription } from '@/hooks/data';
import { useDeepDive } from '@/features/deepdive/DeepDive';
import { useHuntRunner } from '@/lib/agentic/useHuntRunner';
import { SettingsModal } from '@/features/settings/SettingsModal';
import { isReadOnlyResearch, isNativeResearch } from '@/lib/settings/runtime';

export function AppShell() {
  useDeckRefreshSubscription();
  // Queued hunts keep draining across navigation — the runner lives here.
  useHuntRunner();
  const { isOpen: aiPanelOpen, closePanel } = useDeepDive();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const readOnly = isReadOnlyResearch();

  // Close AI panel and mobile menu on route change.
  useEffect(() => {
    closePanel();
    setMobileMenuOpen(false);
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg">
      {/* Desktop sidebar — hidden on mobile */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Mobile overlay sidebar */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMobileMenuOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-64">
            <Sidebar />
          </div>
        </div>
      )}

      <div
        className="flex min-w-0 flex-1 flex-col transition-[margin] duration-300 ease-out"
        style={{ marginRight: aiPanelOpen ? 400 : 0 }}
      >
        {/* Top bar with mobile menu button */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface px-4 md:justify-end md:px-5">
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-content md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <TopBar />
        </header>

        {readOnly && (
          <div
            role="status"
            className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-950"
          >
            <strong>Read-only migration preview</strong>
            <span className="ml-2">
              Older research has not been revalidated. Original library unchanged; research/editing
              disabled. Archived reports, findings, and saved items remain retained but are
              unavailable in this preview.
            </span>
          </div>
        )}
        {isNativeResearch() && (
          <div
            role="status"
            className="border-b border-border bg-surface-2 px-4 py-2 text-center text-xs text-muted"
          >
            {window.mi?.researchProvenance === 'synthetic_fixture' && (
              <strong>SYNTHETIC FIXTURE · No live research or provider calls · </strong>
            )}
            {window.mi?.researchProvenance === 'unclassified' && (
              <strong>Unclassified earlier preview · Research disabled · </strong>
            )}
            Native research preview · Separate workspace · Evidence review and other product
            features are still in development
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
          <ErrorBoundary>
            <Suspense fallback={<FullPageLoader />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      {!readOnly && <SettingsModal />}
    </div>
  );
}
