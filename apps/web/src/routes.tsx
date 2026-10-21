import { Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { FullPageLoader } from '@/components/states/FullPageLoader';
import { RequireAuth } from '@/lib/auth/RequireAuth';
import { useSettingsModal } from '@/lib/settings/settingsModal';
import { lazyRoute } from '@/lib/lazyRoute';
import { useFollows } from '@/hooks/today';

/** #/settings and #/settings/:tab open the Settings modal (on that tab) over home. */
function SettingsRoute() {
  const open = useSettingsModal((state) => state.open);
  const { tab } = useParams();
  useEffect(() => { open(tab); }, [open, tab]);
  return <Navigate to="/" replace />;
}

// Route-level code splitting (Phase 7 perf).
const TodayPage = lazyRoute(() => import('@/features/today/TodayPage'));
const MarketsListPage = lazyRoute(() => import('@/features/markets/MarketsListPage'));
const NewDeckPage = lazyRoute(() => import('@/features/deck/NewDeckPage'));
const MarketSettingsPage = lazyRoute(() => import('@/features/markets/MarketSettingsPage'));
const DeckPage = lazyRoute(() => import('@/features/deck/DeckPage'));
const OpportunityPage = lazyRoute(() => import('@/features/deck/OpportunityPage'));
const BriefingPage = lazyRoute(() => import('@/features/briefing/BriefingPage'));
const DashboardPage = lazyRoute(() => import('@/features/dashboard/DashboardPage'));
const ReportsListPage = lazyRoute(() => import('@/features/reports/ReportsListPage'));
const ReportViewerPage = lazyRoute(() => import('@/features/reports/ReportViewerPage'));
const SavedCardsPage = lazyRoute(() => import('@/features/saved/SavedCardsPage'));
const SharePage = lazyRoute(() => import('@/features/share/SharePage'));
const NotFoundPage = lazyRoute(() => import('@/features/NotFoundPage'));
const BetaPage = lazyRoute(() => import('@/features/beta/BetaPage'));

const LANDED_KEY = 'mi.today.landed';

/** Home: the first page of a session is Today once the user follows companies; New Deck otherwise. */
function HomeRoute() {
  const follows = useFollows();
  const [landed] = useState(() => {
    try { return sessionStorage.getItem(LANDED_KEY) === '1'; } catch { return true; }
  });
  useEffect(() => {
    if (!landed && follows.isFetched) try { sessionStorage.setItem(LANDED_KEY, '1'); } catch { /* lands on Today each time */ }
  }, [landed, follows.isFetched]);
  if (!landed && follows.isPending) return null;
  if (!landed && (follows.data?.length ?? 0) > 0) return <Navigate to="/today" replace />;
  return <NewDeckPage />;
}

/** Shared route tree, used by both the app (HashRouter) and tests (MemoryRouter). */
export function AppRoutes() {
  return (
    <Routes>
      {/* Shared-research links render OUTSIDE the app shell: recipients get a
          clean read-only snapshot — no sidebar, no auth, no AI layer. */}
      {/* Outside the shell, so outside its Suspense boundary: without its own, opening a share link from inside a running
          app (pasting it into the address bar) suspends with nowhere to wait and the whole app fails to start. */}
      <Route path="/share/:blob" element={<Suspense fallback={<FullPageLoader />}><SharePage /></Suspense>} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<HomeRoute />} />
        <Route path="today" element={<TodayPage />} />
        <Route path="history" element={<MarketsListPage />} />
        <Route path="saved" element={<SavedCardsPage />} />
        <Route path="settings" element={<SettingsRoute />} />
        <Route path="settings/:tab" element={<SettingsRoute />} />
        <Route path="reports" element={<ReportsListPage />} />
        <Route path="beta" element={<BetaPage />} />
        <Route path="reports/:reportId" element={<ReportViewerPage />} />
        <Route path="markets/:marketId/deck" element={<DeckPage />} />
        <Route path="markets/:marketId/opportunity" element={<OpportunityPage />} />
        <Route path="markets/:marketId/briefing" element={<BriefingPage />} />
        <Route path="markets/:marketId/settings" element={<MarketSettingsPage />} />
        <Route path="company/:companyId/dashboard" element={<Navigate to="overview" replace />} />
        <Route path="company/:companyId/dashboard/:tab" element={<DashboardPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
