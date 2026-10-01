import { lazy, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { RequireAuth } from '@/lib/auth/RequireAuth';
import { useSettingsModal } from '@/lib/settings/settingsModal';
import { isReadOnlyResearch } from '@/lib/settings/runtime';

function LegacySettingsRoute() {
  const open = useSettingsModal((state) => state.open);
  const readOnly = isReadOnlyResearch();
  useEffect(() => {
    if (!readOnly) open();
  }, [open, readOnly]);
  return <Navigate to="/library" replace />;
}

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
const CardCompositionPage = lazy(() =>
  import('@/features/card/CardCompositionPage').then((module) => ({
    default: module.CardCompositionPage,
  })),
);

/** Shared route tree, used by both the app (HashRouter) and tests (MemoryRouter). */
export function AppRoutes() {
  const readOnly = isReadOnlyResearch();
  const previewOnly = (element: JSX.Element) =>
    readOnly ? <Navigate to="/library" replace /> : element;
  return (
    <Routes>
      <Route path="/design/cards" element={<CardCompositionPage />} />
      {/* Shared-research links render OUTSIDE the app shell: recipients get a
          clean read-only snapshot — no sidebar, no auth, no AI layer. */}
      <Route path="/share/:blob" element={previewOnly(<SharePage />)} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/library" replace />} />
        <Route path="library" element={<MarketsListPage />} />
        <Route path="new" element={previewOnly(<NewDeckPage />)} />
        <Route path="history" element={<Navigate to="/library" replace />} />
        <Route path="markets" element={<Navigate to="/library" replace />} />
        <Route path="saved" element={previewOnly(<SavedCardsPage />)} />
        <Route path="settings" element={<LegacySettingsRoute />} />
        <Route path="reports" element={previewOnly(<ReportsListPage />)} />
        <Route path="reports/:reportId" element={previewOnly(<ReportViewerPage />)} />
        <Route path="markets/:marketId/deck" element={<DeckPage />} />
        <Route path="markets/:marketId/opportunity" element={previewOnly(<OpportunityPage />)} />
        <Route path="markets/:marketId/briefing" element={previewOnly(<BriefingPage />)} />
        <Route path="markets/:marketId/settings" element={previewOnly(<MarketSettingsPage />)} />
        <Route path="company/:companyId/dashboard" element={<Navigate to="overview" replace />} />
        <Route path="company/:companyId/dashboard/:tab" element={<DashboardPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
