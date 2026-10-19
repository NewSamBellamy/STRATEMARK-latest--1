import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const SUFFIX = 'Stratemark';

/**
 * The browser-tab title for a screen, so a row of open tabs (or a bookmark, or a screen reader's window list) says
 * where each one is. Null for the screens that title themselves with what they show: a deck (progress and market name,
 * DeckStatusBar) and a company dashboard (company and tab, DashboardPage).
 */
export function routeTitle(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return SUFFIX;
  if (/^\/markets\/[^/]+\/deck$/.test(path) || /^\/company\/[^/]+\/dashboard(\/|$)/.test(path)) return null;
  const screen = (() => {
    if (path === '/today') return 'Today';
    if (path === '/history') return 'All decks';
    if (path === '/saved') return 'Saved cards';
    if (path === '/settings' || path.startsWith('/settings/')) return 'Settings';
    if (path === '/reports') return 'Reports';
    if (/^\/reports\/[^/]+$/.test(path)) return 'Report';
    if (path === '/beta') return 'Free beta';
    if (/^\/markets\/[^/]+\/opportunity$/.test(path)) return 'Opportunity';
    if (/^\/markets\/[^/]+\/briefing$/.test(path)) return 'Daily briefing';
    if (/^\/markets\/[^/]+\/settings$/.test(path)) return 'Deck settings';
    return 'Page not found';
  })();
  return `${screen} · ${SUFFIX}`;
}

/** Keeps the tab title in step with the route (AppShell). */
export function useRouteTitle(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    const title = routeTitle(pathname);
    if (title) document.title = title;
  }, [pathname]);
}
