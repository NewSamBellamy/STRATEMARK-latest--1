import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { ErrorBoundary } from '@/components/states/ErrorBoundary';
import { FullPageLoader } from '@/components/states/FullPageLoader';
import { useDeckRefreshSubscription } from '@/hooks/data';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { useDeepDive } from '@/features/deepdive/DeepDive';
import { useHuntRunner } from '@/lib/agentic/useHuntRunner';
import { useSentinel } from '@/lib/agentic/useSentinel';
import { SettingsModal } from '@/features/settings/SettingsModal';

export function AppShell() {
  useDeckRefreshSubscription();
  useAutoRefresh();
  // Queued hunts keep draining across navigation — the runner lives here.
  useHuntRunner();
  useSentinel();
  const { isOpen: aiPanelOpen, closePanel } = useDeepDive();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
          <ErrorBoundary>
            <Suspense fallback={<FullPageLoader />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <SettingsModal />
    </div>
  );
}
