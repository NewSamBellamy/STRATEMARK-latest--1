import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { RequireAuth } from '@/lib/auth/RequireAuth';

// Route-level code splitting (Phase 7 perf).
const MarketsListPage = lazy(() => import('@/features/markets/MarketsListPage'));
const NewDeckPage = lazy(() => import('@/features/deck/NewDeckPage'));
const MarketSettingsPage = lazy(() => import('@/features/markets/MarketSettingsPage'));
const DeckPage = lazy(() => import('@/features/deck/DeckPage'));
const OpportunityPage = lazy(() => import('@/features/deck/OpportunityPage'));
const BriefingPage = lazy(() => import('@/features/briefing/BriefingPage'));
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));
const ReportsListPage = lazy(() => import('@/features/reports/ReportsListPage'));
const ReportViewerPage = lazy(() => import('@/features/reports/ReportViewerPage'));
const SavedCardsPage = lazy(() => import('@/features/saved/SavedCardsPage'));
const SharePage = lazy(() => import('@/features/share/SharePage'));
const NotFoundPage = lazy(() => import('@/features/NotFoundPage'));

/** Shared route tree, used by both the app (HashRouter) and tests (MemoryRouter). */
export function AppRoutes() {
  return (
    <Routes>
      {/* Shared-research links render OUTSIDE the app shell: recipients get a
          clean read-only snapshot — no sidebar, no auth, no AI layer. */}
      <Route path="/share/:blob" element={<SharePage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<NewDeckPage />} />
        <Route path="history" element={<MarketsListPage />} />
        <Route path="saved" element={<SavedCardsPage />} />
        <Route path="reports" element={<ReportsListPage />} />
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
