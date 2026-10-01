import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, useLocation, useNavigationType, useParams } from 'react-router-dom';
import { AppRoutes } from '@/routes';
import { useSettingsModal } from '@/lib/settings/settingsModal';

// Keep the production route tree and guards; isolate pages/shell from repositories and providers.
vi.mock('@/components/layout/AppShell', () => ({
  AppShell: () => (
    <div data-testid="app-shell">
      <Outlet />
    </div>
  ),
}));
vi.mock('@/lib/auth/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, isAuthenticated: false, signInWithEmail: vi.fn() }),
}));
vi.mock('@/features/markets/MarketsListPage', () => ({ default: () => <h1>Library</h1> }));
vi.mock('@/features/deck/NewDeckPage', () => ({ default: () => <h1>New deck</h1> }));
vi.mock('@/features/markets/MarketSettingsPage', () => ({
  default: () => <h1>Market settings</h1>,
}));
vi.mock('@/features/deck/DeckPage', () => ({
  default: function DeckPage() {
    return <h1>Deck {useParams().marketId}</h1>;
  },
}));
vi.mock('@/features/deck/OpportunityPage', () => ({ default: () => <h1>Opportunities</h1> }));
vi.mock('@/features/briefing/BriefingPage', () => ({ default: () => <h1>Briefing</h1> }));
vi.mock('@/features/dashboard/DashboardPage', () => ({
  default: function DashboardPage() {
    const { companyId, tab } = useParams();
    return (
      <h1>
        Dashboard {companyId} {tab}
      </h1>
    );
  },
}));
vi.mock('@/features/reports/ReportsListPage', () => ({ default: () => <h1>Reports</h1> }));
vi.mock('@/features/reports/ReportViewerPage', () => ({
  default: function ReportViewerPage() {
    return <h1>Report {useParams().reportId}</h1>;
  },
}));
vi.mock('@/features/saved/SavedCardsPage', () => ({ default: () => <h1>Saved cards</h1> }));
vi.mock('@/features/share/SharePage', () => ({
  default: function SharePage() {
    return <h1>Share {useParams().blob}</h1>;
  },
}));
vi.mock('@/features/NotFoundPage', () => ({ default: () => <h1>Not found</h1> }));

function LocationProbe() {
  const location = useLocation();
  const navigationType = useNavigationType();
  return (
    <>
      <output data-testid="location">{location.pathname + location.search + location.hash}</output>
      <output data-testid="navigation-type">{navigationType}</output>
    </>
  );
}

function renderRoute(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <LocationProbe />
      <Suspense fallback={<p>Loading route</p>}>
        <AppRoutes />
      </Suspense>
    </MemoryRouter>,
  );
}

function enableReadOnly() {
  Object.defineProperty(window, 'mi', {
    configurable: true,
    value: { storageMode: 'staged_readonly' },
  });
}

beforeEach(() => {
  Reflect.deleteProperty(window, 'mi');
  localStorage.clear();
  useSettingsModal.setState({ isOpen: false });
  vi.stubEnv('VITE_DESKTOP', '0');
  vi.stubEnv('VITE_OPEN_ACCESS', 'false');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Navigation must not fetch');
    }),
  );
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  Reflect.deleteProperty(window, 'mi');
  useSettingsModal.setState({ isOpen: false });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('canonical navigation', () => {
  it.each(['/', '/library', '/history', '/markets'])('resolves %s to Library', async (route) => {
    renderRoute(route);
    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/library');
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByTestId('navigation-type').textContent).toBe(
      route === '/library' ? 'POP' : 'REPLACE',
    );
  });

  it('opens New Deck directly at /new', async () => {
    renderRoute('/new');
    expect(await screen.findByRole('heading', { name: 'New deck' })).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/new');
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
  });

  it('opens legacy settings and returns to Library', async () => {
    renderRoute('/settings');
    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
    expect(useSettingsModal.getState().isOpen).toBe(true);
    expect(screen.getByTestId('location').textContent).toBe('/library');
    expect(screen.getByTestId('navigation-type').textContent).toBe('REPLACE');
  });

  it.each([
    ['/markets/market-1/deck?type=distribution&card=card-1#evidence', 'Deck market-1'],
    ['/markets/market-1/opportunity', 'Opportunities'],
    ['/markets/market-1/briefing', 'Briefing'],
    ['/markets/market-1/settings', 'Market settings'],
    [
      '/company/company-1/dashboard/metrics?fromMarket=market-1&card=card-1',
      'Dashboard company-1 metrics',
    ],
    ['/company/company-1/dashboard/products_roadmap', 'Dashboard company-1 products_roadmap'],
    ['/reports', 'Reports'],
    ['/reports/report-1', 'Report report-1'],
    ['/saved', 'Saved cards'],
    ['/unknown-route', 'Not found'],
  ])('preserves the existing destination %s', async (route, heading) => {
    renderRoute(route);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe(route);
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
  });

  it('keeps the company dashboard index redirect to Overview', async () => {
    renderRoute('/company/company-1/dashboard');
    expect(
      await screen.findByRole('heading', { name: 'Dashboard company-1 overview' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe(
      '/company/company-1/dashboard/overview',
    );
    expect(screen.getByTestId('navigation-type').textContent).toBe('REPLACE');
  });

  it.each(['/library', '/new', '/history', '/markets'])(
    'keeps %s behind the existing browser auth gate',
    (route) => {
      vi.stubEnv('MODE', 'production');
      renderRoute(route);
      expect(screen.getByRole('button', { name: 'Sign In / Register' })).toBeInTheDocument();
      expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
      expect(screen.getByTestId('location').textContent).toBe(route);
    },
  );

  it('keeps shared snapshots outside the shell and browser auth gate', async () => {
    vi.stubEnv('MODE', 'production');
    renderRoute('/share/snapshot-1');
    expect(await screen.findByRole('heading', { name: 'Share snapshot-1' })).toBeInTheDocument();
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/share/snapshot-1');
  });
});

describe('read-only navigation', () => {
  it.each([
    '/',
    '/library',
    '/history',
    '/markets',
    '/new',
    '/settings',
    '/saved',
    '/reports',
    '/reports/report-1',
    '/markets/market-1/opportunity',
    '/markets/market-1/briefing',
    '/markets/market-1/settings',
    '/share/snapshot-1',
  ])('resolves %s to the canonical preview Library', async (route) => {
    enableReadOnly();
    renderRoute(route);
    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/library');
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(useSettingsModal.getState().isOpen).toBe(false);
    expect(screen.getByTestId('navigation-type').textContent).toBe(
      route === '/library' ? 'POP' : 'REPLACE',
    );
  });

  it.each([
    ['/markets/market-1/deck?type=distribution&card=card-1', 'Deck market-1'],
    [
      '/company/company-1/dashboard/metrics?fromMarket=market-1&card=card-1',
      'Dashboard company-1 metrics',
    ],
  ])('keeps saved research readable at %s', async (route, heading) => {
    enableReadOnly();
    renderRoute(route);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe(route);
  });
});
