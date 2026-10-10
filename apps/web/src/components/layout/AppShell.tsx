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
import { SettingsLink } from '@/components/SettingsLink';
import { useHostedBudget } from '@/lib/hostedApi';
import { useApiKey } from '@/lib/settings/apiKey';

/** Free hosted research hit today's budget: say so once, plainly, with the fix. */
function HostedBudgetBanner() {
  const exhausted = useHostedBudget((s) => s.exhausted);
  const hosted = useApiKey((s) => s.hosted);
  if (!exhausted || !hosted) return null;
  return (
    <div role="status" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-[12.5px] text-amber-900 md:px-6">
      {exhausted === 'visitor'
        ? 'You’ve used today’s free research. '
        : 'Free research has reached today’s budget. '}
      Your decks are safe and everything already researched still works. New research resumes at midnight UTC, or{' '}
      <SettingsLink className="font-semibold underline">add your own Gemini key</SettingsLink> to keep going now.
    </div>
  );
}

export function AppShell() {
  useDeckRefreshSubscription();
  useAutoRefresh();
  // Queued hunts keep draining across navigation — the runner lives here.
  useHuntRunner();
  useSentinel();
  const { pushWidth, closePanel } = useDeepDive();
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
        // Reserve exactly the docked panel's width (0 when floating or closed),
        // so the page makes room instead of sliding under the chat.
        style={{ marginRight: pushWidth }}
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

        <HostedBudgetBanner />
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
