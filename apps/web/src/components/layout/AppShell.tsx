import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { OPEN_SOURCE_LAUNCH, isHostedBeta } from '@/lib/beta';
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
import { TaskToasts } from './TaskToasts';
import { SettingsLink } from '@/components/SettingsLink';
import { useHostedBudget } from '@/lib/hostedApi';
import { useApiKey } from '@/lib/settings/apiKey';
import { useSettingsModal } from '@/lib/settings/settingsModal';
import { pageKey } from '@/lib/pageKey';
import { useRouteTitle } from '@/lib/routeTitle';

const BETA_NOTICE_KEY = 'stratemark.betaNotice.v1';

/** First-visit beta notice: what we cover, that research stays local, how to leave with it. */
function BetaNotice() {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(BETA_NOTICE_KEY) === 'dismissed'; } catch { return false; }
  });
  if (hidden || !isHostedBeta()) return null;
  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem(BETA_NOTICE_KEY, 'dismissed'); } catch { /* shows again next visit */ }
  };
  return (
    <div role="note" className="flex items-start gap-3 border-b border-primary/20 bg-primary/5 px-4 py-2.5 text-[12.5px] leading-snug text-content md:px-6">
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Free beta.</span> We cover the AI and server costs so you can try Stratemark.
        Your decks, research and AI chats stay in this browser, and we don&apos;t see them. Export everything any time,
        and bring it into the open-source version at {OPEN_SOURCE_LAUNCH}.{' '}
        <Link to="/beta" className="font-medium text-primary-ink underline">How this works</Link>
      </p>
      <button type="button" onClick={dismiss} className="shrink-0 rounded p-0.5 text-muted hover:text-content" aria-label="Dismiss beta notice">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

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
  useRouteTitle();
  const { pushWidth, closePanel } = useDeepDive();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const closeSettings = useSettingsModal((s) => s.close);
  const lastPathname = useRef(location.pathname);

  // Close AI panel and mobile menu on route change.
  useEffect(() => {
    closePanel();
    setMobileMenuOpen(false);
    // Settings is app-level, so leaving the page does not unmount it: close it
    // here too. Not on the #/settings → home redirect that just opened it.
    const from = lastPathname.current;
    lastPathname.current = location.pathname;
    if (from !== location.pathname && !from.startsWith('/settings')) closeSettings();
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard reach for the phone drawer: opening it moves focus inside, and
  // Escape closes it and hands focus back to the menu button.
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    drawerRef.current?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      // A dialog layered over the drawer handles its own Escape first.
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      setMobileMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileMenuOpen]);

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
          <div ref={drawerRef} className="absolute left-0 top-0 h-full w-64">
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
            ref={menuButtonRef}
            type="button"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-content md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <TopBar />
        </header>

        <BetaNotice />
        <HostedBudgetBanner />
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
          {/* Keyed per page: leaving a page unmounts it (and its overlays) at
              once, and a crashed page does not stay crashed after navigating. */}
          <ErrorBoundary key={pageKey(location.pathname)}>
            <Suspense fallback={<FullPageLoader />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <SettingsModal />
      <TaskToasts />
    </div>
  );
}
